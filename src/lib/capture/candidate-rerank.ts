// 検索のあとに候補を1回だけ並べ替える。失敗したら元の順のまま。
import { CANDIDATE_IMAGE_HOSTS } from './image-hosts';
import {
  GEMINI_LITE_MODEL,
  geminiGenerateUrl,
  geminiThinkingConfig,
  type GeminiHttpRequest,
  type GeminiHttpResponse,
} from './gemini';

export interface RankCandidate {
  title: string;
  imageUrl?: string | null;
}

const RANK_LIMIT = 5;

export function allowedCandidateImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (CANDIDATE_IMAGE_HOSTS as readonly string[]).includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function geminiRerankRequest(
  photo: { mediaType: string; base64: string },
  candidates: { title: string; image?: { mimeType: string; base64: string } | null }[],
  apiKey: string,
): GeminiHttpRequest | null {
  const url = geminiGenerateUrl(GEMINI_LITE_MODEL);
  if (!url || !apiKey) return null;
  const listed = candidates.slice(0, RANK_LIMIT);
  const lines = listed.map((item, index) => `${index + 1}. ${item.title}`).join('\n');
  const parts: Record<string, unknown>[] = [
    {
      text: [
        '写真の商品と候補を比べ、一番近い候補の番号だけをJSONで返す。',
        'どれも違えば none。説明は付けない。',
        '{"pick":1} または {"pick":"none"}',
        lines,
      ].join(''),
    },
    { inlineData: { mimeType: photo.mediaType, data: photo.base64 } },
  ];
  for (const item of listed) {
    if (!item.image) continue;
    parts.push({ inlineData: { mimeType: item.image.mimeType, data: item.image.base64 } });
  }
  return {
    url,
    method: 'POST',
    redirect: 'manual',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 64,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { pick: { type: 'STRING' } },
          required: ['pick'],
        },
        thinkingConfig: geminiThinkingConfig(GEMINI_LITE_MODEL),
      },
    }),
    signal: new AbortController().signal,
  };
}

export function applyCandidatePick<T>(items: readonly T[], pick: number | 'none' | null): T[] {
  const copy = [...items];
  if (pick === 'none' || pick == null) return copy;
  const index = pick - 1;
  if (!Number.isInteger(index) || index < 0 || index >= copy.length) return copy;
  const [chosen] = copy.splice(index, 1);
  copy.unshift(chosen);
  return copy;
}

export function parseCandidatePick(body: string, limit: number): number | 'none' | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const text = candidateText(parsed);
  if (!text) return null;
  let pick: unknown;
  try {
    pick = (JSON.parse(text) as { pick?: unknown }).pick;
  } catch {
    return null;
  }
  if (pick === 'none') return 'none';
  const number = typeof pick === 'number' ? pick : Number(pick);
  if (!Number.isInteger(number) || number < 1 || number > limit) return null;
  return number;
}

export async function rerankCandidates<T extends RankCandidate>(input: {
  photo: { mediaType: string; bytes: Uint8Array };
  candidates: readonly T[];
  apiKey: string | null;
  complete: (request: GeminiHttpRequest) => Promise<GeminiHttpResponse>;
  loadImage?: (url: string) => Promise<{ mimeType: string; bytes: Uint8Array } | null>;
}): Promise<{ candidates: T[]; called: boolean }> {
  const head = input.candidates.slice(0, RANK_LIMIT);
  const rest = input.candidates.slice(RANK_LIMIT);
  if (!input.apiKey || head.length === 0) return { candidates: [...input.candidates], called: false };
  const images: ({ mimeType: string; base64: string } | null)[] = [];
  for (const item of head) {
    const url = item.imageUrl && allowedCandidateImage(item.imageUrl) ? item.imageUrl : null;
    const image = url && input.loadImage ? await input.loadImage(url) : null;
    images.push(image ? { mimeType: image.mimeType, base64: Buffer.from(image.bytes).toString('base64') } : null);
  }
  const request = geminiRerankRequest(
    { mediaType: input.photo.mediaType, base64: Buffer.from(input.photo.bytes).toString('base64') },
    head.map((item, index) => ({ title: item.title, image: images[index] })),
    input.apiKey,
  );
  if (!request) return { candidates: [...input.candidates], called: false };
  try {
    const response = await input.complete(request);
    if (response.status !== 200) return { candidates: [...input.candidates], called: true };
    const pick = parseCandidatePick(response.body, head.length);
    if (pick == null) return { candidates: [...input.candidates], called: true };
    return { candidates: [...applyCandidatePick(head, pick), ...rest], called: true };
  } catch {
    return { candidates: [...input.candidates], called: true };
  }
}

function candidateText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== 'object') return null;
  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== 'object') return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const record = part as { text?: unknown; thought?: unknown };
    if (record.thought === true) return '';
    return typeof record.text === 'string' ? record.text : '';
  }).join('').trim();
  return text || null;
}
