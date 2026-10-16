import { Parser } from 'htmlparser2';

function decoderFor(label?: string | null): TextDecoder | undefined {
  if (!label) return;
  try { return new TextDecoder(label.trim()); } catch { /* Ignore unknown labels. */ }
}

function charset(contentType: string): string | undefined {
  return /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i.exec(contentType)?.slice(1).find(value => value !== undefined);
}

// Decode before parsing product metadata. Response.text() and Buffer.toString()
// assume UTF-8, but Japanese shops also serve EUC-JP and Shift_JIS.
export function decodeHtml(bytes: Uint8Array, contentType = ''): string {
  // Follow browser precedence: BOM, HTTP charset, HTML declaration, default.
  let decoder: TextDecoder | undefined;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) decoder = new TextDecoder('utf-8');
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = new TextDecoder('utf-16le');
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = new TextDecoder('utf-16be');
  decoder ??= decoderFor(charset(contentType));

  if (!decoder) {
    // HTML encoding declarations belong in the first 1024 bytes. Tokenizing
    // avoids treating comments, script strings or data attributes as metadata.
    const parser = new Parser({
      onopentag(name, attributes) {
        if (name !== 'meta' || decoder) return;
        const label = attributes.charset ?? (attributes['http-equiv']?.toLowerCase() === 'content-type'
          ? charset(attributes.content ?? '') : undefined);
        const declared = decoderFor(label);
        // UTF-16 declarations without a BOM are treated as UTF-8 in HTML.
        decoder = declared?.encoding.startsWith('utf-16') ? new TextDecoder('utf-8') : declared;
      },
    });
    parser.end(Buffer.from(bytes.subarray(0, 1024)).toString('latin1'));
  }
  return (decoder ?? new TextDecoder('utf-8')).decode(bytes);
}

export async function readHtmlResponse(response: Response): Promise<string> {
  return decodeHtml(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type') ?? '');
}
