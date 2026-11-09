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
/** Amazon は soft-404 後に Puppeteer（goto 最大30s）へ進むことがあるため余裕を見る（#368）。 */
export const SERVER_ITEM_MEDIA_TIMEOUT_AMAZON_MS = 45_000;

/** scrapeUrl が展開する Amazon 短縮ホスト。getSourceFromUrl は 'other' のまま。 */
const AMAZON_SHORT_MEDIA_HOSTS = new Set(['amzn.to', 'amzn.asia', 'a.co']);

/**
 * サーバ側 media 取得の既定タイムアウト。
 * 正規 Amazon に加え短縮リンクも 45s（soft-404 + Puppeteer 用）。呼び出し側が
 * SERVER_ITEM_MEDIA_TIMEOUT_MS を直書きすると短縮が 20s のままになるので使わない。
 */
export function serverItemMediaTimeoutMs(url: string): number {
  if (getSourceFromUrl(url) === 'amazon') return SERVER_ITEM_MEDIA_TIMEOUT_AMAZON_MS;
  try {
    if (AMAZON_SHORT_MEDIA_HOSTS.has(new URL(url).hostname.toLowerCase())) {
      return SERVER_ITEM_MEDIA_TIMEOUT_AMAZON_MS;
    }
  } catch {
    /* 不正 URL は短い既定へ */
  }
  return SERVER_ITEM_MEDIA_TIMEOUT_MS;
}

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

const STORE_TRACKING_PREFIXES = ['utm_', 'pk_', 'sc_', 'mc_', 'aff_', 'gad_'] as const;

/** Amazon / 楽天以外。共通の計測・広告パラメータ。 */
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

const GENERIC_TRACKING_PREFIXES = ['utm_', 'mc_', 'aff_', 'gad_'] as const;

/** AliExpress 広告経由。商品パス以外の PPC / 計測パラメータ。 */
const ALIEXPRESS_TRACKING_EXACT = new Set([
  ...GENERIC_TRACKING_EXACT,
  'osf',
  'guidemodule',
  'src',
  'acnt',
  'isdl',
  'slnk',
  'trgt',
  'plac',
  'crea',
  'netw',
  'device',
  'mtctp',
  'memo1',
  'gatewayadapt',
  'issmbactive',
  'issmbautocall',
  'needsmbhouyi',
]);

const ALIEXPRESS_TRACKING_PREFIXES = ['utm_', 'mc_', 'aff_', 'gad_', 'alb'] as const;

const AMAZON_KEEP_PARAMS = new Set(['th', 'psc', 'smid', 'asin', 'colid', 'coliid', 'variant']);
const RAKUTEN_KEEP_PARAMS = new Set(['variantid', 's_id', 's']);
/** バリエーション特定に使うことがあるキーだけ残す。 */
const ALIEXPRESS_KEEP_PARAMS = new Set(['sku_id', 'pdp_npi', 'pdp_ext_f']);

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

function isAliExpressHost(host: string): boolean {
  return (
    host === 'aliexpress.com' ||
    host.endsWith('.aliexpress.com') ||
    host === 'aliexpress.us' ||
    host.endsWith('.aliexpress.us') ||
    host === 'aliexpress.ru' ||
    host.endsWith('.aliexpress.ru')
  );
}

function trackingRulesForHost(host: string): TrackingRules {
  if (isAmazonHost(host)) {
    return { exact: STORE_TRACKING_EXACT, prefixes: STORE_TRACKING_PREFIXES, keep: AMAZON_KEEP_PARAMS };
  }
  if (isRakutenProductHost(host) || host === 'hb.afl.rakuten.co.jp') {
    return { exact: STORE_TRACKING_EXACT, prefixes: STORE_TRACKING_PREFIXES, keep: RAKUTEN_KEEP_PARAMS };
  }
  if (isAliExpressHost(host)) {
    return { exact: ALIEXPRESS_TRACKING_EXACT, prefixes: ALIEXPRESS_TRACKING_PREFIXES, keep: ALIEXPRESS_KEEP_PARAMS };
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

/** ほしいものリスト上の同一 URL */
export const URL_IN_LIST_MESSAGE = 'このURLはすでにほしいものリストに登録されています';
/** 購入済みの同一 URL */
export const URL_IN_PURCHASED_MESSAGE = 'このURLは購入済みに登録されています';
/** 複数店追加など、自動復元しない経路向け */
export const URL_IN_TRASH_MESSAGE =
  'このURLはゴミ箱にあります。Webのゴミ箱タブで「元に戻す」か、先に完全削除してから追加してください';
/** 単一 URL 追加で自動復元したとき */
export const RESTORED_FROM_TRASH_MESSAGE = 'ゴミ箱にあった同じURLの商品を復元しました';

export type StoredUrlMatch = {
  id: number;
  url: string;
  name: string;
  deleted_at: string | null;
  is_purchased: number;
};

export type CleanedUrlRegistration =
  | { kind: 'free' }
  | { kind: 'active'; match: StoredUrlMatch; location: 'list' | 'purchased' }
  | { kind: 'trashed'; match: StoredUrlMatch };

function urlMatchesCleaned(rowUrl: string, cleanedUrl: string, identity: string | null): boolean {
  if (rowUrl === cleanedUrl) return true;
  if (sanitizeStoredItemUrl(rowUrl) === cleanedUrl) return true;
  if (identity && rakutenProductIdentity(rowUrl) === identity) return true;
  return false;
}

/**
 * クリーン後 URL（＋楽天 identity）が、リスト / 購入済み / ゴミ箱のどれにあるか。
 * アクティブ行があればゴミ箱より優先する。
 */
export function findCleanedStoredUrlRegistration(
  db: Database.Database,
  userId: number,
  cleanedUrl: string,
  excludeItemId?: number,
): CleanedUrlRegistration {
  const identity = rakutenProductIdentity(cleanedUrl);
  const rows = (
    excludeItemId != null
      ? db.prepare(
        'SELECT id, url, name, deleted_at, is_purchased FROM items WHERE user_id = ? AND id != ?',
      ).all(userId, excludeItemId)
      : db.prepare(
        'SELECT id, url, name, deleted_at, is_purchased FROM items WHERE user_id = ?',
      ).all(userId)
  ) as StoredUrlMatch[];

  const matches = rows.filter((row) => urlMatchesCleaned(row.url, cleanedUrl, identity));
  if (matches.length === 0) return { kind: 'free' };

  const active = matches.find((row) => !row.deleted_at);
  if (active) {
    return {
      kind: 'active',
      match: active,
      location: active.is_purchased ? 'purchased' : 'list',
    };
  }

  const trashed = [...matches].sort((a, b) => String(b.deleted_at ?? '').localeCompare(String(a.deleted_at ?? '')))[0];
  return { kind: 'trashed', match: trashed };
}

export function activeUrlConflictMessage(location: 'list' | 'purchased'): string {
  return location === 'purchased' ? URL_IN_PURCHASED_MESSAGE : URL_IN_LIST_MESSAGE;
}

/** ゴミ箱の品目を復元する。メモや価格履歴はそのまま。 */
export function restoreTrashedItem(
  db: Database.Database,
  userId: number,
  itemId: number,
): StoredUrlMatch {
  const item = db.prepare(`
    SELECT id, url, name, deleted_at, is_purchased
    FROM items
    WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
  `).get(itemId, userId) as StoredUrlMatch | undefined;
  if (!item) {
    throw new Error('trashed item not found');
  }
  db.prepare(`
    UPDATE items
    SET deleted_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(itemId, userId);
  return { ...item, deleted_at: null };
}

export type PurgeTrashedItemResult =
  | { kind: 'purged'; item: StoredUrlMatch }
  | { kind: 'not_trashed'; item: StoredUrlMatch }
  | { kind: 'not_found' };

/**
 * ゴミ箱の品目 1 件を子レコードごと完全削除する本体。Web の DELETE /api/trash/[id] と
 * エージェントの purge_item（#381）が共有する唯一の削除経路。
 * 呼び出し側が張ったトランザクションの中で使う（エージェントは操作ログの INSERT と同じ
 * トランザクションに入れるため）。所有者確認とゴミ箱判定もその中で行い、ほしいもの・購入済み
 * （deleted_at が空）の行は触らない。消し順は price_history → notification_settings → items。
 * 戻り値の振り分け（404 / 409）は呼び出し側で決める。ゴミ箱全件の削除はここでは扱わない。
 */
export function purgeTrashedItemRows(
  db: Database.Database,
  userId: number,
  itemId: number,
): PurgeTrashedItemResult {
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return { kind: 'not_found' };
  if (!db.inTransaction) {
    throw new Error('purgeTrashedItemRows must run inside a transaction');
  }
  const item = db.prepare(`
    SELECT id, url, name, deleted_at, is_purchased
    FROM items
    WHERE id = ? AND user_id = ?
  `).get(itemId, userId) as StoredUrlMatch | undefined;
  if (!item) return { kind: 'not_found' };
  if (!item.deleted_at) return { kind: 'not_trashed', item };
  db.prepare('DELETE FROM price_history WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM notification_settings WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').run(itemId, userId);
  return { kind: 'purged', item };
}

/** Web 用。purgeTrashedItemRows を自前の immediate トランザクションで包む（操作ログは無い）。 */
export function purgeTrashedItem(
  db: Database.Database,
  userId: number,
  itemId: number,
): PurgeTrashedItemResult {
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return { kind: 'not_found' };
  return db.transaction(() => purgeTrashedItemRows(db, userId, itemId)).immediate();
}

/**
 * クリーン後の URL が、保存済みの生 URL（トラッキング付き含む）と一致するか。
 * 厳密一致に加え、各行を sanitize して比較する。楽天 identity も見る。
 */
export function cleanedStoredItemUrlTaken(
  db: Database.Database,
  userId: number,
  cleanedUrl: string,
  excludeItemId?: number,
): boolean {
  return findCleanedStoredUrlRegistration(db, userId, cleanedUrl, excludeItemId).kind !== 'free';
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
  // 名前が使えない失敗でも、取れた画像は捨てない（再取得失敗で既存画像を消さない方針と揃える）
  return { price: null, imageUrl: scraped?.imageUrl || null, source, sourceName, scraped };
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
  const timeoutMs = options.timeoutMs ?? serverItemMediaTimeoutMs(url);
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
