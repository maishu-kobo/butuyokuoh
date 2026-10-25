// 楽天の商品ページと、アフィリエイト包装の飛び先。
// 包装の URL 自体は残す。pc は商品ホストだけ。
// m は商品ホストか、m.rakuten.co.jp の商品パス。モバイルは商品ホストの https に正規化する。

const PRODUCT_HOST = 'item.rakuten.co.jp';
const MOBILE_HOST = 'm.rakuten.co.jp';
const AFFILIATE_HOST = 'hb.afl.rakuten.co.jp';
const MOBILE_PRODUCT_PATH = /^\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/?$/;

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

function canonicalMobileProductUrl(raw: string): string | null {
  if (/[\u0000-\u0020\\]/.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.port) return null;
  if (parsed.hostname !== MOBILE_HOST) return null;
  if (!MOBILE_PRODUCT_PATH.test(parsed.pathname)) return null;
  return canonicalRakutenProductUrl(`https://${PRODUCT_HOST}${parsed.pathname}`);
}

export function canonicalRakutenAffiliateUrl(raw: string): string | null {
  const parsed = parseHttps(raw);
  if (!parsed || parsed.hostname !== AFFILIATE_HOST) return null;
  const pcs = parsed.searchParams.getAll('pc');
  if (pcs.length === 0 || pcs.some((value) => canonicalRakutenProductUrl(value) == null)) return null;
  const mobiles = parsed.searchParams.getAll('m');
  if (mobiles.length === 0) return canonical(parsed);
  const normalized = mobiles.map((value) => canonicalRakutenProductUrl(value) ?? canonicalMobileProductUrl(value));
  if (normalized.some((value) => value == null)) return null;
  if (mobiles.every((value) => canonicalRakutenProductUrl(value) != null)) return canonical(parsed);
  const next = new URL(canonical(parsed));
  next.searchParams.delete('m');
  for (const value of normalized) {
    if (!value) return null;
    next.searchParams.append('m', value);
  }
  return canonical(next);
}

export function rakutenProductIdentity(raw: string): string | null {
  const product = canonicalRakutenProductUrl(raw);
  if (product) return product;
  if (!canonicalRakutenAffiliateUrl(raw)) return null;
  const pc = parseHttps(raw)?.searchParams.get('pc');
  return pc ? canonicalRakutenProductUrl(pc) : null;
}
