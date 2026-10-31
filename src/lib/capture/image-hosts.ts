// 候補の画像は、各店の画像配信ホストの https だけ。商品ページのホストや任意の URL は入れない。

export const CANDIDATE_IMAGE_HOSTS = [
  'item-shopping.c.yimg.jp',
  'thumbnail.image.rakuten.co.jp',
  'tshop.r10s.jp',
] as const;

const LOCAL_UPLOAD = /^\/uploads\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif|avif)$/i;
const DEMO_IMAGE = '/demo/wishlist.svg';

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

/**
 * 画面に出す画像 URL。ホスト許可リストは使わない（本番の既存画像を消さない）。
 * スキーム判定は new URL の protocol だけ（文字列の startsWith は使わない）。
 * http(s) は認証情報・ポートが無ければ可。data:image/ も可。
 */
export function displayableItemImageUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = raw.trim();
  if (!value || value.length > 2000) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  if (value.startsWith('//')) return null;
  if (value === DEMO_IMAGE) return value;
  if (LOCAL_UPLOAD.test(value)) return value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol === 'data:') {
    return /^data:image\//i.test(parsed.href) ? value : null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  return value;
}

/**
 * img の src 用。new URL で再解析できたものだけを返す。
 * フォーム入力をそのまま属性に載せないときの境目にも使う。
 */
export function safeImgSrc(raw: string | null | undefined): string | null {
  const candidate = displayableItemImageUrl(raw);
  if (!candidate) return null;
  if (candidate === DEMO_IMAGE || LOCAL_UPLOAD.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'data:') {
      return /^data:image\//i.test(parsed.href) ? candidate : null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    return candidate;
  } catch {
    return null;
  }
}
