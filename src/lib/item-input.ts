// 品目の新規書き込み向け。価格・画像はサーバ取得を優先し、URL と品名を整える。
// エージェント API（#269）からも同じ関数を呼ぶ。

import type Database from 'better-sqlite3';
import { rakutenProductIdentity } from '@/lib/capture/rakuten-link';
import { isStorableItemUrl } from '@/lib/http-url';
import { scrapeGuestUrl } from '@/lib/guest-scraper';
import { isUnusableScrape, scrapeUrl, type ScrapedItem, type ScrapeDeps } from '@/lib/scraper';
import { getSourceFromUrl, validateAndSanitizeUrl } from '@/lib/url-validator';

export const ITEM_NAME_MAX = 200;
export const SERVER_ITEM_MEDIA_TIMEOUT_MS = 20_000;

/** Amazon / 楽天向け。アフィリエイトとトラッキングを広く落とす。 */
const STORE_TRACKING_EXACT = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'gbraid',
  'wbraid',
  'yclid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'igshid',
  'si',
  'tag',
  'ascsubtag',
  'linkcode',
  'linkid',
  'camp',
  'creative',
  'creativeasin',
  'adid',
  'ref_',
]);

const STORE_TRACKING_PREFIXES = ['utm_', 'pk_', 'sc_', 'mc_'] as const;

/** Amazon / 楽天以外。共通の計測パラメータだけ。 */
const GENERIC_TRACKING_EXACT = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'gbraid',
  'wbraid',
  'yclid',
  '_ga',
  '_gl',
  'igshid',
]);

const GENERIC_TRACKING_PREFIXES = ['utm_', 'mc_'] as const;

const AMAZON_KEEP_PARAMS = new Set(['th', 'psc', 'smid', 'asin', 'colid', 'coliid', 'variant']);
const RAKUTEN_KEEP_PARAMS = new Set(['variantid', 's_id', 's']);

type TrackingRules = {
  exact: Set<string>;
  prefixes: readonly string[];
  keep: Set<string>;
};

function isAmazonHost(host: string): boolean {
  return (
    host === 'www.amazon.co.jp' ||
    host === 'www.amazon.jp' ||
    host === 'www.amazon.com' ||
    host === 'amazon.co.jp' ||
    host === 'amazon.jp' ||
    host === 'amazon.com'
  );
}

function isRakutenProductHost(host: string): boolean {
  return (
    host === 'item.rakuten.co.jp' ||
    host === 'books.rakuten.co.jp' ||
    host === 'product.rakuten.co.jp' ||
    host === 'my.bookmark.rakuten.co.jp'
  );
}

function trackingRulesForHost(host: string): TrackingRules {
  if (isAmazonHost(host)) {
    return { exact: STORE_TRACKING_EXACT, prefixes: STORE_TRACKING_PREFIXES, keep: AMAZON_KEEP_PARAMS };
  }
  if (isRakutenProductHost(host) || host === 'hb.afl.rakuten.co.jp') {
    return { exact: STORE_TRACKING_EXACT, prefixes: STORE_TRACKING_PREFIXES, keep: RAKUTEN_KEEP_PARAMS };
  }
  return { exact: GENERIC_TRACKING_EXACT, prefixes: GENERIC_TRACKING_PREFIXES, keep: new Set() };
}

function shouldDropQueryKey(rawKey: string, rules: TrackingRules): boolean {
  let key = rawKey;
  try {
    key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    // 壊れた % エンコードはそのままのキーで判定する
  }
  const lower = key.toLowerCase();
  if (rules.keep.has(lower)) return false;
  if (rules.exact.has(lower)) return true;
  // Amazon / 楽天だけ ref* を落とす（他サイトの ref / tag 等は残す）
  if (rules.exact === STORE_TRACKING_EXACT && lower.startsWith('ref') && lower !== 'refresh') return true;
  return rules.prefixes.some((prefix) => lower.startsWith(prefix));
}

function stripAmazonRefPath(pathname: string): string {
  return pathname.replace(/\/ref(?:=|%3[Dd])[^/]*$/i, '').replace(/\/ref\/[^/]*$/i, '');
}

/**
 * 生の search（? 付き可）を & 分割し、落とすキーの区切りだけ除く。
 * 残りはバイト単位でそのまま。何も落とさなければ null（呼び出し側は URL を変えない）。
 */
export function stripTrackingSearchLossless(search: string, rules: TrackingRules): string | null {
  if (!search) return null;
  const hasQuestion = search.startsWith('?');
  const raw = hasQuestion ? search.slice(1) : search;
  if (!raw) return null;

  const parts = raw.split('&');
  const kept: string[] = [];
  let dropped = false;
  for (const part of parts) {
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key !== '' && shouldDropQueryKey(key, rules)) {
      dropped = true;
      continue;
    }
    kept.push(part);
  }
  if (!dropped) return null;
  if (kept.length === 0) return '';
  return hasQuestion || search.startsWith('?') ? `?${kept.join('&')}` : kept.join('&');
}

function splitUrlPreserve(raw: string, parsed: URL): { head: string; search: string; hash: string } {
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : raw.slice(hashIndex);
  const searchIndex = withoutHash.indexOf('?');
  const head = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex);
  // head はスキーム〜パス。pathname だけ差し替えるときに使う。
  void parsed;
  return { head, search, hash };
}

/**
 * 保存用 URL。トラッキングを無損失で除き、楽天包装は解けるときだけ商品 URL にする。
 * 解けない包装はクリーンアップしたラッパーを残す（拒否しない）。
 */
export function sanitizeStoredItemUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('manual://')) {
    return isStorableItemUrl(value) ? value : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  if (parsed.hostname === 'hb.afl.rakuten.co.jp') {
    const product = rakutenProductIdentity(value);
    if (product) return sanitizeStoredItemUrl(product);
    // 解けない包装はラッパーを残し、計測パラメータだけ落とす。
  }

  const host = parsed.hostname.toLowerCase();
  const rules = trackingRulesForHost(host);
  const { head, search, hash } = splitUrlPreserve(value, parsed);

  let nextHead = head;
  let pathChanged = false;
  if (isAmazonHost(host)) {
    const cleanedPath = stripAmazonRefPath(parsed.pathname);
    if (cleanedPath !== parsed.pathname) {
      pathChanged = true;
      // head のパス部分だけ差し替える（クエリより前）。
      const origin = `${parsed.protocol}//${parsed.host}`;
      nextHead = `${origin}${cleanedPath}`;
    }
  }

  const nextSearch = stripTrackingSearchLossless(search, rules);
  if (!pathChanged && nextSearch === null) {
    return isStorableItemUrl(value) ? value : null;
  }

  const searchPart = nextSearch === null ? search : nextSearch;
  const cleaned = `${nextHead}${searchPart}${hash}`;
  return isStorableItemUrl(cleaned) ? cleaned : null;
}

/** 前後空白を取り、200 文字まで。空なら null。 */
export function normalizeItemName(raw: string): string | null {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, ITEM_NAME_MAX);
}

/**
 * クリーン後の URL が、保存済みの生 URL（トラッキング付き含む）と一致するか。
 * 厳密一致に加え、各行を sanitize して比較する。
 */
export function cleanedStoredItemUrlTaken(
  db: Database.Database,
  userId: number,
  cleanedUrl: string,
  excludeItemId?: number,
): boolean {
  if (excludeItemId != null) {
    if (db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ? AND id != ?').get(userId, cleanedUrl, excludeItemId)) {
      return true;
    }
    const rows = db.prepare('SELECT url FROM items WHERE user_id = ? AND id != ?').all(userId, excludeItemId) as { url: string }[];
    return rows.some((row) => sanitizeStoredItemUrl(row.url) === cleanedUrl);
  }
  if (db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(userId, cleanedUrl)) {
    return true;
  }
  const rows = db.prepare('SELECT url FROM items WHERE user_id = ?').all(userId) as { url: string }[];
  return rows.some((row) => sanitizeStoredItemUrl(row.url) === cleanedUrl);
}

export type ServerItemMedia = {
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
  scraped: ScrapedItem | null;
};

export type FetchServerItemMediaOptions = {
  deps?: ScrapeDeps;
  userId?: number;
  accountType?: 'member' | 'guest';
  timeoutMs?: number;
};

function emptyMedia(url: string, scraped: ScrapedItem | null = null): ServerItemMedia {
  const fallbackSource = getSourceFromUrl(url);
  const validation = validateAndSanitizeUrl(url);
  const source = validation.source || fallbackSource;
  const sourceName =
    source === 'amazon' ? 'Amazon' : source === 'rakuten' ? '楽天市場' : null;
  return { price: null, imageUrl: null, source, sourceName, scraped };
}

async function scrapeForAccount(
  url: string,
  options: FetchServerItemMediaOptions,
): Promise<ScrapedItem> {
  if (options.accountType === 'guest' && options.userId != null) {
    return scrapeGuestUrl(url, options.userId);
  }
  return scrapeUrl(url, options.deps);
}

/**
 * クライアントが送った価格・画像は使わない。
 * 取得できない・タイムアウトのときは価格と画像を空にする。
 */
export async function fetchServerItemMedia(
  url: string,
  options: FetchServerItemMediaOptions = {},
): Promise<ServerItemMedia> {
  const timeoutMs = options.timeoutMs ?? SERVER_ITEM_MEDIA_TIMEOUT_MS;
  try {
    const scraped = await new Promise<ScrapedItem>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server item media timeout')), timeoutMs);
      scrapeForAccount(url, options).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
    if (isUnusableScrape(scraped)) return emptyMedia(url, scraped);
    return {
      price: typeof scraped.price === 'number' && Number.isFinite(scraped.price) ? scraped.price : null,
      imageUrl: scraped.imageUrl || null,
      source: scraped.source || getSourceFromUrl(url),
      sourceName: scraped.sourceName ?? emptyMedia(url).sourceName,
      scraped,
    };
  } catch {
    return emptyMedia(url);
  }
}
