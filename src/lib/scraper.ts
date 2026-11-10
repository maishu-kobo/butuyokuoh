import { extractAmazonProduct, isAmazonProductPage } from './amazon-product';
import { isAppleShopBuyPage, parseProductHtml } from './product-html';
import { readHtmlResponse } from './html-encoding';
import { launchPageBrowser } from './page-browser';
import { validateAndSanitizeUrl, sanitizeGenericUrl } from './url-validator';
import { canonicalRakutenAffiliateUrl, rakutenProductIdentity } from './capture/rakuten-link';
import { BlockedTargetError, fetchPublicMember, HttpError, resolvedPublicAddress, type MemberFetchDeps } from './member-fetch';
import { productFetchDeps } from './product-fetch-port';

import { tsukumoCatalogImage } from './tsukumo-catalog';
import { recoverTsukumoImage } from './tsukumo-image';

export { HttpError };
export type FetchWithRetryOptions = MemberFetchDeps;

// 価格取得のブラウザ。本番は launchPageBrowser。テストは起動したかと、
// 画像・フォント・メディアを止めたかをここから見る。
export interface AmazonBrowserRequest {
  url(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface AmazonBrowserPage {
  setUserAgent(userAgent: string): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (request: AmazonBrowserRequest) => Promise<void> | void): void;
  goto(url: string, options: { waitUntil: 'networkidle2'; timeout: number }): Promise<unknown>;
  content(): Promise<string>;
}

export interface AmazonBrowser {
  newPage(): Promise<AmazonBrowserPage>;
  close(): Promise<void>;
}

export type ScrapeDeps = MemberFetchDeps & {
  launchBrowser?: (options: { headless: true }) => Promise<AmazonBrowser>;
};

export interface ScrapedItem {
  nameIsFallback?: boolean;
  imageIsFallback?: boolean;
  name: string;
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
  note?: string; // ユーザーへのメッセージ（短縮リンクの制限など）
  failureCode?: 'BOT_CHALLENGE';
}

// スクレイプ結果から items テーブルに記録する状態を導出する。
// check-prices と refresh API の双方で共有し、記録ロジックを統一する。
export interface ScrapeOutcome {
  status: 'success' | 'failed';
  error: string | null;
}

export function deriveScrapeOutcome(scraped: ScrapedItem): ScrapeOutcome {
  if (scraped.price) {
    return { status: 'success', error: null };
  }
  // 価格が取れなかった場合は失敗扱い。理由は scraper の note を優先し、
  // なければ汎用メッセージにフォールバックする。
  return { status: 'failed', error: scraped.note ?? 'price not found' };
}

// 許可されたAmazonドメイン
const AMAZON_DOMAINS = new Set([
  'www.amazon.co.jp',
  'www.amazon.jp',
  'www.amazon.com',
  'amazon.co.jp',
  'amazon.jp',
  'amazon.com',
]);

// Amazonの短縮リンクドメイン
const AMAZON_SHORT_DOMAINS = new Set([
  'amzn.to',
  'amzn.asia',
  'a.co',
]);

// 許可された楽天ドメイン
const RAKUTEN_DOMAINS = new Set([
  'item.rakuten.co.jp',
  'my.bookmark.rakuten.co.jp',
  'books.rakuten.co.jp',
  'product.rakuten.co.jp',
]);

// 名前解決とリダイレクトのたびに内部アドレスを拒否する。リトライ条件は以前と同じ。
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchWithRetryOptions,
): Promise<Response> {
  return (await fetchPublicMember(url, init, options)).response;
}

/**
 * URLのホスト名を取得（SSRF対策のガード）
 */
function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Amazonの短縮リンクかどうかを判定
 */
function isAmazonShortUrl(url: string): boolean {
  const hostname = getHostname(url);
  return hostname !== null && AMAZON_SHORT_DOMAINS.has(hostname);
}

/**
 * Amazonの正規ドメインかどうかを判定
 */
function isAmazonUrl(url: string): boolean {
  const hostname = getHostname(url);
  return hostname !== null && AMAZON_DOMAINS.has(hostname);
}

/**
 * Amazonの商品ページかどうかを判定（トップページや検索ページを除外）
 */
function isAmazonProductUrl(url: string): boolean {
  if (!isAmazonUrl(url)) return false;
  
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    // 商品ページのパターン: /dp/, /gp/product/, /gp/aw/d/
    return path.includes('/dp/') || 
           path.includes('/gp/product/') || 
           path.includes('/gp/aw/d/');
  } catch {
    return false;
  }
}

/**
 * 短縮リンクURLを安全に構築する（SSRF対策）
 * ホワイトリストのドメインのみ許可し、安全なURLを再構築
 */
function buildSafeShortUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    // ホワイトリストのドメインのみ許可
    if (!AMAZON_SHORT_DOMAINS.has(hostname)) {
      return null;
    }
    
    // 安全なURLを構築（httpsのみ許可）
    return `https://${hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * 短縮リンクの展開が 403/404 で終わったとき、通常の Amazon 取得へ進めてよい商品ページの URL。
 * 転送先は member-fetch が接続前に公開アドレスへ解決済み。ここでは許可ドメインの商品ページで、
 * 認証情報を含まないものだけを通す。
 */
function softBlockedAmazonProductUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  return isAmazonProductPage(parsed) ? parsed.href : null;
}

/**
 * 短縮リンクを展開してリダイレクト先のURLを取得
 * @param url 短縮リンクURL（事前にisAmazonShortUrlで検証済み）
 * @returns 展開後のURL（失敗した場合はnull）。展開先の商品ページが 403/404 でも、
 *          その URL を返して通常の Amazon 取得（ブラウザ再取得→BOT_CHALLENGE）に任せる
 */
async function expandShortUrl(url: string, deps?: MemberFetchDeps): Promise<string | null> {
  // SSRF対策: ホワイトリストのドメインから安全なURLを構築
  const safeUrl = buildSafeShortUrl(url);
  if (!safeUrl) {
    console.error('URL is not an Amazon short URL');
    return null;
  }
  
  try {
    // 転送のたびに公開アドレスか確認し、確認したアドレスへだけ接続する
    const response = await fetchPublicMember(safeUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9',
      },
    }, deps);
    
    // 最終的なリダイレクト先URLを取得
    const finalUrl = response.url;
    
    // SSRF対策: リダイレクト先がAmazonドメインのみ許可
    if (isAmazonUrl(finalUrl)) {
      return finalUrl;
    }
    
    console.error('Redirect destination is not Amazon');
    return null;
  } catch (error) {
    // 商品ページが soft-404/403 で終わった短縮リンクは、展開失敗ではなくボット制限として扱う（#367）。
    // 403/404 以外（410 など）と、商品ページ以外・Amazon 以外・認証情報つきの転送先は従来どおり展開失敗。
    if (error instanceof HttpError && isAmazonSoftBlockStatus(error.status)) {
      const destination = softBlockedAmazonProductUrl(error.url);
      if (destination) {
        console.log('Amazon product page blocked the short-link request');
        return destination;
      }
    }
    console.error('Short URL expansion failed');
    return null;
  }
}

function rakutenAffiliateProductUrl(value: string): string | null | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== 'hb.afl.rakuten.co.jp') return undefined;
  return canonicalRakutenAffiliateUrl(value) ? rakutenProductIdentity(value) : null;
}

export function isUnusableScrape(scraped: { name?: string | null; failureCode?: string | null }): boolean {
  if (scraped.failureCode) return true;
  const name = scraped.name?.trim() || '';
  if (!name || name === '不明な商品' || name === '取得失敗' || name === '無効なURL') return true;
  return (
    name.includes('取得できません') ||
    name.includes('失敗しました') ||
    name.includes('展開できませんでした') ||
    name.includes('自動取得を制限') ||
    name.includes('ボット対策')
  );
}

const PRICE_LATER_NOTE = '価格は取得できませんでした。商品は保存できます。価格は「編集」から入力・変更できます。';
const CONFIGURATOR_PRICE_NOTE =
  '構成を選ぶページのため単一の価格を取得できませんでした。商品は保存できます。価格は「編集」から入力・変更できます。';

type ScrapePurpose = 'item' | 'price';

export async function scrapeUrl(url: string, deps?: ScrapeDeps, purpose: ScrapePurpose = 'item'): Promise<ScrapedItem> {
  const result = await scrapeUrlFromPage(url, deps ?? productFetchDeps(), purpose);
  if (!result.price && !result.note && !isUnusableScrape(result)) {
    result.note = isAppleShopBuyPage(url) ? CONFIGURATOR_PRICE_NOTE : PRICE_LATER_NOTE;
  }
  return result;
}

async function scrapeUrlFromPage(url: string, deps: ScrapeDeps | undefined, purpose: ScrapePurpose): Promise<ScrapedItem> {
  // Amazonの短縮リンクの場合、展開を試みる
  if (isAmazonShortUrl(url)) {
    const expandedUrl = await expandShortUrl(url, deps);
    
    if (expandedUrl) {
      // 展開後のURLが商品ページかチェック
      if (isAmazonProductUrl(expandedUrl)) {
        // 展開成功 - 通常のAmazonスクレイピングを実行
        const result = await scrapeAmazon(expandedUrl, deps);
        // 短縮リンクからの登録の場合、価格が取得できない可能性があることを伝える。
        // ボット制限など具体的な note があればそれを残し、一般的な案内は note が無いときだけ補う（#367）。
        if (!result.price && !result.note) {
          result.note = '短縮リンクからの登録のため価格を取得できませんでした。商品ページのフルURLで登録し直すと価格を取得できる場合があります。';
        }
        return result;
      } else {
        // 商品ページではない（トップページや検索ページにリダイレクトされた）
        console.log('Expanded URL is not a product page');
        return {
          name: '短縮リンクの展開に失敗しました。リンクが期限切れか無効な可能性があります。',
          price: null,
          imageUrl: null,
          source: 'amazon',
          sourceName: 'Amazon',
        };
      }
    } else {
      // 展開失敗
      console.log('Failed to expand short URL');
      return {
        name: 'Amazonの短縮リンクを展開できませんでした。通常のURLをお試しください。',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
      };
    }
  }

  const affiliateProduct = rakutenAffiliateProductUrl(url);
  if (affiliateProduct !== undefined) {
    if (!affiliateProduct) {
      return {
        name: '無効なURL',
        price: null,
        imageUrl: null,
        source: 'rakuten',
        sourceName: '楽天市場',
      };
    }
    url = affiliateProduct;
  }

  const validation = validateAndSanitizeUrl(url);

  if (validation.isValid) {
    // 許可されたドメインの場合
    if (validation.source === 'amazon') {
      return scrapeAmazon(validation.sanitizedUrl, deps);
    } else if (validation.source === 'rakuten') {
      return scrapeRakuten(validation.sanitizedUrl, deps);
    }
  }

  // 許可リスト外のドメインの場合、一般的なスクレイピング
  const genericValidation = sanitizeGenericUrl(url);
  if (!genericValidation.isValid) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
    };
  }

  return scrapeGeneric(genericValidation.sanitizedUrl, deps, purpose);
}

export const AMAZON_BOT_NOTE =
  'Amazonのボット対策により自動取得が制限されています。価格は手動で編集してください。';
const AMAZON_BOT_NAME = 'Amazonのボット対策により価格を取得できませんでした';

function amazonBotFallback(): ScrapedItem {
  return {
    name: AMAZON_BOT_NAME,
    price: null,
    imageUrl: null,
    source: 'amazon',
    sourceName: 'Amazon',
    note: AMAZON_BOT_NOTE,
    failureCode: 'BOT_CHALLENGE',
  };
}

/**
 * Amazonのボット対策ページやエラーページを検出
 */
function isAmazonBlockedHtml(html: string): boolean {
  return (
    html.includes('api-services-support@amazon.com') ||
    html.includes('Service Unavailable') ||
    html.includes('ロボットではない') ||
    html.includes('automated access') ||
    !html.includes('productTitle')
  );
}

/** Puppeteer 結果に価格・画像・使える名前のいずれかがあれば採用する。 */
function isUsableAmazonBrowserResult(scraped: ScrapedItem): boolean {
  if (scraped.price != null || scraped.imageUrl) return true;
  return !isUnusableScrape(scraped);
}

/** soft-404/403 は商品欠落ではなくボット制限のことが多い。 */
function isAmazonSoftBlockStatus(status: number): boolean {
  return status === 403 || status === 404;
}

// 価格の抽出に要らない。定期取得の待ちと転送を減らす。
const PUPPETEER_SKIPPED_RESOURCES = new Set(['image', 'font', 'media']);

/**
 * Puppeteer（ヘッドレスブラウザ）でAmazon商品ページを取得するフォールバック
 * 素のfetchがAmazonのボット対策に弾かれた場合に使用する
 * @returns 取得したScrapedItem（ボット検知された場合はnull）
 */
async function scrapeAmazonWithPuppeteer(sanitizedUrl: string, deps?: ScrapeDeps): Promise<ScrapedItem | null> {
  // 遷移先ホストは許可リストの定数だけを使う。pathname/search は商品ページのパス。
  const parsed = new URL(sanitizedUrl);
  const allowedHost = [...AMAZON_DOMAINS].find((domain) => domain === parsed.hostname.toLowerCase());
  if (!allowedHost) return null;
  const navigationUrl = `https://${allowedHost}${parsed.pathname}${parsed.search}`;
  await resolvedPublicAddress(new URL(navigationUrl), deps?.resolve);

  const browser: AmazonBrowser = deps?.launchBrowser
    ? await deps.launchBrowser({ headless: true })
    : (await launchPageBrowser()) as AmazonBrowser;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9',
    });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        if (PUPPETEER_SKIPPED_RESOURCES.has(request.resourceType())) {
          await request.abort();
          return;
        }
        if (request.isNavigationRequest()) {
          const target = new URL(request.url());
          if (target.protocol === 'http:' || target.protocol === 'https:') {
            await resolvedPublicAddress(target, deps?.resolve);
          }
        }
        await request.continue();
      } catch (error) {
        if (error instanceof BlockedTargetError) {
          await request.abort('blockedbyclient');
          return;
        }
        try { await request.continue(); } catch { /* the request was already settled */ }
      }
    });

    // codeql[js/request-forgery] — ホストは AMAZON_DOMAINS、遷移前に resolvedPublicAddress と request 拦截で非公開を拒否する。
    await page.goto(navigationUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // レンダリング後のHTMLを取得し、fetch経路と同じ抽出ロジックを通す
    const html = await page.content();

    if (isAmazonBlockedHtml(html)) {
      console.log('Amazon bot detection persists even with Puppeteer');
      return null;
    }

    const { name, price, imageUrl } = extractAmazonProduct(html);

    return {
      name,
      price,
      imageUrl,
      source: 'amazon',
      sourceName: 'Amazon',
    };
  } finally {
    // ブラウザプロセスのリーク防止のため必ずクローズする
    await browser.close();
  }
}

async function scrapeAmazon(sanitizedUrl: string, deps?: ScrapeDeps): Promise<ScrapedItem> {
  // SSRF対策: fetch直前にホスト名を再検証
  const hostname = getHostname(sanitizedUrl);
  if (!hostname || !AMAZON_DOMAINS.has(hostname)) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'amazon',
      sourceName: 'Amazon',
    };
  }

  // Puppeteerフォールバックも失敗した場合に返す結果（従来の挙動を維持）
  let fallbackResult: ScrapedItem;

  try {
    const response = await fetchWithRetry(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Cookie': 'i18n-prefs=JPY; lc-acbjp=ja_JP',
      },
    }, deps);
    const html = await readHtmlResponse(response);

    // Amazonのボット対策ページやエラーページを検出
    if (isAmazonBlockedHtml(html)) {
      console.log('Amazon bot detection or error page detected');
      fallbackResult = amazonBotFallback();
    } else {
      const { name, price, imageUrl } = extractAmazonProduct(html);

      const result: ScrapedItem = {
        name,
        price,
        imageUrl,
        source: 'amazon',
        sourceName: 'Amazon',
      };

      // 商品ページは取れている。価格があっても無くてもここで返す。
      // 価格が無い（在庫切れ、未発売、バリエーション未選択）ときも、ボット検知でも
      // HTTP 失敗でもないのでブラウザは起動しない。
      return result;
    }
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      return { name: '無効なURL', price: null, imageUrl: null, source: 'amazon', sourceName: 'Amazon' };
    }
    // fetchWithRetryのリトライが尽きた場合もPuppeteerフォールバックを試す
    console.error('Amazon product fetch failed');

    // soft-404/403 は本文を見ずに HttpError になるが、ボット制限の soft block が多い。
    // Puppeteer を試してから BOT_CHALLENGE として返す（#368）。
    if (error instanceof HttpError && isAmazonSoftBlockStatus(error.status)) {
      fallbackResult = amazonBotFallback();
    } else if (
      error instanceof HttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    ) {
      // 410 など、ソフトブロック以外の恒久 4xx はブラウザを起動しない
      return {
        name: '取得失敗',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
      };
    } else {
      fallbackResult = {
        name: '取得失敗',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
      };
    }
  }

  // 注入した HTTP だけを見るときは、実ブラウザで店へ出ない。
  // launchBrowser があるときは、ボット検知と HTTP 失敗でそのブラウザを起動する。
  if (deps?.request && !deps.launchBrowser) return fallbackResult;

  // Puppeteerフォールバック: ボット検知か、再試行しても取れなかった HTTP 失敗で起動する。
  console.log('Falling back to Puppeteer for Amazon product');
  try {
    const puppeteerResult = await scrapeAmazonWithPuppeteer(sanitizedUrl, deps);
    // 価格が無くても画像や商品名が取れた結果は捨てない（エージェント soft-save の No Image を減らす）
    if (puppeteerResult && isUsableAmazonBrowserResult(puppeteerResult)) {
      return puppeteerResult;
    }
  } catch {
    console.error('Amazon browser fallback failed');
  }

  // Puppeteerでも取得できなかった場合は従来どおりの結果（price: null）を返す
  return fallbackResult;
}

async function scrapeRakuten(sanitizedUrl: string, deps?: MemberFetchDeps): Promise<ScrapedItem> {
  // SSRF対策: fetch直前にホスト名を再検証
  const hostname = getHostname(sanitizedUrl);
  if (!hostname || !RAKUTEN_DOMAINS.has(hostname)) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'rakuten',
      sourceName: '楽天市場',
    };
  }

  try {
    const response = await fetchWithRetry(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      },
    }, deps);
    const html = await readHtmlResponse(response);

    // Share the structured price / OG image / title fallback used by guests.
    // Modern Rakuten item_name spans can contain nested markup.
    const metadata = parseProductHtml(html, sanitizedUrl);

    // 商品名
    const nameMatch = html.match(/<span[^>]*class="[^"]*item_name[^"]*"[^>]*>([^<]+)</) ||
                      html.match(/<h1[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : metadata.name;

    // 価格
    const priceMatch = html.match(/([\d,]+)円/) || html.match(/¥([\d,]+)/);
    const price = metadata.price ?? (priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null);

    // 画像
    const imageMatch = html.match(/"image":\s*"([^"]+)"/) || html.match(/<img[^>]*class="[^"]*main[^"]*"[^>]*src="([^"]+)"/);
    const imageUrl = metadata.imageUrl ?? (imageMatch ? imageMatch[1] : null);

    return {
      name,
      price,
      imageUrl,
      source: 'rakuten',
      sourceName: '楽天市場',
    };
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      return { name: '無効なURL', price: null, imageUrl: null, source: 'rakuten', sourceName: '楽天市場' };
    }
    console.error('Rakuten product fetch failed');
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'rakuten',
      sourceName: '楽天市場',
    };
  }
}

async function scrapeGeneric(sanitizedUrl: string, deps: MemberFetchDeps | undefined, purpose: ScrapePurpose): Promise<ScrapedItem> {
  // SSRF対策: fetch直前にホスト名を再検証（ローカルIPをブロック）
  const actualHostname = getHostname(sanitizedUrl);
  if (!actualHostname ||
      actualHostname === 'localhost' ||
      actualHostname === '127.0.0.1' ||
      actualHostname.startsWith('192.168.') ||
      actualHostname.startsWith('10.') ||
      actualHostname.startsWith('172.16.') ||
      actualHostname.endsWith('.local')) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
    };
  }

  // 取得に失敗したとき、画像の補完の基準にする URL。HTTP エラーに限らず、接続切断や
  // タイムアウトでも、転送後は入力した商品へ戻さない。
  const trace: { url: string | null } = { url: sanitizedUrl };
  try {
    const { response, url: pageUrl } = await fetchPublicMember(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        // Shopifyサイトで日本円価格を取得するためのクッキー
        'Cookie': 'localization=JP; cart_currency=JPY',
      },
    }, { ...deps, trace });
    const html = await readHtmlResponse(response);

    // ツクモを経由した転送では、実際に商品情報を取得したページから写真と型番を選ぶ。
    const tsukumoRedirect = pageUrl !== sanitizedUrl && (tsukumoCatalogImage(sanitizedUrl) || tsukumoCatalogImage(pageUrl));
    const item = parseProductHtml(html, tsukumoRedirect ? pageUrl : sanitizedUrl);
    if (purpose === 'price' || item.failureCode || item.imageUrl) return item;
    return await recoverTsukumoImage(pageUrl, isUnusableScrape(item) ? undefined : item) ?? item;
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      return { name: '無効なURL', price: null, imageUrl: null, source: 'other', sourceName: null };
    }
    if (purpose === 'item' && trace.url) {
      const recovered = await recoverTsukumoImage(trace.url);
      if (recovered) return recovered;
    }
    console.error('Generic product fetch failed');
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
    };
  }
}
