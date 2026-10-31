import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { isAmazonProductPage } from './amazon-product';
import { decodeHtml } from './html-encoding';

export class PublicPageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const invalidUrl = () => new PublicPageError(400, '公開されている商品ページのHTTP(S) URLを指定してください');
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_AMAZON_PAGE_BYTES = 8 * 1024 * 1024;
export const PRODUCT_FETCH_HELP = '商品情報を自動取得できませんでした。もう一度試すか、「手動で追加」で商品名を入力してください。入力したURLやメモはそのまま使えます。';

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.range() !== 'unicast') return false;
  // IPv6 global unicast only; mapped, transition and reserved ranges are denied.
  return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
}

export function publicPageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw invalidUrl(); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      (!host.includes('.') && !isIP(host)) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
      (isIP(host) && !isPublicAddress(host))) throw invalidUrl();
  url.hash = '';
  return url;
}

export type PageResolver = (host: string) => Promise<{ address: string; family: number }[]>;
export async function publicAddress(url: URL, resolve: PageResolver = host => lookup(host, { all: true })) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw invalidUrl();
  return addresses.find(address => address.family === 4) || addresses[0];
}

// No pooled socket, second DNS lookup, cookie forwarding, browser or subresource fetch.
// The original hostname remains in Host/SNI and certificate validation.
export const requestPage = (url: URL, address: { address: string; family: number }, signal: AbortSignal) =>
  new Promise<{ status: number; location?: string; html: string; truncated?: boolean }>((resolve, reject) => {
    const amazon = isAmazonProductPage(url);
    const maxBytes = amazon ? MAX_AMAZON_PAGE_BYTES : MAX_PAGE_BYTES;
    const options: RequestOptions & { servername?: string } = {
      agent: false,
      protocol: url.protocol,
      host: address.address,
      family: address.family,
      servername: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      signal,
      maxHeaderSize: 16_384,
      headers: {
        Host: url.host,
        'User-Agent': 'Mozilla/5.0 (compatible; Butuyokuoh/1.0)',
        'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        'Cookie': amazon ? 'i18n-prefs=JPY; lc-acbjp=ja_JP' : 'localization=JP; cart_currency=JPY',
      },
    };
    // codeql[js/request-forgery] — 接続先は publicAddress 済みの公開 IP のみ。Host/SNI に元ホストを使う。
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(options, response => {
      const status = response.statusCode || 502;
      response.on('error', reject);
      if ([301, 302, 303, 307, 308].includes(status)) {
        resolve({ status, location: response.headers.location, html: '' });
        response.destroy();
        return;
      }
      if (status < 200 || status >= 300 ||
          !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers['content-type'] || '') ||
          !['identity', undefined].includes(response.headers['content-encoding']) ||
          (!amazon && Number(response.headers['content-length']) > maxBytes)) {
        reject(new PublicPageError(502, PRODUCT_FETCH_HELP));
        response.destroy();
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        const remaining = maxBytes - size;
        size += chunk.length;
        if (size > maxBytes) {
          if (amazon) {
            // Reviews/recommendations can be enormous. Retain the bounded
            // product section instead of discarding already fetched metadata.
            chunks.push(chunk.subarray(0, Math.max(0, remaining)));
            resolve({ status, html: decodeHtml(Buffer.concat(chunks), response.headers['content-type']), truncated: true });
          } else reject(new PublicPageError(502, PRODUCT_FETCH_HELP));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, html: decodeHtml(Buffer.concat(chunks), response.headers['content-type']) }));
    });
    req.on('error', reject);
    req.end();
  });

// Dependencies are explicit for deterministic tests; there is no environment bypass.
export async function fetchPublicPage(value: string, dependencies: {
  resolve?: PageResolver; request?: typeof requestPage; timeoutMs?: number;
} = {}) {
  let url = publicPageUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 12_000);
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () =>
    reject(new PublicPageError(504, '取得に時間がかかっています。少し待って再試行するか、手動で追加してください')), { once: true }));
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const address = await Promise.race([publicAddress(url, dependencies.resolve), aborted]);
      controller.signal.throwIfAborted();
      const result = await Promise.race([(dependencies.request || requestPage)(url, address, controller.signal), aborted]);
      if (result.status >= 300 && result.status < 400) {
        if (!result.location || redirects === 3) throw new PublicPageError(502, 'リンク先の商品を確認できませんでした。商品ページをブラウザで開き、そのURLを貼り直してください。');
        url = publicPageUrl(new URL(result.location, url).href);
        continue;
      }
      return { html: result.html, url: url.href, truncated: result.truncated ?? false };
    }
    throw invalidUrl();
  } catch (error) {
    if (error instanceof PublicPageError) throw error;
    throw new PublicPageError(502, PRODUCT_FETCH_HELP);
  } finally { clearTimeout(timer); controller.abort(); }
}
