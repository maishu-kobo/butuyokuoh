// 候補の画像は、各店の画像配信ホストの https だけ。商品ページのホストや任意の URL は入れない。

export const CANDIDATE_IMAGE_HOSTS = [
  'item-shopping.c.yimg.jp',
  'thumbnail.image.rakuten.co.jp',
  'tshop.r10s.jp',
] as const;

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
