// サーバーはブラウザの縮小を信用しない。本文は上限で切り、再エンコードして位置情報を落とす。元の写真は保存しない。
// sharp 同梱の libheif は HEVC を解けない。HEIC は heic-decode（libde265）で画素にしてから JPEG にする。
import { createRequire } from 'node:module';
import sharp from 'sharp';
import {
  CAPTURE_PHOTO_MAX_BYTES,
  CaptureMessages,
  captureFailure,
  decodeCapturePhoto,
  sniffImage,
  type CaptureResult,
} from './contract';
import { CAPTURE_PHOTO_MAX_EDGE } from './photo-client';

export { CAPTURE_PHOTO_MAX_EDGE };

// iPhone の 48MP（8064×6048）は約 4877 万画素。ファイルのバイト数ではなく幅×高さで見る。
export const CAPTURE_PHOTO_MAX_PIXELS = 50_000_000;
export const CAPTURE_PHOTO_CONCURRENCY = 2;
export const CAPTURE_PHOTO_TIMEOUT_MS = 5_000;
export const CAPTURE_HEIC_TIMEOUT_MS = 12_000;
export const CAPTURE_JPEG_QUALITY = 80;
export const CAPTURE_PREVIEW_MAX_EDGE = 192;
const PREVIEW_MAX_BYTES = 48_000;

const BODY_SLACK = 8 * 1024;
const ALLOWED_DECLARED = new Set([
  '',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/octet-stream',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

export function captureBodyByteLimit(): number {
  return CAPTURE_PHOTO_MAX_BYTES + BODY_SLACK;
}

export function contentLengthExceedsCaptureBody(header: string | null): boolean {
  if (header === null) return false;
  const value = header.trim();
  if (!value) return false;
  if (!/^\d+$/.test(value)) return true;
  const length = Number(value);
  return !Number.isSafeInteger(length) || length > captureBodyByteLimit();
}

export async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  if (!stream) return { ok: true, bytes: new Uint8Array() };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        chunks.length = 0;
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

let activePhotos = 0;
const photoWaiters: Array<() => void> = [];

export async function withPhotoSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activePhotos >= CAPTURE_PHOTO_CONCURRENCY) {
    await new Promise<void>(resolve => {
      photoWaiters.push(resolve);
    });
  }
  activePhotos += 1;
  try {
    return await task();
  } finally {
    activePhotos -= 1;
    photoWaiters.shift()?.();
  }
}

export function runPhotoWithinSlot<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  let settled = false;
  let finishHttp: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void = () => {};
  const http = new Promise<{ ok: true; value: T } | { ok: false; error: unknown }>(resolve => {
    finishHttp = resolve;
  });
  const finish = (result: { ok: true; value: T } | { ok: false; error: unknown }) => {
    if (settled) return;
    settled = true;
    finishHttp(result);
  };
  const occupied = withPhotoSlot(async () => {
    const work = Promise.resolve().then(task).then(
      value => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const timer = setTimeout(() => finish({ ok: false, error: new Error('photo timeout') }), timeoutMs);
    const outcome = await work;
    clearTimeout(timer);
    finish(outcome);
  });
  void occupied.catch((error: unknown) => finish({ ok: false, error }));
  return http.then(result => {
    if (!result.ok) throw result.error;
    return result.value;
  });
}

export async function runBoundedPhotoTask<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = task().then(
    value => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    const winner = await Promise.race([
      work,
      new Promise<{ ok: false; error: Error }>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, error: new Error('photo timeout') }), timeoutMs);
      }),
    ]);
    if (!winner.ok) throw winner.error;
    return winner.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function declaredType(value: string): string {
  return value.split(';')[0].trim().toLowerCase();
}

const require = createRequire(import.meta.url);

function withinPixelBudget(width: number, height: number): boolean {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false;
  if (width < 1 || height < 1) return false;
  // 一辺だけを画素上限と比べ、積が安全整数を超える組み合わせは復号しない。
  if (width > CAPTURE_PHOTO_MAX_PIXELS || height > CAPTURE_PHOTO_MAX_PIXELS) return false;
  return width * height <= CAPTURE_PHOTO_MAX_PIXELS;
}

type HeifDimension = 'ok' | 'pixel-budget' | 'unreadable';

function logHeifFailure(failure: 'timeout' | 'pixel-budget' | 'decode' | 'unreadable'): void {
  // 失敗の種類だけ。画像、ファイル名、例外メッセージは出さない。
  console.info(JSON.stringify({ event: 'capture-photo', failure }));
}

const HEIF_CONTAINERS = new Set([
  'moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl', 'mvex', 'moof', 'traf',
  'mfra', 'skip', 'iprp', 'ipco', 'grpl', 'meta', 'udta', 'meco',
]);

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function heifIspeWithinBudget(bytes: Uint8Array): boolean {
  return heifDimensionCheck(bytes) === 'ok';
}

function heifDimensionCheck(bytes: Uint8Array): HeifDimension {
  let found = false;
  let over = false;
  let broken = false;
  const walk = (start: number, end: number, depth: number) => {
    if (broken) return;
    if (depth > 32) {
      broken = true;
      return;
    }
    let offset = start;
    while (!broken && offset + 8 <= end) {
      const size32 = readU32(bytes, offset);
      const type = boxType(bytes, offset + 4);
      let header = 8;
      let size = size32;
      if (size32 === 1) {
        if (offset + 16 > end) {
          broken = true;
          return;
        }
        if (readU32(bytes, offset + 8) !== 0) {
          broken = true;
          return;
        }
        size = readU32(bytes, offset + 12);
        header = 16;
      } else if (size32 === 0) {
        size = end - offset;
      }
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) {
        broken = true;
        return;
      }
      const boxEnd = offset + size;
      if (type === 'ispe') {
        if (boxEnd < offset + header + 12) {
          broken = true;
          return;
        }
        found = true;
        if (!withinPixelBudget(readU32(bytes, offset + header + 4), readU32(bytes, offset + header + 8))) over = true;
      } else if (HEIF_CONTAINERS.has(type)) {
        const inner = offset + header + (type === 'meta' ? 4 : 0);
        if (inner > boxEnd) {
          broken = true;
          return;
        }
        walk(inner, boxEnd, depth + 1);
      }
      offset = boxEnd;
    }
  };
  walk(0, bytes.length, 0);
  if (broken || !found) return 'unreadable';
  if (over) return 'pixel-budget';
  return 'ok';
}

async function decodeHeicPixels(bytes: Uint8Array): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  const decode = require('heic-decode') as typeof import('heic-decode');
  const images = await decode.all({ buffer: Buffer.from(bytes) });
  try {
    const first = images[0];
    if (!first || !withinPixelBudget(first.width, first.height)) return null;
    const rendered = await first.decode();
    const pixels = rendered.width * rendered.height;
    if (!withinPixelBudget(rendered.width, rendered.height) || rendered.data.length !== pixels * 4) return null;
    return rendered;
  } finally {
    images.dispose();
  }
}

export async function prepareCapturePhoto(
  bytes: Uint8Array,
  mediaType = '',
): Promise<CaptureResult<{ mediaType: 'image/jpeg'; bytes: Uint8Array }>> {
  if (bytes.byteLength > CAPTURE_PHOTO_MAX_BYTES) {
    return captureFailure('PHOTO_TOO_LARGE', CaptureMessages.photoTooLarge, 413);
  }
  const heif = sniffImage(bytes) === 'heif';
  // libheif の既定上限はこちらの画素上限より大きい。復号の前に ispe の幅と高さを見る。
  if (heif) {
    const dimensions = heifDimensionCheck(bytes);
    if (dimensions !== 'ok') {
      logHeifFailure(dimensions);
      return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
    }
  }
  if (!heif) {
    const decoded = decodeCapturePhoto([{ mediaType, bytes }]);
    if (!decoded.ok) return decoded;
  }
  const timeoutMs = heif ? CAPTURE_HEIC_TIMEOUT_MS : CAPTURE_PHOTO_TIMEOUT_MS;
  try {
    // 枠を取ってから数える。HEIC は 12 秒。時間切れでも、画素化が終わるまで枠は手放さない。
    const encoded = await runPhotoWithinSlot(async () => {
      let input: Buffer;
      let raw: { width: number; height: number; channels: 4 } | undefined;
      if (heif) {
        const rendered = await decodeHeicPixels(bytes);
        if (!rendered) return null;
        input = Buffer.from(rendered.data);
        raw = { width: rendered.width, height: rendered.height, channels: 4 };
      } else {
        input = Buffer.from(bytes);
      }
      const image = sharp(input, {
        ...(raw ? { raw } : {}),
        limitInputPixels: CAPTURE_PHOTO_MAX_PIXELS,
        failOn: 'warning',
        animated: false,
      });
      const killer = setTimeout(() => {
        image.destroy();
      }, timeoutMs);
      try {
        if (!raw) {
          const meta = await image.metadata();
          const pixels = (meta.width ?? 0) * (meta.height ?? 0);
          if (
            (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp') ||
            !meta.width || !meta.height || pixels < 1 || pixels > CAPTURE_PHOTO_MAX_PIXELS
          ) {
            return null;
          }
        }
        return await image
          .rotate()
          .resize({
            width: CAPTURE_PHOTO_MAX_EDGE,
            height: CAPTURE_PHOTO_MAX_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: CAPTURE_JPEG_QUALITY, mozjpeg: false })
          .toBuffer();
      } finally {
        clearTimeout(killer);
      }
    }, timeoutMs);
    if (!encoded || encoded.length === 0 || encoded.length > CAPTURE_PHOTO_MAX_BYTES) {
      if (heif) logHeifFailure('unreadable');
      return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
    }
    return { ok: true, value: { mediaType: 'image/jpeg', bytes: new Uint8Array(encoded) } };
  } catch (error) {
    if (heif) {
      const timeout = error instanceof Error && error.message === 'photo timeout';
      logHeifFailure(timeout ? 'timeout' : 'decode');
    }
    return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
  }
}

export async function capturePreviewDataUrl(bytes: Uint8Array): Promise<string | null> {
  try {
    const thumb = await sharp(Buffer.from(bytes), {
      limitInputPixels: CAPTURE_PHOTO_MAX_PIXELS,
      failOn: 'warning',
      animated: false,
    })
      .rotate()
      .resize({
        width: CAPTURE_PREVIEW_MAX_EDGE,
        height: CAPTURE_PREVIEW_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 60, mozjpeg: false })
      .toBuffer();
    if (thumb.length === 0 || thumb.length > PREVIEW_MAX_BYTES) return null;
    return `data:image/jpeg;base64,${thumb.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function readCapturePhoto(request: Request): Promise<CaptureResult<{ mediaType: 'image/jpeg'; bytes: Uint8Array; sourceHeif: boolean }>> {
  if (contentLengthExceedsCaptureBody(request.headers.get('content-length'))) {
    await request.body?.cancel().catch(() => undefined);
    return captureFailure('PHOTO_TOO_LARGE', CaptureMessages.photoTooLarge, 413);
  }
  const bounded = await readBoundedStream(request.body, captureBodyByteLimit());
  if (!bounded.ok) return captureFailure('PHOTO_TOO_LARGE', CaptureMessages.photoTooLarge, 413);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return captureFailure('INVALID_INPUT', CaptureMessages.onePhoto, 400);
  }
  let form: FormData;
  try {
    const copy = new Uint8Array(bounded.bytes.byteLength);
    copy.set(bounded.bytes);
    form = await new Response(copy, { headers: { 'content-type': contentType } }).formData();
  } catch {
    return captureFailure('INVALID_INPUT', CaptureMessages.onePhoto, 400);
  }
  const files = form.getAll('photo').filter((part): part is File => typeof part !== 'string');
  if (files.length !== 1) return captureFailure('INVALID_INPUT', CaptureMessages.onePhoto, 400);
  const file = files[0];
  if (file.size > CAPTURE_PHOTO_MAX_BYTES) {
    return captureFailure('PHOTO_TOO_LARGE', CaptureMessages.photoTooLarge, 413);
  }
  const mediaType = declaredType(file.type);
  if (!ALLOWED_DECLARED.has(mediaType)) {
    return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const prepared = await prepareCapturePhoto(bytes, mediaType === 'image/jpg' ? 'image/jpeg' : mediaType);
  if (!prepared.ok) return prepared;
  return { ok: true, value: { ...prepared.value, sourceHeif: sniffImage(bytes) === 'heif' } };
}
