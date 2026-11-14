import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Parser } from 'htmlparser2';
import { isAmazonHost, isAmazonProductPage } from './amazon-product';
import { decodeHtml } from './html-encoding';
import { BlockedTargetError, resolvedPublicAddress, type MemberFetchDeps } from './member-fetch';
import { MAX_AMAZON_PAGE_BYTES } from './public-page';

// 商品ページの「通貨を変更」と同じ操作。
// /customer-preferences/edit の「変更を保存」は
// POST /customer-preferences/ajax/save-preferences に { lop, cop: "JPY" } と
// anti-csrftoken-a2z を送り、戻った Cookie（i18n-prefs=JPY）で商品ページを開き直す。
// 為替でドルを円に換算しない。

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
// 本番の Amazon 取得（member-fetch の MAX_REDIRECTS）と同じ。初回を含めて 4 回まで。
const CURRENCY_REDIRECTS = 3;
const LANGUAGES = new Set(['ja_JP', 'en_US', 'zh_CN']);
const COOKIE_NAMES = new Set([
  'session-id',
  'session-id-time',
  'i18n-prefs',
  'lc-acbjp',
  'ubid-acbjp',
  'session-token',
  'at-acbjp',
  'sess-at-acbjp',
]);

export type AmazonExchangeResponse = {
  status: number;
  body: string;
  setCookie: string[];
  location?: string;
};

export type AmazonExchange = {
  get(url: string, headers: Record<string, string>): Promise<AmazonExchangeResponse>;
  post(url: string, headers: Record<string, string>, body: string): Promise<AmazonExchangeResponse>;
};

export function readAmazonCurrencyChoice(html: string): { csrf: string; language: string } | null {
  let inForm = false;
  let csrf = '';
  let yen = false;
  let language = '';
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'form' && attrs.id === 'international-customer-select-preferences-form') inForm = true;
      if (!inForm) return;
      if (tag === 'input' && attrs.name === 'anti-csrftoken-a2z' && attrs.value) csrf = attrs.value;
      if (tag === 'option' && attrs.value === 'JPY') yen = true;
      if (tag === 'input' && attrs.name === 'lop' && attrs.value && LANGUAGES.has(attrs.value)) {
        if ('checked' in attrs || !language) language = attrs.value;
      }
    },
    onclosetag(tag) {
      if (tag === 'form') inForm = false;
    },
  }, { decodeEntities: true });
  parser.end(html);
  if (!yen || !/^[A-Za-z0-9+/=_-]{8,500}$/.test(csrf)) return null;
  return { csrf, language: language || 'ja_JP' };
}

function preferencesUrls(productUrl: string): { edit: URL; save: URL; product: URL } | null {
  let product: URL;
  try { product = new URL(productUrl); } catch { return null; }
  if (!isAmazonProductPage(product) || !isAmazonHost(product.hostname)) return null;
  const edit = new URL('/customer-preferences/edit', product.origin);
  edit.searchParams.set('ie', 'UTF8');
  edit.searchParams.set('preferencesReturnUrl', `${product.pathname}${product.search}`);
  const save = new URL('/customer-preferences/ajax/save-preferences', product.origin);
  save.searchParams.set('ref', 'icp_save_cop_to_JPY');
  return { edit, save, product };
}

export function absorbAmazonCookies(jar: Map<string, string>, lines: string[]) {
  for (const line of lines) {
    if (/[\r\n]/.test(line)) continue;
    const semi = line.indexOf(';');
    const pair = (semi === -1 ? line : line.slice(0, semi)).trim();
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!COOKIE_NAMES.has(name) || !value || value.length > 2048 || /[\r\n;]/.test(value)) continue;
    jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function amazonPageHeaders(jar: Map<string, string>): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9',
    'Cookie': cookieHeader(jar),
  };
}

function nextSessionUrl(current: URL, location: string | undefined): URL | null {
  if (!location || /[\r\n]/.test(location)) return null;
  let next: URL;
  try { next = new URL(location, current); } catch { return null; }
  next.hash = '';
  return allowedAmazonSessionUrl(next) ? next : null;
}

/** 3xx は許可した Amazon のパスだけ追う。外せないときは null。 */
export async function followAmazonExchange(
  exchange: AmazonExchange,
  start: URL,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body: string | undefined,
  jar: Map<string, string>,
): Promise<AmazonExchangeResponse | null> {
  let current = start;
  let verb = method;
  let payload = body;
  let hopHeaders = headers;
  for (let redirects = 0; redirects <= CURRENCY_REDIRECTS; redirects++) {
    const response = verb === 'POST'
      ? await exchange.post(current.href, hopHeaders, payload ?? '')
      : await exchange.get(current.href, hopHeaders);
    absorbAmazonCookies(jar, response.setCookie);
    if (response.status < 300 || response.status >= 400) return response;
    const next = nextSessionUrl(current, response.location);
    if (!next || redirects === CURRENCY_REDIRECTS) return null;
    current = next;
    // 本番の取得と同じく、転送のあとは GET。POST の本文は送り直さない。
    verb = 'GET';
    payload = undefined;
    hopHeaders = amazonPageHeaders(jar);
  }
  return null;
}

/** 円を選べたとき、切り替え後の商品 HTML を返す。選べなければ null。 */
export async function switchedAmazonHtml(productUrl: string, exchange: AmazonExchange): Promise<string | null> {
  const urls = preferencesUrls(productUrl);
  if (!urls) return null;
  const jar = new Map<string, string>([['i18n-prefs', 'JPY'], ['lc-acbjp', 'ja_JP']]);
  const edit = await followAmazonExchange(exchange, urls.edit, 'GET', amazonPageHeaders(jar), undefined, jar);
  if (!edit || edit.status < 200 || edit.status >= 300) return null;
  const choice = readAmazonCurrencyChoice(edit.body);
  if (!choice) return null;
  const saved = await followAmazonExchange(exchange, urls.save, 'POST', {
    ...amazonPageHeaders(jar),
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/json; charset=UTF-8',
    'anti-csrftoken-a2z': choice.csrf,
    'Origin': urls.product.origin,
  }, JSON.stringify({ lop: choice.language, cop: 'JPY' }), jar);
  if (!saved || saved.status < 200 || saved.status >= 300) return null;
  jar.set('i18n-prefs', 'JPY');
  jar.set('lc-acbjp', 'ja_JP');
  const page = await followAmazonExchange(exchange, urls.product, 'GET', amazonPageHeaders(jar), undefined, jar);
  if (!page || page.status < 200 || page.status >= 300 || !page.body) return null;
  return page.body;
}

/** 通貨・お届け先の切り替えと、そのあとの商品ページだけを許可する。 */
export function allowedAmazonSessionUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || !isAmazonHost(url.hostname)) return false;
  return url.pathname === '/customer-preferences/edit'
    || url.pathname === '/customer-preferences/ajax/save-preferences'
    || url.pathname === '/gp/delivery/ajax/address-change.html'
    || url.pathname === '/portal-migration/hz/glow/address-change'
    || isAmazonProductPage(url);
}

function requestAmazon(
  url: URL,
  address: { address: string; family: number },
  headers: Record<string, string>,
  signal: AbortSignal,
  method: 'GET' | 'POST',
  body?: string,
): Promise<AmazonExchangeResponse> {
  return new Promise((resolve, reject) => {
    const requestHeaders: Record<string, string> = { ...headers, Host: url.host };
    if (body != null) requestHeaders['Content-Length'] = String(Buffer.byteLength(body));
    const options: RequestOptions & { servername?: string } = {
      agent: false,
      protocol: url.protocol,
      host: address.address,
      family: address.family,
      servername: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method,
      signal,
      headers: requestHeaders,
    };
    // codeql[js/request-forgery] — 接続先は resolvedPublicAddress 済みの公開 IP。Host は許可した Amazon だけ。
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(options, (response) => {
      const status = response.statusCode || 502;
      const setCookieHeader = response.headers['set-cookie'];
      const setCookie = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
      const locationHeader = response.headers.location;
      const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
      response.on('error', reject);
      if (status >= 300 && status < 400) {
        resolve({ status, body: '', setCookie, location });
        response.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_AMAZON_PAGE_BYTES) {
          reject(new Error('Amazon currency page is too large'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const contentType = response.headers['content-type'];
        const type = Array.isArray(contentType) ? contentType[0] : contentType;
        resolve({ status, body: decodeHtml(Buffer.concat(chunks), type || ''), setCookie });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

export function liveAmazonExchange(deps?: Pick<MemberFetchDeps, 'resolve' | 'timeoutMs'>): AmazonExchange {
  const call = async (urlString: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string) => {
    const url = new URL(urlString);
    if (!allowedAmazonSessionUrl(url)) throw new BlockedTargetError();
    const address = await resolvedPublicAddress(url, deps?.resolve);
    // 登録全体の待ち（Amazon は 45 秒）に収まるよう、切り替えの各要求は短く切る。
    const signal = AbortSignal.timeout(deps?.timeoutMs ?? 8000);
    return requestAmazon(url, address, headers, signal, method, body);
  };
  return {
    get: (url, headers) => call(url, 'GET', headers),
    post: (url, headers, body) => call(url, 'POST', headers, body),
  };
}
