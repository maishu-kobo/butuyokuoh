// Yahoo!ショッピング商品検索API v3。
// アプリIDと通信は呼び出し側が渡す。キーの読み込みは #87。無いときはこの店だけ利用不可。
import {
  CaptureMessages,
  acceptCandidate,
  captureFailure,
  isValidJan,
  type CaptureCandidate,
  type CaptureResult,
  type SearchQuery,
  type SiteSearch,
} from './contract';

const YAHOO_ITEM_SEARCH = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
const TIMEOUT_MS = 6_000;
const RESULT_COUNT = 10;
const MAX_BODY_CHARS = 1_000_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const UNAVAILABLE = 'この店の検索は使えません。商品名を入れて手入力してください';
const TIMEOUT = '候補の取得が時間内に終わりませんでした';
const UPSTREAM_LIMITED = 'Yahoo!ショッピングの検索が制限されています';

const LIMIT_MESSAGE = {
  second: '全体の検索は1秒に1回までです',
  minute: '全体の検索は1分に25回までです',
  'user-minute': 'この検索は1分に5回までです',
  'user-day': 'この検索は1日に50回までです',
} as const;

export type YahooLimit = keyof typeof LIMIT_MESSAGE;

export type YahooRequest = {
  method: 'GET';
  redirect: 'manual';
  cache: 'no-store';
  signal: AbortSignal;
  headers: { Accept: string };
};

export type YahooFetch = (url: string, init: YahooRequest) => Promise<Response>;

export type YahooSchedule = (callback: () => void, delayMs: number) => () => void;

export type YahooRateGate = {
  take(userId: string, now: number): YahooLimit | null;
};

export type YahooSearchDeps = {
  appId: string | null;
  userId?: string | null;
  fetch?: YahooFetch;
  now?: () => number;
  gate?: YahooRateGate;
  schedule?: YahooSchedule;
};

export function createYahooRateGate(): YahooRateGate {
  const globalHits: number[] = [];
  const users = new Map<string, number[]>();

  return {
    take(userId, now) {
      const id = userId.trim().slice(0, 64) || 'anonymous';
      const recent = globalHits.filter(time => now - time < MINUTE_MS);
      globalHits.length = 0;
      globalHits.push(...recent);
      if (globalHits.some(time => now - time < 1_000)) return 'second';
      if (globalHits.length >= 25) return 'minute';

      const history = (users.get(id) ?? []).filter(time => now - time < DAY_MS);
      if (history.filter(time => now - time < MINUTE_MS).length >= 5) {
        users.set(id, history);
        return 'user-minute';
      }
      if (history.length >= 50) {
        users.set(id, history);
        return 'user-day';
      }
      globalHits.push(now);
      history.push(now);
      users.set(id, history);
      return null;
    },
  };
}

const sharedGate = createYahooRateGate();

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function failed(): CaptureResult<never> {
  return captureFailure('SEARCH_FAILED', CaptureMessages.searchFailed, 502);
}

function usableAppId(value: string | null): string | null {
  if (!value) return null;
  const appId = value.trim();
  if (!appId || appId.length > 200 || /[\u0000-\u001F\u007F]/.test(appId)) return null;
  return appId;
}

function requestUrl(appId: string, query: SearchQuery): string | null {
  const url = new URL(YAHOO_ITEM_SEARCH);
  url.searchParams.set('appid', appId);
  url.searchParams.set('results', String(RESULT_COUNT));
  if (query.jan && isValidJan(query.jan)) {
    url.searchParams.set('jan_code', query.jan);
  } else {
    const keyword = [query.name, query.brand, query.model]
      .filter((part): part is string => typeof part === 'string')
      .map(part => part.trim())
      .filter(part => part.length > 0)
      .join(' ')
      .slice(0, 400);
    if (!keyword) return null;
    url.searchParams.set('query', keyword);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'shopping.yahooapis.jp') return null;
  return url.toString();
}

// 検索語は URLSearchParams でエンコードする。応答の商品名はタグを除いた文字列にする。
// 画面側の React がもう一度エスケープするので、ここでは実体参照にしない。
function plainText(raw: string, max: number): string {
  let out = '';
  let inTag = false;
  for (const char of raw.replace(/[\u0000-\u001F\u007F]/g, '')) {
    if (char === '<') {
      inTag = true;
      continue;
    }
    if (char === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) out += char;
  }
  const cleaned = out.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max).trim();
}

function yahooId(code: string, used: Set<string>): string | null {
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return null;
  const base = slug.slice(0, 64);
  const candidates = [`yahoo:${base}`];
  for (let number = 2; number < 100; number += 1) {
    const suffix = `-${number}`;
    const trimmed = base.slice(0, 64 - suffix.length);
    if (trimmed) candidates.push(`yahoo:${trimmed}${suffix}`);
  }
  const id = candidates.find(item => !used.has(item));
  if (!id) return null;
  used.add(id);
  return id;
}

function canonicalProductUrl(raw: string): string | null {
  if (/[\u0000-\u0020\\]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (parsed.hostname !== 'shopping.yahoo.co.jp' && parsed.hostname !== 'store.shopping.yahoo.co.jp') return null;
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

function imageUrl(hit: Record<string, unknown>): string | undefined {
  const image = hit.image;
  if (!image || typeof image !== 'object') return undefined;
  const record = image as { medium?: unknown; small?: unknown };
  for (const candidate of [record.medium, record.small]) {
    if (typeof candidate !== 'string') continue;
    const safe = canonicalProductUrl(candidate);
    if (safe) return safe;
  }
  return undefined;
}

function toCandidate(value: unknown, fetchedAt: string, used: Set<string>): CaptureCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const hit = value as Record<string, unknown>;
  if (typeof hit.code !== 'string') return null;
  const id = yahooId(hit.code, used);
  if (!id) return null;
  const reject = () => {
    used.delete(id);
    return null;
  };
  const title = typeof hit.name === 'string' ? plainText(hit.name, 200) : '';
  const seller = hit.seller && typeof hit.seller === 'object' ? (hit.seller as { name?: unknown }).name : undefined;
  const shopName = typeof seller === 'string' ? plainText(seller, 80) : '';
  if (!title || !shopName) return reject();
  if (typeof hit.price !== 'number' || !Number.isSafeInteger(hit.price) || hit.price < 0) return reject();
  if (typeof hit.url !== 'string') return reject();
  const url = canonicalProductUrl(hit.url);
  if (!url) return reject();
  const draft: CaptureCandidate = {
    id,
    site: 'yahoo',
    title,
    price: hit.price,
    url,
    fetchedAt,
    shopName,
  };
  if (typeof hit.janCode === 'string' && isValidJan(hit.janCode)) draft.jan = hit.janCode;
  const image = imageUrl(hit);
  if (image) draft.imageUrl = image;
  const accepted = acceptCandidate(draft);
  if (!accepted) used.delete(id);
  return accepted;
}

function mapHits(body: unknown, fetchedAt: string): CaptureResult<CaptureCandidate[]> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return failed();
  const hits = (body as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return failed();
  const limited = hits.slice(0, RESULT_COUNT);
  const used = new Set<string>();
  const candidates = limited
    .map(hit => toCandidate(hit, fetchedAt, used))
    .filter((item): item is CaptureCandidate => item !== null);
  if (limited.length > 0 && candidates.length === 0) return failed();
  return { ok: true, value: candidates };
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 中断した応答の本体は読まない。
  }
}

async function readLimited(response: Response): Promise<string | null> {
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_BODY_CHARS) {
    await discard(response);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > MAX_BODY_CHARS) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (text.length > MAX_BODY_CHARS) return null;
  return text;
}

function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => {
      const error = new Error('timeout');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export function createYahooSearch(deps: YahooSearchDeps): SiteSearch {
  const fetchImpl = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = deps.now ?? Date.now;
  const gate = deps.gate ?? sharedGate;
  const schedule = deps.schedule ?? defaultSchedule;
  const userId = deps.userId ?? 'anonymous';

  return {
    async search(query) {
      if (typeof globalThis.window !== 'undefined') {
        throw new Error('yahoo search is server-only');
      }
      const appId = usableAppId(deps.appId);
      if (!appId) return captureFailure('SEARCH_FAILED', UNAVAILABLE, 503);
      const url = requestUrl(appId, query);
      if (!url) return captureFailure('INVALID_INPUT', CaptureMessages.searchInput, 400);
      const at = now();
      const limit = gate.take(userId, at);
      if (limit) return captureFailure('SEARCH_FAILED', LIMIT_MESSAGE[limit], 429);

      const controller = new AbortController();
      const cancel = schedule(() => controller.abort(), TIMEOUT_MS);
      const aborted = whenAborted(controller.signal);
      void aborted.catch(() => undefined);
      try {
        const response = await Promise.race([
          fetchImpl(url, {
            method: 'GET',
            redirect: 'manual',
            cache: 'no-store',
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          }),
          aborted,
        ]);
        if (controller.signal.aborted) {
          await discard(response);
          return captureFailure('SEARCH_TIMEOUT', TIMEOUT, 504);
        }
        if (response.status === 429) {
          await discard(response);
          return captureFailure('SEARCH_FAILED', UPSTREAM_LIMITED, 429);
        }
        if (response.status < 200 || response.status >= 300) {
          await discard(response);
          return failed();
        }
        const text = await readLimited(response);
        if (text === null) return failed();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
        } catch {
          return failed();
        }
        return mapHits(parsed, new Date(at).toISOString());
      } catch (error) {
        if (isAbort(error, controller.signal)) return captureFailure('SEARCH_TIMEOUT', TIMEOUT, 504);
        return failed();
      } finally {
        cancel();
      }
    },
  };
}
