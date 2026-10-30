// CAPTURE_WEB_LOOKUP=wikipedia のときだけ。既定では呼ばない。
// 印刷された型番が無い端末を、Wikipedia の抜粋と flash-lite で1回だけ特定する。
import type { CaptureResult, IdentifyInput, IdentifyResponse, ProductGuess } from './contract';
import { appFlashLedger, geminiQuotaExhausted, withFlashRetry, type FlashLedger } from './flash-fallback';
import { GEMINI_LITE_MODEL, geminiGenerateUrl, geminiThinkingConfig, type GeminiHttpRequest, type GeminiHttpResponse } from './gemini';
import { deviceCategory, productLine } from './product-query';

export const WIKIPEDIA_USER_AGENT = 'Butuyokuoh/1.0 (photo product lookup; https://butsuyokuoh.exe.xyz/)';
export const WIKIPEDIA_TIMEOUT_MS = 3_000;
const PAGE_LIMIT = 4;
const SNIPPET_CHARS = 1_600;
const TOTAL_CHARS = 6_000;

const SENSITIVE = [
  'スマートフォン', 'スマホ', 'tablet', 'タブレット', 'ipad',
  'ノートパソコン', 'laptop', 'macbook',
  'カメラ', 'camera',
  'ゲーム機', 'ゲームコンソール', 'playstation', 'switch', 'xbox',
  'ヘッドホン', 'ヘッドフォン', 'headphone',
  '腕時計', 'watch',
  'pixel', 'galaxy', 'iphone', 'xperia',
];

export type WikiFetch = (url: string, init: {
  method: 'GET';
  redirect: 'manual';
  headers: Record<string, string>;
  signal: AbortSignal;
}) => Promise<{ status: number; body: string }>;

export interface WikiPick {
  model: string;
  confidence: 'high' | 'low' | 'unknown';
  evidence: string;
}

export function wikipediaLookupEnabled(env?: { CAPTURE_WEB_LOOKUP?: string }): boolean {
  const source = (env ?? process.env) as { CAPTURE_WEB_LOOKUP?: string };
  return source.CAPTURE_WEB_LOOKUP?.trim() === 'wikipedia';
}

export function modelSensitiveText(text: string): boolean {
  const folded = text.normalize('NFKC').toLocaleLowerCase('en-US');
  if (deviceCategory(text)) return true;
  return SENSITIVE.some((word) => folded.includes(word.normalize('NFKC').toLocaleLowerCase('en-US')));
}

export function printedModelNumber(product: ProductGuess, visibleText = ''): boolean {
  if (/\d/.test(visibleText)) return true;
  return Boolean(product.model && /\d/.test(product.model));
}

export function needsWikipediaLookup(product: ProductGuess, visibleText = ''): boolean {
  if (!product.brand?.trim()) return false;
  const series = product.series?.trim() || productLine(`${product.name} ${product.model ?? ''}`)?.label;
  if (!series) return false;
  if (!modelSensitiveText(`${product.name} ${series}`)) return false;
  return !printedModelNumber(product, visibleText);
}

export function wikipediaQueries(product: ProductGuess): { first: string; fallback: string | null } {
  const brand = product.brand?.trim() ?? '';
  const series = product.series?.trim() || productLine(`${product.name} ${product.model ?? ''}`)?.label || '';
  if (!brand || !series) return { first: '', fallback: null };
  const plain = `${brand} ${series}`;
  if (product.formFactor === 'foldable') return { first: `${plain} foldable`, fallback: plain };
  return { first: plain, fallback: null };
}

export function allowedWikipediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && /^[a-z]{2}\.wikipedia\.org$/.test(url.hostname)
      && url.pathname === '/w/api.php'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function wikipediaSearchUrl(lang: 'en' | 'ja', query: string): string | null {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', query);
  url.searchParams.set('srlimit', String(PAGE_LIMIT));
  url.searchParams.set('utf8', '1');
  return allowedWikipediaUrl(url.toString()) ? url.toString() : null;
}

export function wikipediaParseUrl(lang: 'en' | 'ja', title: string): string | null {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'wikitext');
  url.searchParams.set('page', title);
  return allowedWikipediaUrl(url.toString()) ? url.toString() : null;
}

export function wikipediaTitles(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows = (parsed as { query?: { search?: { title?: unknown }[] } })?.query?.search;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => row?.title).filter((title): title is string => typeof title === 'string' && title.trim().length > 0).slice(0, PAGE_LIMIT);
}

export function wikipediaWikitext(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return '';
  }
  const text = (parsed as { parse?: { wikitext?: unknown } })?.parse?.wikitext;
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object' && typeof (text as { '*'?: unknown })['*'] === 'string') return (text as { '*': string })['*'];
  return '';
}

export function trimWikiText(wikitext: string): string {
  const text = wikitext.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ').replace(/\{\{[^{}]*\}\}/g, ' ');
  const lead = (text.split(/\n==[^=]/)[0] ?? '').slice(0, 900);
  const sections: string[] = [];
  const pattern = /(?:^|\n)==+\s*([^=\n]+?)\s*==+\s*\n([\s\S]*?)(?=\n==+|$)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!/design|color|colour|デザイン|カラー|外観|^色$/i.test(match[1] ?? '')) continue;
    sections.push(`${match[1]}\n${(match[2] ?? '').slice(0, 900)}`);
  }
  return [lead, ...sections].join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, SNIPPET_CHARS);
}

export function parseWikiPick(body: string): WikiPick | null {
  const text = geminiText(body);
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { model?: unknown; confidence?: unknown; evidence?: unknown };
  const confidence = record.confidence === 'high' || record.confidence === 'low' || record.confidence === 'unknown'
    ? record.confidence
    : null;
  if (!confidence || typeof record.model !== 'string') return null;
  return {
    model: record.model.replace(/\s+/g, ' ').trim().slice(0, 80),
    confidence,
    evidence: typeof record.evidence === 'string' ? record.evidence.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
  };
}

export function applyHighConfidenceModel(product: ProductGuess, pick: WikiPick | null): ProductGuess {
  if (!pick || pick.confidence !== 'high') return product;
  const model = pick.model.trim();
  if (!model || /^unknown$/i.test(model) || model === '不明') return product;
  const brand = product.brand?.trim() ?? '';
  const name = brand && !model.normalize('NFKC').toLocaleLowerCase('en-US').includes(brand.normalize('NFKC').toLocaleLowerCase('en-US'))
    ? `${brand} ${model}`
    : model;
  return { ...product, name, model };
}

export async function attachWikipediaModel(
  photo: IdentifyInput,
  result: CaptureResult<IdentifyResponse>,
  deps?: {
    env?: { CAPTURE_WEB_LOOKUP?: string; GEMINI_API_KEY?: string };
    wikiFetch?: WikiFetch;
    complete?: (request: GeminiHttpRequest) => Promise<GeminiHttpResponse>;
    ledger?: FlashLedger;
    now?: number;
  },
): Promise<CaptureResult<IdentifyResponse>> {
  if (!result.ok || !result.value.products[0]) return result;
  if (!wikipediaLookupEnabled(deps?.env)) return result;
  const product = result.value.products[0];
  const visible = result.value.evidence?.visibleText ?? '';
  if (!needsWikipediaLookup(product, visible)) return result;
  const ledger = deps?.ledger ?? appFlashLedger();
  const now = deps?.now ?? Date.now();
  if (ledger.blocked(now)) return result;
  const key = geminiKey(deps?.env);
  if (!key) return result;
  try {
    const snippets = await collectSnippets(product, deps?.wikiFetch ?? defaultWikiFetch);
    if (!snippets) return result;
    let lastStatus = 0;
    let lastBody = '';
    const ran = await withFlashRetry({
      run: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WIKIPEDIA_TIMEOUT_MS);
        try {
          const request = liteRequest(photo, snippets, key, controller.signal);
          const response = deps?.complete ? await deps.complete(request) : await postGemini(request);
          lastStatus = response.status;
          lastBody = response.body;
          return { status: response.status, body: response.body, value: parseWikiPick(response.body) };
        } finally {
          clearTimeout(timer);
        }
      },
    });
    if (geminiQuotaExhausted(lastStatus, lastBody) || ran.quotaExceeded) {
      ledger.trip(now);
      return result;
    }
    const next = applyHighConfidenceModel(product, ran.value);
    if (next === product) return result;
    return { ...result, value: { ...result.value, products: [next, ...result.value.products.slice(1)] } };
  } catch {
    return result;
  }
}

async function collectSnippets(product: ProductGuess, wikiFetch: WikiFetch): Promise<string | null> {
  const plan = wikipediaQueries(product);
  if (!plan.first) return null;
  let titles = await searchBoth(plan.first, wikiFetch);
  if (titles.length === 0 && plan.fallback) titles = await searchBoth(plan.fallback, wikiFetch);
  const pages = titles.slice(0, PAGE_LIMIT);
  const parts: string[] = [];
  for (const page of pages) {
    const snippet = await readPage(page, wikiFetch);
    if (!snippet) continue;
    parts.push(`# ${page.lang}:${page.title}\n${snippet}`);
    if (parts.join('\n').length >= TOTAL_CHARS) break;
  }
  const text = parts.join('\n').slice(0, TOTAL_CHARS).trim();
  return text || null;
}

async function searchBoth(query: string, wikiFetch: WikiFetch): Promise<{ lang: 'en' | 'ja'; title: string }[]> {
  const found: { lang: 'en' | 'ja'; title: string }[] = [];
  for (const lang of ['en', 'ja'] as const) {
    const jaQuery = lang === 'ja' && query.endsWith(' foldable') ? query.replace(/ foldable$/, ' 折りたたみ') : query;
    const url = wikipediaSearchUrl(lang, jaQuery);
    if (!url) continue;
    const response = await wikiFetch(url, wikiInit());
    if (response.status !== 200) continue;
    for (const title of wikipediaTitles(response.body)) {
      if (found.some((item) => item.lang === lang && item.title === title)) continue;
      found.push({ lang, title });
    }
  }
  return found;
}

async function readPage(page: { lang: 'en' | 'ja'; title: string }, wikiFetch: WikiFetch): Promise<string | null> {
  const url = wikipediaParseUrl(page.lang, page.title);
  if (!url) return null;
  const response = await wikiFetch(url, wikiInit());
  if (response.status !== 200) return null;
  const text = trimWikiText(wikipediaWikitext(response.body));
  return text || null;
}

function wikiInit(): { method: 'GET'; redirect: 'manual'; headers: Record<string, string>; signal: AbortSignal } {
  return {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'User-Agent': WIKIPEDIA_USER_AGENT,
      'Api-User-Agent': WIKIPEDIA_USER_AGENT,
    },
    signal: new AbortController().signal,
  };
}

function liteRequest(photo: IdentifyInput, snippets: string, apiKey: string, signal: AbortSignal): GeminiHttpRequest {
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
          { text: wikiInstruction(snippets) },
          { inlineData: { mimeType: photo.mediaType, data: Buffer.from(photo.bytes).toString('base64') } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            model: { type: 'STRING' },
            confidence: { type: 'STRING', enum: ['high', 'low', 'unknown'] },
            evidence: { type: 'STRING' },
          },
          required: ['model', 'confidence', 'evidence'],
        },
        thinkingConfig: geminiThinkingConfig(GEMINI_LITE_MODEL),
      },
    }),
    signal,
  };
}

function wikiInstruction(snippets: string): string {
  return [
    '写真と、下のWikipedia抜粋だけを見て、世代まで含む型番を1つ選ぶ。',
    '抜粋に無い型番は書かない。色や形が抜粋と合わなければ unknown。',
    'confidenceは、抜粋の色や形が写真と合うときだけ high。曖昧なら low。選べなければ unknown。',
    'evidenceには、選んだ根拠を短く書く。',
    '{"model":"","confidence":"high"|"low"|"unknown","evidence":""}',
    '抜粋:',
    snippets,
  ].join('');
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

async function defaultWikiFetch(url: string, init: {
  method: 'GET';
  redirect: 'manual';
  headers: Record<string, string>;
  signal: AbortSignal;
}): Promise<{ status: number; body: string }> {
  if (!allowedWikipediaUrl(url)) return { status: 0, body: '' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WIKIPEDIA_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status >= 300 && response.status < 400) return { status: response.status, body: '' };
    return { status: response.status, body: (await response.text()).slice(0, 100_000) };
  } catch {
    return { status: 0, body: '' };
  } finally {
    clearTimeout(timer);
  }
}
