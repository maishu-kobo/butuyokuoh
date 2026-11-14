import { isAmazonHost, isAmazonProductPage } from './amazon-product';
import {
  amazonPageHeaders,
  followAmazonExchange,
  type AmazonExchange,
} from './amazon-currency';

// サーバ側セッションのお届け先が国外のままだと、大型家電などの買ボックスが空になる。
// 画面の「お届け先」で日本の郵便番号を選ぶのと同じ操作を、glow の address-change で行う。

const JAPAN_ZIP = '1000001';
const CSRF_OK = /^[A-Za-z0-9+/=_-]{8,500}$/;

export function amazonNeedsJapanDelivery(html: string): boolean {
  if (!html) return false;
  if (html.includes('発送できません')) return true;
  const glow = html.match(/id="glow-ingress-line2"[^>]*>\s*([^<]+)/);
  const line = glow?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  return /アメリカ|United States|\bUS\b/i.test(line);
}

export function readAmazonGlowCsrf(html: string): string | null {
  const encoded = html.match(/anti-csrftoken-a2z&quot;:&quot;([^&]+)&quot;/);
  if (encoded && CSRF_OK.test(encoded[1])) return encoded[1];
  const plain = html.match(/"anti-csrftoken-a2z"\s*:\s*"([^"]+)"/);
  if (plain && CSRF_OK.test(plain[1])) return plain[1];
  return null;
}

function deliveryUrls(productUrl: string): { change: URL; product: URL } | null {
  let product: URL;
  try { product = new URL(productUrl); } catch { return null; }
  if (!isAmazonProductPage(product) || !isAmazonHost(product.hostname)) return null;
  const change = new URL('/gp/delivery/ajax/address-change.html', product.origin);
  change.searchParams.set('actionSource', 'desktop-modal');
  return { change, product };
}

/** 日本の郵便番号へ切り替えられたとき、その Cookie で開き直した商品 HTML を返す。 */
export async function switchedAmazonDeliveryHtml(
  productUrl: string,
  html: string,
  exchange: AmazonExchange,
): Promise<string | null> {
  const urls = deliveryUrls(productUrl);
  const csrf = readAmazonGlowCsrf(html);
  if (!urls || !csrf) return null;
  const jar = new Map<string, string>([['i18n-prefs', 'JPY'], ['lc-acbjp', 'ja_JP']]);
  const body = new URLSearchParams({
    locationType: 'LOCATION_INPUT',
    zipCode: JAPAN_ZIP,
    storeContext: 'generic',
    deviceType: 'web',
    pageType: 'Detail',
    actionSource: 'glow',
  }).toString();
  const saved = await followAmazonExchange(exchange, urls.change, 'POST', {
    ...amazonPageHeaders(jar),
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded',
    'anti-csrftoken-a2z': csrf,
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': urls.product.origin,
    'Referer': urls.product.href,
  }, body, jar);
  if (!saved || saved.status < 200 || saved.status >= 300) return null;
  if (!jar.has('ubid-acbjp') && !jar.has('session-id')) return null;
  const page = await followAmazonExchange(exchange, urls.product, 'GET', amazonPageHeaders(jar), undefined, jar);
  if (!page || page.status < 200 || page.status >= 300 || !page.body) return null;
  return page.body;
}
