// CAPTURE_WEB_LOOKUP=ec のときだけ。wikipedia と並べるときは ec,wikipedia。既定では呼ばない。
// シリーズの店の候補から、番号で1件だけ選ばせる。一覧に無い型番は使わない。
import type { CaptureResult, IdentifyInput, IdentifyResponse, ProductGuess } from './contract';
import { appFlashLedger, geminiQuotaExhausted, withFlashRetry, type FlashLedger } from './flash-fallback';
import { GEMINI_LITE_MODEL, geminiGenerateUrl, geminiThinkingConfig, type GeminiHttpRequest, type GeminiHttpResponse } from './gemini';
import { deviceCategory, dominantTypeGroup, nameIsColorAndType, productLine, statedProductType } from './product-query';
import { needsWikipediaLookup, printedModelNumber, webLookupHas } from './wikipedia-lookup';

export const EC_LISTING_LIMIT = 20;

const FASHION = new Set(['shoes', 'bags', 'shirts', 'jackets', 'jeans', 'caps', 'socks']);
const NOT_BODY = /(ケース|カバー|フィルム|ギフトカード|ギフト券|プリペイド|部品|パーツ|交換|保護ガラス|\bcase\b|\bcover\b|\bfilm\b|\bgift\b|\bparts?\b)/i;

export function ecLookupEnabled(env?: { CAPTURE_WEB_LOOKUP?: string }): boolean {
  return webLookupHas('ec', env);
}

export function needsEcLookup(product: ProductGuess, visibleText = ''): boolean {
  if (!product.brand?.trim()) return false;
  const series = product.series?.trim() || productLine(`${product.name} ${product.model ?? ''}`)?.label;
  if (!series) return false;
  if (printedModelNumber(product, visibleText)) return false;
  if (needsWikipediaLookup(product, visibleText)) return true;
  const group = dominantTypeGroup(product.name);
  return Boolean(group && FASHION.has(group) && nameIsColorAndType(product.name));
}

export function ecSeriesQuery(product: ProductGuess): string {
  const brand = product.brand?.trim() ?? '';
  const series = product.series?.trim() || productLine(`${product.name} ${product.model ?? ''}`)?.label || '';
  const type = deviceCategory(`${product.name} ${series}`) || statedProductType(product.name);
  if (product.formFactor === 'foldable') return `${brand} ${series} Fold 本体`.replace(/\s+/g, ' ').trim();
  const body = deviceCategory(`${product.name} ${series}`) ? '本体' : '';
  return [brand, series, type, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function bodyListings(titles: readonly string[], limit = EC_LISTING_LIMIT): string[] {
  const kept: string[] = [];
  for (const title of titles) {
    const cleaned = title.replace(/\s+/g, ' ').trim();
    if (!cleaned || NOT_BODY.test(cleaned)) continue;
    if (kept.includes(cleaned)) continue;
    kept.push(cleaned);
    if (kept.length >= limit) break;
  }
  return kept;
}

export function ecPickInstruction(titles: readonly string[]): string {
  const lines = titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  return [
    '写真と、下の番号付きの商品名だけを比べる。',
    '答えは一覧の番号か none だけ。一覧に無い型番を作ってはいけない。',
    '選んだ番号の商品名に書いてある型番と色だけを使う。別の世代や色を足さない。',
    '{"pick":1,"confidence":"high"} または {"pick":"none","confidence":"none"}',
    'confidenceは high、medium、low、none のどれか。',
    lines,
  ].join('\n');
}

export interface EcPick {
  pick: number | 'none';
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export function parseEcPick(body: string, limit: number): EcPick | null {
  const text = geminiText(body);
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { pick?: unknown; confidence?: unknown };
  const confidence = record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low' || record.confidence === 'none'
    ? record.confidence
    : 'none';
  if (record.pick === 'none' || record.pick === null) return { pick: 'none', confidence };
  const number = typeof record.pick === 'number' ? record.pick : Number(record.pick);
  if (!Number.isInteger(number) || number < 1 || number > limit) return { pick: 'none', confidence: 'none' };
  return { pick: number, confidence };
}

export function applyEcListing(product: ProductGuess, titles: readonly string[], pick: EcPick | null): ProductGuess {
  if (!pick || (pick.confidence !== 'high' && pick.confidence !== 'medium')) return product;
  if (pick.pick === 'none') return product;
  const title = titles[pick.pick - 1];
  if (!title) return product;
  return { ...product, name: title, model: title };
}

export async function attachEcSeriesLookup(
  photo: IdentifyInput,
  result: CaptureResult<IdentifyResponse>,
  deps?: {
    env?: { CAPTURE_WEB_LOOKUP?: string; GEMINI_API_KEY?: string };
    search?: (query: string) => Promise<readonly string[]>;
    complete?: (request: GeminiHttpRequest) => Promise<GeminiHttpResponse>;
    ledger?: FlashLedger;
    now?: number;
  },
): Promise<CaptureResult<IdentifyResponse>> {
  if (!result.ok || !result.value.products[0]) return result;
  if (!ecLookupEnabled(deps?.env)) return result;
  const product = result.value.products[0];
  const visible = result.value.evidence?.visibleText ?? '';
  if (!needsEcLookup(product, visible)) return result;
  const ledger = deps?.ledger ?? appFlashLedger();
  const now = deps?.now ?? Date.now();
  if (ledger.blocked(now)) return result;
  const query = ecSeriesQuery(product);
  if (!query || !deps?.search) return result;
  const key = geminiKey(deps.env);
  if (!key) return result;
  try {
    const listings = bodyListings(await deps.search(query));
    if (listings.length === 0) return result;
    let lastStatus = 0;
    let lastBody = '';
    const ran = await withFlashRetry({
      run: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const request = liteRequest(photo, listings, key, controller.signal);
          const response = deps.complete ? await deps.complete(request) : await postGemini(request);
          lastStatus = response.status;
          lastBody = response.body;
          return { status: response.status, body: response.body, value: parseEcPick(response.body, listings.length) };
        } finally {
          clearTimeout(timer);
        }
      },
    });
    if (geminiQuotaExhausted(lastStatus, lastBody) || ran.quotaExceeded) {
      ledger.trip(now);
      return result;
    }
    const next = applyEcListing(product, listings, ran.value);
    if (next === product) return result;
    return { ...result, value: { ...result.value, products: [next, ...result.value.products.slice(1)] } };
  } catch {
    return result;
  }
}

function liteRequest(photo: IdentifyInput, titles: readonly string[], apiKey: string, signal: AbortSignal): GeminiHttpRequest {
  const url = geminiGenerateUrl(GEMINI_LITE_MODEL) ?? '';
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
      contents: [{
        role: 'user',
        parts: [
          { text: ecPickInstruction(titles) },
          { inlineData: { mimeType: photo.mediaType, data: Buffer.from(photo.bytes).toString('base64') } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 128,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            pick: { type: 'STRING' },
            confidence: { type: 'STRING', enum: ['high', 'medium', 'low', 'none'] },
          },
          required: ['pick', 'confidence'],
        },
        thinkingConfig: geminiThinkingConfig(GEMINI_LITE_MODEL),
      },
    }),
    signal,
  };
}

function geminiKey(env?: { GEMINI_API_KEY?: string }): string | null {
  const source = (env ?? process.env) as { GEMINI_API_KEY?: string };
  const key = source.GEMINI_API_KEY?.trim() ?? '';
  return key.length >= 8 ? key : null;
}

function geminiText(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const parts = (parsed as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.filter((part) => part && part.thought !== true && typeof part.text === 'string').map((part) => part.text).join('').trim();
  return text || null;
}

async function postGemini(request: GeminiHttpRequest): Promise<GeminiHttpResponse> {
  if (!request.url) return { status: 0, body: '' };
  try {
    const response = await fetch(request.url, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
    return { status: response.status, body: (await response.text()).slice(0, 65_536) };
  } catch {
    return { status: 0, body: '' };
  }
}
