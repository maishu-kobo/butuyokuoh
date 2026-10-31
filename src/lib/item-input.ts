// 品目の新規書き込み向け。価格・画像はサーバ取得を優先し、URL と品名を整える。
// エージェント API（#269）からも同じ関数を呼ぶ。

import { rakutenProductIdentity } from '@/lib/capture/rakuten-link';
import { isStorableItemUrl } from '@/lib/http-url';
import { isUnusableScrape, scrapeUrl, type ScrapedItem, type ScrapeDeps } from '@/lib/scraper';
import { getSourceFromUrl, validateAndSanitizeUrl } from '@/lib/url-validator';

export const ITEM_NAME_MAX = 200;

const TRACKING_PARAM_EXACT = new Set([
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
  // Amazon associate / affiliate style
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

const TRACKING_PARAM_PREFIXES = ['utm_', 'pk_', 'sc_'] as const;

// Amazon の商品同一性に使うことがあるクエリ。落とさない。
const AMAZON_KEEP_PARAMS = new Set(['th', 'psc', 'smid', 'asin', 'colid', 'coliid', 'variant']);

// 楽天の商品同一性に使うことがあるクエリ。落とさない。
const RAKUTEN_KEEP_PARAMS = new Set(['variantid', 's_id', 's']);

function isTrackingParam(name: string, keep: Set<string>): boolean {
  const key = name.toLowerCase();
  if (keep.has(key)) return false;
  if (TRACKING_PARAM_EXACT.has(key)) return true;
  if (key.startsWith('ref') && key !== 'refresh') return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function stripAmazonRefPath(pathname: string): string {
  // /dp/ASIN/ref=... や /gp/product/ASIN/ref=... の ref 以降を落とす。
  return pathname.replace(/\/ref(?:=|%3[Dd])[^/]*$/i, '').replace(/\/ref\/[^/]*$/i, '');
}

function stripTrackingSearch(url: URL, keep: Set<string>): void {
  const drop: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (isTrackingParam(key, keep)) drop.push(key);
  }
  for (const key of drop) url.searchParams.delete(key);
}

function rebuildHttpUrl(url: URL): string {
  const search = url.searchParams.toString();
  return `${url.protocol}//${url.host}${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}

/**
 * 保存用 URL。トラッキングとアフィリエイト包装を取り除く。
 * 商品同一性のパラメータは残す。manual:// はそのまま。
 * 壊れた入力は null。
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

  // 楽天アフィリエイト包装は、安全に解けるときだけ商品ページにする。
  if (parsed.hostname === 'hb.afl.rakuten.co.jp') {
    const product = rakutenProductIdentity(value);
    if (!product) return null;
    return sanitizeStoredItemUrl(product);
  }

  const host = parsed.hostname.toLowerCase();
  const amazon =
    host === 'www.amazon.co.jp' ||
    host === 'www.amazon.jp' ||
    host === 'www.amazon.com' ||
    host === 'amazon.co.jp' ||
    host === 'amazon.jp' ||
    host === 'amazon.com';
  const rakuten =
    host === 'item.rakuten.co.jp' ||
    host === 'books.rakuten.co.jp' ||
    host === 'product.rakuten.co.jp' ||
    host === 'my.bookmark.rakuten.co.jp';

  if (amazon) {
    parsed.pathname = stripAmazonRefPath(parsed.pathname);
    stripTrackingSearch(parsed, AMAZON_KEEP_PARAMS);
  } else if (rakuten) {
    stripTrackingSearch(parsed, RAKUTEN_KEEP_PARAMS);
  } else {
    stripTrackingSearch(parsed, new Set());
  }

  const cleaned = rebuildHttpUrl(parsed);
  return isStorableItemUrl(cleaned) ? cleaned : null;
}

/** 前後空白を取り、200 文字まで。空なら null。 */
export function normalizeItemName(raw: string): string | null {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, ITEM_NAME_MAX);
}

export type ServerItemMedia = {
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
  scraped: ScrapedItem | null;
};

/**
 * クライアントが送った価格・画像は使わない。
 * 取得できないときは価格と画像を空にする（品名と URL は呼び出し側が残す）。
 */
export async function fetchServerItemMedia(url: string, deps?: ScrapeDeps): Promise<ServerItemMedia> {
  const fallbackSource = getSourceFromUrl(url);
  const fallbackName =
    fallbackSource === 'amazon' ? 'Amazon' : fallbackSource === 'rakuten' ? '楽天市場' : null;
  try {
    const scraped = await scrapeUrl(url, deps);
    if (isUnusableScrape(scraped)) {
      const validation = validateAndSanitizeUrl(url);
      return {
        price: null,
        imageUrl: null,
        source: validation.source || fallbackSource,
        sourceName: validation.source === 'amazon' ? 'Amazon' : validation.source === 'rakuten' ? '楽天市場' : fallbackName,
        scraped,
      };
    }
    return {
      price: typeof scraped.price === 'number' && Number.isFinite(scraped.price) ? scraped.price : null,
      imageUrl: scraped.imageUrl || null,
      source: scraped.source || fallbackSource,
      sourceName: scraped.sourceName ?? fallbackName,
      scraped,
    };
  } catch {
    return {
      price: null,
      imageUrl: null,
      source: fallbackSource,
      sourceName: fallbackName,
      scraped: null,
    };
  }
}
