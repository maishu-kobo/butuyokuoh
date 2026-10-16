import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class PublicPageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const invalidUrl = () => new PublicPageError(400, '公開されている商品ページのHTTP(S) URLを指定してください');
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

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
  new Promise<{ status: number; location?: string; html: string }>((resolve, reject) => {
    const options: RequestOptions = {
      agent: false, family: address.family, signal, maxHeaderSize: 16_384,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Butuyokuoh/1.0)',
        'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        'Cookie': 'localization=JP; cart_currency=JPY',
      },
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, response => {
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
          Number(response.headers['content-length']) > MAX_PAGE_BYTES) {
        reject(new PublicPageError(502, 'このサイトから商品情報を取得できませんでした。手動で追加してください'));
        response.destroy();
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) {
          reject(new PublicPageError(502, '商品ページが大きすぎます。手動で追加してください'));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, html: Buffer.concat(chunks).toString('utf8') }));
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
        if (!result.location || redirects === 3) throw new PublicPageError(502, '転送が多すぎるか無効です。商品の直接URLを指定してください');
        url = publicPageUrl(new URL(result.location, url).href);
        continue;
      }
      return { html: result.html, url: url.href };
    }
    throw invalidUrl();
  } catch (error) {
    if (error instanceof PublicPageError) throw error;
    throw new PublicPageError(502, '商品情報を取得できませんでした。URLを確認するか、手動で追加してください');
  } finally { clearTimeout(timer); controller.abort(); }
}
