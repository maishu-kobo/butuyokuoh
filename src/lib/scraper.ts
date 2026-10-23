import { extractAmazonProduct } from './amazon-product';
import { parseProductHtml } from './product-html';
import { readHtmlResponse } from './html-encoding';
import puppeteer from 'puppeteer';
import { validateAndSanitizeUrl, sanitizeGenericUrl } from './url-validator';
import { BlockedTargetError, fetchPublicMember, HttpError, resolvedPublicAddress, type MemberFetchDeps } from './member-fetch';

export { HttpError };
export type FetchWithRetryOptions = MemberFetchDeps;

export interface ScrapedItem {
  name: string;
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
  note?: string; // ユーザーへのメッセージ（短縮リンクの制限など）
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
 * 短縮リンクを展開してリダイレクト先のURLを取得
 * @param url 短縮リンクURL（事前にisAmazonShortUrlで検証済み）
 * @returns 展開後のURL（失敗した場合はnull）
 */
async function expandShortUrl(url: string, deps?: MemberFetchDeps): Promise<string | null> {
  // SSRF対策: ホワイトリストのドメインから安全なURLを構築
  const safeUrl = buildSafeShortUrl(url);
  if (!safeUrl) {
    console.error('SSRF protection: URL is not an Amazon short URL:', url);
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
    console.log('Final URL after redirect:', finalUrl);
    
    // SSRF対策: リダイレクト先がAmazonドメインのみ許可
    if (isAmazonUrl(finalUrl)) {
      return finalUrl;
    }
    
    console.error('SSRF protection: Redirect destination is not Amazon:', finalUrl);
    return null;
  } catch (error) {
    console.error('Short URL expansion error:', error);
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
  if (/[\u0000-\u0020\\]/.test(value) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return null;
  }
  const pc = parsed.searchParams.get('pc');
  if (!pc || /[\u0000-\u0020\\]/.test(pc)) return null;
  let product: URL;
  try {
    product = new URL(pc);
  } catch {
    return null;
  }
  if (product.protocol !== 'https:' || product.username || product.password || product.port || product.hostname !== 'item.rakuten.co.jp') {
    return null;
  }
  return `${product.origin}${product.pathname}${product.search}`;
}

export async function scrapeUrl(url: string, deps?: MemberFetchDeps): Promise<ScrapedItem> {
  // Amazonの短縮リンクの場合、展開を試みる
  if (isAmazonShortUrl(url)) {
    console.log('Detected Amazon short URL, attempting to expand:', url);
    const expandedUrl = await expandShortUrl(url, deps);
    
    if (expandedUrl) {
      console.log('Expanded to:', expandedUrl);
      
      // 展開後のURLが商品ページかチェック
      if (isAmazonProductUrl(expandedUrl)) {
        // 展開成功 - 通常のAmazonスクレイピングを実行
        const result = await scrapeAmazon(expandedUrl, deps);
        // 短縮リンクからの登録の場合、価格が取得できない可能性があることを伝える
        if (!result.price) {
          result.note = '短縮リンクからの登録のため価格を取得できませんでした。商品ページのフルURLで登録し直すと価格を取得できる場合があります。';
        }
        return result;
      } else {
        // 商品ページではない（トップページや検索ページにリダイレクトされた）
        console.log('Expanded URL is not a product page:', expandedUrl);
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

  return scrapeGeneric(genericValidation.sanitizedUrl, deps);
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

/**
 * Puppeteer（ヘッドレスブラウザ）でAmazon商品ページを取得するフォールバック
 * 素のfetchがAmazonのボット対策に弾かれた場合に使用する
 * @returns 取得したScrapedItem（ボット検知された場合はnull）
 */
async function scrapeAmazonWithPuppeteer(sanitizedUrl: string, deps?: MemberFetchDeps): Promise<ScrapedItem | null> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

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

    await page.goto(sanitizedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

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

async function scrapeAmazon(sanitizedUrl: string, deps?: MemberFetchDeps): Promise<ScrapedItem> {
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
      fallbackResult = {
        name: 'Amazonのボット対策により価格を取得できませんでした',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
        note: 'Amazonのボット対策により自動取得が制限されています。価格は手動で編集してください。',
      };
    } else {
      const { name, price, imageUrl } = extractAmazonProduct(html);

      const result: ScrapedItem = {
        name,
        price,
        imageUrl,
        source: 'amazon',
        sourceName: 'Amazon',
      };

      // 価格が取得できた場合はそのまま返す
      if (price !== null) {
        return result;
      }

      // 価格が抽出できなかった場合はPuppeteerフォールバックを試す
      fallbackResult = result;
    }
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      return { name: '無効なURL', price: null, imageUrl: null, source: 'amazon', sourceName: 'Amazon' };
    }
    // fetchWithRetryのリトライが尽きた場合もPuppeteerフォールバックを試す
    console.error('Amazon scraping error:', error);

    // 404/410等の恒久的な非リトライ4xx（429は除く）はPuppeteerを起動しても無駄なので即座に返す
    if (
      error instanceof HttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    ) {
      return {
        name: '取得失敗',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
      };
    }

    fallbackResult = {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'amazon',
      sourceName: 'Amazon',
    };
  }

  // Puppeteerフォールバック: ボット検知・fetch失敗・価格抽出失敗のいずれかで発動
  console.log('Falling back to Puppeteer for Amazon scraping:', sanitizedUrl);
  try {
    const puppeteerResult = await scrapeAmazonWithPuppeteer(sanitizedUrl, deps);
    if (puppeteerResult && puppeteerResult.price !== null) {
      return puppeteerResult;
    }
  } catch (error) {
    console.error('Amazon Puppeteer fallback error:', error);
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
    console.error('Rakuten scraping error:', error);
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'rakuten',
      sourceName: '楽天市場',
    };
  }
}

async function scrapeGeneric(sanitizedUrl: string, deps?: MemberFetchDeps): Promise<ScrapedItem> {
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

  try {
    const response = await fetchWithRetry(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        // Shopifyサイトで日本円価格を取得するためのクッキー
        'Cookie': 'localization=JP; cart_currency=JPY',
      },
    }, deps);
    const html = await readHtmlResponse(response);

    return parseProductHtml(html, sanitizedUrl);
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      return { name: '無効なURL', price: null, imageUrl: null, source: 'other', sourceName: null };
    }
    console.error('Generic scraping error:', error);
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
    };
  }
}
