// 候補の画像は、各店の画像配信ホストの https だけ。商品ページのホストや任意の URL は入れない。

export const CANDIDATE_IMAGE_HOSTS = [
  'item-shopping.c.yimg.jp',
  'thumbnail.image.rakuten.co.jp',
  'tshop.r10s.jp',
] as const;

// ほしいものリスト等の表示用。候補ホストに加え、スクレイプでよく出る CDN と自前の相対パス。
export const ITEM_IMAGE_HOSTS = [
  ...CANDIDATE_IMAGE_HOSTS,
  'shop.r10s.jp',
  'm.media-amazon.com',
  'images-na.ssl-images-amazon.com',
  'images-fe.ssl-images-amazon.com',
  'images-eu.ssl-images-amazon.com',
] as const;

const LOCAL_ITEM_IMAGE = /^\/(uploads\/[0-9a-f]{64}\.(?:jpg|jpeg|png|webp|gif)|demo\/wishlist\.svg)$/i;

const IMAGE_HOSTS = {
  yahoo: ['item-shopping.c.yimg.jp'],
  rakuten: ['thumbnail.image.rakuten.co.jp', 'tshop.r10s.jp'],
} as const;

export function canonicalCandidateImageUrl(site: keyof typeof IMAGE_HOSTS, raw: string): string | null {
  if (raw.length === 0 || raw.length > 2000 || /[\u0000-\u0020\\]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (!(IMAGE_HOSTS[site] as readonly string[]).includes(parsed.hostname)) return null;
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

/** 画面に出す画像 URL。許可ホスト以外と危険な相対パスは null（プレースホルダへ）。 */
export function displayableItemImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (LOCAL_ITEM_IMAGE.test(value)) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (!(ITEM_IMAGE_HOSTS as readonly string[]).includes(parsed.hostname)) return null;
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}
