// 楽天の商品ページと、アフィリエイト包装の飛び先。
// 包装の URL 自体は残す。pc と、付いている m が商品ホストのときだけ通す。

const PRODUCT_HOST = 'item.rakuten.co.jp';
const AFFILIATE_HOST = 'hb.afl.rakuten.co.jp';

function parseHttps(raw: string): URL | null {
  if (/[\u0000-\u0020\\]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  return parsed;
}

function canonical(parsed: URL): string {
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

export function canonicalRakutenProductUrl(raw: string): string | null {
  const parsed = parseHttps(raw);
  if (!parsed || parsed.hostname !== PRODUCT_HOST) return null;
  return canonical(parsed);
}

export function canonicalRakutenAffiliateUrl(raw: string): string | null {
  const parsed = parseHttps(raw);
  if (!parsed || parsed.hostname !== AFFILIATE_HOST) return null;
  const pcs = parsed.searchParams.getAll('pc');
  if (pcs.length === 0 || pcs.some((value) => canonicalRakutenProductUrl(value) == null)) return null;
  const mobiles = parsed.searchParams.getAll('m');
  if (mobiles.length > 0 && mobiles.some((value) => canonicalRakutenProductUrl(value) == null)) return null;
  return canonical(parsed);
}

export function rakutenProductIdentity(raw: string): string | null {
  const product = canonicalRakutenProductUrl(raw);
  if (product) return product;
  if (!canonicalRakutenAffiliateUrl(raw)) return null;
  const pc = parseHttps(raw)?.searchParams.get('pc');
  return pc ? canonicalRakutenProductUrl(pc) : null;
}
