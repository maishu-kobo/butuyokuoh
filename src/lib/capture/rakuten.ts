// 楽天市場の商品検索。通信とキーは外から渡し、キーが無い店は利用不可にする。
import {
  acceptCandidate,
  captureFailure,
  isValidJan,
  type CaptureCandidate,
  type CaptureResult,
  type SearchQuery,
  type SiteSearch,
} from './contract';

export const RAKUTEN_SEARCH_TIMEOUT_MS = 6000;
export const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

export const RAKUTEN_CREDIT = {
  label: 'Supported by Rakuten Developers',
  url: 'https://webservice.rakuten.co.jp/',
} as const;

export const RakutenMessages = {
  unavailable: '楽天市場の検索は利用できません。商品名を入れて登録してください',
  globalRate: '楽天市場の検索は全体で1秒に1回までです',
  userMinute: '楽天市場の検索は1人につき1分に5回までです',
  userDay: '楽天市場の検索は1人につき1日に50回までです',
  timeout: '楽天市場の検索が時間内に終わりませんでした',
  failed: '楽天市場の候補を取得できませんでした',
  unusable: '楽天市場の候補を確認できませんでした',
  upstreamRate: '楽天市場の検索が混み合っています。しばらくしてからもう一度試してください',
} as const;

const GLOBAL_INTERVAL_MS = 1000;
const USER_MINUTE_MS = 60_000;
const USER_MINUTE_MAX = 5;
const USER_DAY_MS = 24 * 60 * 60 * 1000;
const USER_DAY_MAX = 50;
const KEYWORD_MAX_BYTES = 128;

export interface RakutenCredentials {
  applicationId: string;
  accessKey: string;
}

export interface RakutenHttpRequest {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface RakutenHttpResponse {
  status: number;
  body: string;
}

export type RakutenHttp = (request: RakutenHttpRequest) => Promise<RakutenHttpResponse>;

export interface RakutenLimiter {
  tryAcquire(userId: string, nowMs: number): { ok: true } | { ok: false; reason: string };
}

export function createRakutenLimiter(): RakutenLimiter {
  let lastGlobal = Number.NEGATIVE_INFINITY;
  const users = new Map<string, number[]>();
  return {
    tryAcquire(userId, nowMs) {
      const id = userId.trim() || 'anonymous';
      const stamps = (users.get(id) ?? []).filter(stamp => nowMs - stamp < USER_DAY_MS);
      if (stamps.filter(stamp => nowMs - stamp < USER_MINUTE_MS).length >= USER_MINUTE_MAX) {
        remember(users, id, stamps);
        return { ok: false, reason: RakutenMessages.userMinute };
      }
      if (stamps.length >= USER_DAY_MAX) {
        remember(users, id, stamps);
        return { ok: false, reason: RakutenMessages.userDay };
      }
      if (nowMs - lastGlobal < GLOBAL_INTERVAL_MS) {
        remember(users, id, stamps);
        return { ok: false, reason: RakutenMessages.globalRate };
      }
      stamps.push(nowMs);
      users.set(id, stamps);
      lastGlobal = nowMs;
      return { ok: true };
    },
  };
}

export function createRakutenSearch(options: {
  credentials: RakutenCredentials | null;
  http: RakutenHttp;
  limiter: RakutenLimiter;
  userId?: string;
  now?: () => Date;
  timeoutMs?: number;
  referer?: string | null;
}): SiteSearch {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? RAKUTEN_SEARCH_TIMEOUT_MS;
  const userId = options.userId?.trim() || 'anonymous';
  return {
    async search(query) {
      const credentials = normalizeCredentials(options.credentials);
      if (!credentials) return captureFailure('SEARCH_FAILED', RakutenMessages.unavailable, 503);
      const referer = safeReferer(options.referer);
      if (referer === false) return captureFailure('SEARCH_FAILED', RakutenMessages.unavailable, 503);
      const keyword = rakutenKeyword(query);
      if (!keyword) return captureFailure('SEARCH_FAILED', RakutenMessages.failed, 400);
      const slot = options.limiter.tryAcquire(userId, now().getTime());
      if (!slot.ok) return captureFailure('SEARCH_FAILED', slot.reason, 429);

      const url = new URL(RAKUTEN_ENDPOINT);
      url.searchParams.set('applicationId', credentials.applicationId);
      url.searchParams.set('keyword', keyword);
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatVersion', '2');
      const headers: Record<string, string> = { accessKey: credentials.accessKey };
      if (referer) headers.Referer = referer;

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await Promise.race([
          options.http({ url: url.toString(), method: 'GET', headers, signal: controller.signal }),
          aborted(controller.signal),
        ]);
        if (timedOut || controller.signal.aborted) return captureFailure('SEARCH_TIMEOUT', RakutenMessages.timeout, 504);
        return parseRakutenResponse(response, now().toISOString());
      } catch {
        if (timedOut || controller.signal.aborted) return captureFailure('SEARCH_TIMEOUT', RakutenMessages.timeout, 504);
        return captureFailure('SEARCH_FAILED', RakutenMessages.failed, 502);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function remember(users: Map<string, number[]>, id: string, stamps: number[]) {
  if (stamps.length === 0) users.delete(id);
  else users.set(id, stamps);
}

function hasHeaderBreak(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

function normalizeCredentials(value: RakutenCredentials | null): RakutenCredentials | null {
  if (!value || typeof value.applicationId !== 'string' || typeof value.accessKey !== 'string') return null;
  if (hasHeaderBreak(value.accessKey)) return null;
  const applicationId = value.applicationId.trim();
  const accessKey = value.accessKey.trim();
  if (!applicationId || !accessKey) return null;
  return { applicationId, accessKey };
}

function safeReferer(value: string | null | undefined): string | null | false {
  if (value == null || value === '') return null;
  if (hasHeaderBreak(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  return value;
}

function canonicalItemUrl(raw: string): string | null {
  if (/[\u0000-\u0020\\]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (parsed.hostname !== 'item.rakuten.co.jp') return null;
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

function rakutenKeyword(query: SearchQuery): string {
  if (query.jan && isValidJan(query.jan)) return query.jan;
  const parts = [query.name, query.brand ?? '', query.model ?? ''].map(part => part.trim()).filter(Boolean);
  return truncateUtf8(parts.join(' '), KEYWORD_MAX_BYTES);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const chars = Array.from(value);
  const encoder = new TextEncoder();
  let bytes = 0;
  let count = 0;
  for (const char of chars) {
    const size = encoder.encode(char).byteLength;
    if (bytes + size > maxBytes) break;
    bytes += size;
    count += 1;
  }
  return chars.slice(0, count).join('');
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error('timeout'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
}

function parseRakutenResponse(response: RakutenHttpResponse, fetchedAt: string): CaptureResult<CaptureCandidate[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return captureFailure('SEARCH_FAILED', RakutenMessages.failed, 502);
  }
  if (response.status === 429) return captureFailure('SEARCH_FAILED', RakutenMessages.upstreamRate, 429);
  if (response.status < 200 || response.status >= 300 || readApiError(parsed)) {
    return captureFailure('SEARCH_FAILED', RakutenMessages.failed, 502);
  }
  const items = readItems(parsed);
  if (!items) return captureFailure('SEARCH_FAILED', RakutenMessages.failed, 502);
  const used = new Set<string>();
  const candidates: CaptureCandidate[] = [];
  items.forEach((raw, index) => {
    const candidate = toCandidate(unwrapItem(raw), index, used, fetchedAt);
    if (!candidate) return;
    const accepted = acceptCandidate(candidate);
    if (accepted) candidates.push(accepted);
  });
  if (items.length > 0 && candidates.length === 0) return captureFailure('SEARCH_FAILED', RakutenMessages.unusable, 502);
  return { ok: true, value: candidates };
}

function readItems(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const list = record.items ?? record.Items;
  return Array.isArray(list) ? list : null;
}

function unwrapItem(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const nested = record.item ?? record.Item;
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  return record;
}

function toCandidate(item: Record<string, unknown> | null, index: number, used: Set<string>, fetchedAt: string): CaptureCandidate | null {
  if (!item) return null;
  const title = text(item.itemName);
  const shopName = text(item.shopName);
  const url = typeof item.itemUrl === 'string' ? canonicalItemUrl(item.itemUrl) : null;
  const price = integerPrice(item.itemPrice);
  const id = makeId(text(item.itemCode) ?? '', index, used);
  if (!title || !shopName || !url || price === null || !id) return null;
  const candidate: CaptureCandidate = {
    id,
    site: 'rakuten',
    title: truncateChars(title, 200),
    price,
    url,
    fetchedAt,
    shopName: truncateChars(shopName, 80),
  };
  const jan = text(item.janCode);
  if (jan && isValidJan(jan)) candidate.jan = jan;
  const imageUrl = firstImage(item.mediumImageUrls);
  if (imageUrl) candidate.imageUrl = imageUrl;
  return candidate;
}

function makeId(itemCode: string, index: number, used: Set<string>): string | null {
  const slug = itemCode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let body = (slug || `item-${index + 1}`).slice(0, 64);
  let id = `rakuten:${body}`;
  if (used.has(id)) {
    const suffix = `-${index + 1}`;
    body = `${body.slice(0, Math.max(0, 64 - suffix.length))}${suffix}`;
    id = `rakuten:${body}`;
  }
  if (!/^[a-z0-9-]{1,64}$/.test(body) || used.has(id)) return null;
  used.add(id);
  return id;
}

function firstImage(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const raw = typeof entry === 'string'
      ? entry
      : entry && typeof entry === 'object' && 'imageUrl' in entry
        ? (entry as { imageUrl?: unknown }).imageUrl
        : null;
    if (typeof raw !== 'string') continue;
    const image = canonicalItemUrl(raw);
    if (image) return image;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function integerPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function truncateChars(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

function readApiError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error_description === 'string' && record.error_description.trim()) return record.error_description.trim();
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  const errors = record.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const message = errorMessage(entry);
      if (message) return message;
    }
  }
  return errorMessage(errors);
}

function errorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.errorMessage === 'string' && record.errorMessage.trim()) return record.errorMessage.trim();
  if (typeof record.error_description === 'string' && record.error_description.trim()) return record.error_description.trim();
  return null;
}

