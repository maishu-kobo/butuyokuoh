// CAPTURE_WEB_LOOKUP=ec のときだけ。wikipedia と並べるときは ec,wikipedia。既定では呼ばない。
// シリーズの店の候補から、番号で1件だけ選ばせる。一覧に無い型番は使わない。
import type { CaptureResult, IdentifyInput, IdentifyResponse, ProductGuess } from './contract';
import { appFlashLiteLedger, geminiQuotaExhausted, withFlashRetry, type FlashLedger } from './flash-fallback';
import { GEMINI_LITE_MODEL, geminiGenerateUrl, geminiThinkingConfig, type GeminiHttpRequest, type GeminiHttpResponse } from './gemini';
import { deviceCategory, dominantTypeGroup, nameIsColorAndType, productLine, statedProductType } from './product-query';
import { LOOKUP_LITE_TIMEOUT_MS, needsWikipediaLookup, printedModelNumber, webLookupHas } from './wikipedia-lookup';

export const EC_LISTING_LIMIT = 20;

const FASHION = new Set(['shoes', 'bags', 'shirts', 'jackets', 'jeans', 'caps', 'socks']);
const NOT_BODY = /(ケース|カバー|フィルム|ギフトカード|ギフト券|プリペイド|部品|パーツ|交換|保護ガラス|バッテリー|電池|充電器|アダプター|アダプタ|互換|\bcase\b|\bcover\b|\bfilm\b|\bgift\b|\bparts?\b|\bbatter(?:y|ies)\b|\bchargers?\b|\badapters?\b)/i;

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

export function ecSeriesQueries(product: ProductGuess): string[] {
  const brand = product.brand?.trim() ?? '';
  const series = product.series?.trim() || productLine(`${product.name} ${product.model ?? ''}`)?.label || '';
  if (!brand || !series) return [];
  const described = `${product.name} ${series}`;
  if (deviceCategory(described) === 'スマートフォン') {
    return [`${brand} ${series} 本体`, `${brand} ${series} Fold 本体`];
  }
  const type = statedProductType(product.name);
  const body = deviceCategory(described) ? '本体' : '';
  return [[brand, series, type, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()];
}

export function ecSeriesQuery(product: ProductGuess): string {
  return ecSeriesQueries(product)[0] ?? '';
}

export function bodyListings(titles: readonly string[], limit = EC_LISTING_LIMIT, series = ''): string[] {
  const ranked = titles.map((title, index) => ({ title: title.replace(/\s+/g, ' ').trim(), index }))
    .filter((item) => item.title && !NOT_BODY.test(item.title));
  const unique: { title: string; index: number }[] = [];
  for (const item of ranked) {
    if (unique.some((kept) => kept.title === item.title)) continue;
    unique.push(item);
  }
  unique.sort((left, right) => Number(usedListing(left.title)) - Number(usedListing(right.title))
    || generationNumber(right.title, series) - generationNumber(left.title, series)
    || left.index - right.index);
  return unique.slice(0, limit).map((item) => item.title);
}

function usedListing(title: string): boolean {
  return /中古|ジャンク|リファービッシュ|整備済|\bused\b/i.test(title);
}

// 系列名の直後の数字だけを世代にする。16GB や Android15 や 16-ag は世代にしない。
function generationNumber(title: string, series: string): number {
  const label = series.trim();
  if (!label) return 0;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = title.match(new RegExp(`${escaped}\\s*(\\d+)(?![\\d-])(?![A-Za-z]{2})`, 'i'));
  if (!match) return 0;
  const value = Number(match[1]);
  return value > 0 && value < 80 ? value : 0;
}

export function ecPickInstruction(titles: readonly string[], hint = ''): string {
  const lines = titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  return [
    `写真の商品を特定する。最初の見立て: ${hint || '系列は分かっているが型番は未確定'}`,
    '以下は日本の店で系列名を検索した出品タイトルである。知識より新しい機種も含む。',
    'ケース、フィルム、バッテリー、充電器、アダプターは無視する。',
    '写真に見える特徴で選ぶ。ヒンジや折り目、カメラバーの形、色、ロゴ。文字が写っていなくても、形と色で選んでよい。',
    '必ず一覧の番号を1つ選ぶ。選んだタイトルに書いてある機種名だけを使う。一覧に無い機種名は作らない。',
    '色や容量が写真から決まらないときは、機種の系列（例: Pixel 10 Pro Fold）までで止め、色は空でよい。',
    '合う本体が無ければ index は null。',
    '{"index":1,"model":"Pixel 10 Pro Fold","color":"","confidence":"high","evidence":"折り目とカメラバー"}',
    'confidenceは high、medium、low、none のどれか。',
    lines,
  ].join('\n');
}

export interface EcPick {
  pick: number | 'none';
  confidence: 'high' | 'medium' | 'low' | 'none';
  model: string | null;
  color: string | null;
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
  const record = parsed as { pick?: unknown; index?: unknown; confidence?: unknown; model?: unknown; color?: unknown };
  const confidence = record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low' || record.confidence === 'none'
    ? record.confidence
    : 'none';
  const model = plainText(record.model);
  const color = plainText(record.color);
  const raw = record.index ?? record.pick;
  if (raw === 'none' || raw === 'null' || raw === null || raw === undefined || raw === '') {
    return { pick: 'none', confidence, model, color };
  }
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(number) || number < 1 || number > limit) return { pick: 'none', confidence: 'none', model, color };
  return { pick: number, confidence, model, color };
}

function plainText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /^(none|null|不明|なし)$/i.test(text)) return null;
  return text;
}

function folded(value: string): string {
  return value.toLowerCase().replace(/[\s　]+/g, '');
}

export function applyEcListing(product: ProductGuess, titles: readonly string[], pick: EcPick | null): ProductGuess {
  if (!pick || (pick.confidence !== 'high' && pick.confidence !== 'medium')) return product;
  if (pick.pick === 'none') return product;
  const title = titles[pick.pick - 1];
  if (!title || !pick.model || !/\d/.test(pick.model) || !folded(title).includes(folded(pick.model))) return product;
  const color = pick.color && folded(title).includes(folded(pick.color)) && !folded(pick.model).includes(folded(pick.color))
    ? pick.color
    : '';
  const brand = product.brand?.trim() ?? '';
  const model = pick.model.trim();
  const head = brand && folded(model).startsWith(folded(brand)) ? model : [brand, model].filter(Boolean).join(' ');
  const name = [head, color].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { ...product, name, model: [model, color].filter(Boolean).join(' ') };
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
  const ledger = deps?.ledger ?? appFlashLiteLedger();
  const now = deps?.now ?? Date.now();
  if (ledger.blocked(now)) return result;
  const queries = ecSeriesQueries(product);
  if (queries.length === 0 || !deps?.search) return result;
  const key = geminiKey(deps.env);
  if (!key) return result;
  try {
    const series = product.series?.trim() || productLine(`${product.name} ${product.model ?? ''}`)?.label || '';
    const merged: string[] = [];
    for (const query of queries) merged.push(...await deps.search(query));
    const listings = bodyListings(merged, EC_LISTING_LIMIT, series);
    if (listings.length === 0) return result;
    let lastStatus = 0;
    let lastBody = '';
    const ran = await withFlashRetry({
      run: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LOOKUP_LITE_TIMEOUT_MS);
        try {
          const type = statedProductType(product.name) ?? '商品';
          const hint = `${product.brand?.trim() ?? ''} の${type}（${series} 系）`.trim();
          const request = liteRequest(photo, listings, key, controller.signal, hint);
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

function liteRequest(photo: IdentifyInput, titles: readonly string[], apiKey: string, signal: AbortSignal, hint: string): GeminiHttpRequest {
  const url = geminiGenerateUrl(GEMINI_LITE_MODEL) ?? '';
  const image = Buffer.from(photo.bytes).toString('base64');
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
          { inlineData: { mimeType: photo.mediaType, data: image } },
          { text: ecPickInstruction(titles, hint) },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            index: { type: 'INTEGER', nullable: true },
            model: { type: 'STRING', nullable: true },
            color: { type: 'STRING', nullable: true },
            confidence: { type: 'STRING', enum: ['high', 'medium', 'low', 'none'] },
            evidence: { type: 'STRING', nullable: true },
          },
          required: ['confidence', 'evidence'],
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
