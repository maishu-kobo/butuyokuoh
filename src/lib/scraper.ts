import { validateAndSanitizeUrl, sanitizeGenericUrl } from './url-validator';

export interface ScrapedItem {
  name: string;
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
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
 * 短縮リンクを展開して実際のURLを取得（最大5回リダイレクトを追跡）
 */
async function expandShortUrl(shortUrl: string): Promise<string | null> {
  let currentUrl = shortUrl;
  const maxRedirects = 5;
  
  for (let i = 0; i < maxRedirects; i++) {
    try {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      // リダイレクトでなければ終了
      if (response.status < 300 || response.status >= 400) {
        break;
      }
      
      const location = response.headers.get('location');
      if (!location) {
        break;
      }
      
      // 相対 URL の場合は絶対 URL に変換
      if (location.startsWith('/')) {
        const parsed = new URL(currentUrl);
        currentUrl = `${parsed.protocol}//${parsed.hostname}${location}`;
      } else if (location.startsWith('http')) {
        currentUrl = location;
      } else {
        break;
      }
      
      // Amazonの商品ページに到達したら終了
      const hostname = getHostname(currentUrl);
      if (hostname && AMAZON_DOMAINS.has(hostname) && currentUrl.includes('/dp/')) {
        return currentUrl;
      }
    } catch {
      break;
    }
  }
  
  // 最終的なURLを返す（Amazonドメインの場合のみ）
  const finalHostname = getHostname(currentUrl);
  if (finalHostname && AMAZON_DOMAINS.has(finalHostname)) {
    return currentUrl;
  }
  
  return null;
}

export async function scrapeUrl(url: string): Promise<ScrapedItem> {
  // Amazonの短縮リンクの場合、展開して実際のURLを取得
  let targetUrl = url;
  if (isAmazonShortUrl(url)) {
    const expandedUrl = await expandShortUrl(url);
    if (expandedUrl) {
      // リダイレクト先がAmazonの場合のみ使用
      const expandedHostname = getHostname(expandedUrl);
      if (expandedHostname && AMAZON_DOMAINS.has(expandedHostname)) {
        targetUrl = expandedUrl;
      }
    }
  }

  const validation = validateAndSanitizeUrl(targetUrl);

  if (validation.isValid) {
    // 許可されたドメインの場合
    if (validation.source === 'amazon') {
      return scrapeAmazon(validation.sanitizedUrl);
    } else if (validation.source === 'rakuten') {
      return scrapeRakuten(validation.sanitizedUrl);
    }
  }

  // 許可リスト外のドメインの場合、一般的なスクレイピング
  const genericValidation = sanitizeGenericUrl(targetUrl);
  if (!genericValidation.isValid) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
    };
  }

  return scrapeGeneric(genericValidation.sanitizedUrl, genericValidation.hostname);
}

async function scrapeAmazon(sanitizedUrl: string): Promise<ScrapedItem> {
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

  try {
    const response = await fetch(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      },
    });
    const html = await response.text();

    // 商品名
    const nameMatch = html.match(/<span[^>]*id="productTitle"[^>]*>([^<]+)<\/span>/);
    const name = nameMatch ? nameMatch[1].trim() : '不明な商品';

    // 価格
    const priceMatch = html.match(/¥([\d,]+)/) || html.match(/\\([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    // 画像
    const imageMatch = html.match(/"hiRes":"([^"]+)"/) || html.match(/id="landingImage"[^>]*src="([^"]+)"/);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    return {
      name,
      price,
      imageUrl,
      source: 'amazon',
      sourceName: 'Amazon',
    };
  } catch (error) {
    console.error('Amazon scraping error:', error);
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'amazon',
      sourceName: 'Amazon',
    };
  }
}

async function scrapeRakuten(sanitizedUrl: string): Promise<ScrapedItem> {
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
    const response = await fetch(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      },
    });
    const html = await response.text();

    // 商品名
    const nameMatch = html.match(/<span[^>]*class="[^"]*item_name[^"]*"[^>]*>([^<]+)</) ||
                      html.match(/<h1[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : '不明な商品';

    // 価格
    const priceMatch = html.match(/([\d,]+)円/) || html.match(/¥([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    // 画像
    const imageMatch = html.match(/"image":\s*"([^"]+)"/) || html.match(/<img[^>]*class="[^"]*main[^"]*"[^>]*src="([^"]+)"/);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    return {
      name,
      price,
      imageUrl,
      source: 'rakuten',
      sourceName: '楽天市場',
    };
  } catch (error) {
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

async function scrapeGeneric(sanitizedUrl: string, hostname: string): Promise<ScrapedItem> {
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
    const response = await fetch(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        // Shopifyサイトで日本円価格を取得するためのクッキー
        'Cookie': 'localization=JP; cart_currency=JPY',
      },
    });
    const html = await response.text();

    // タイトルから商品名
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let name = titleMatch ? titleMatch[1].trim() : '不明な商品';
    // タイトルのクリーンアップ: 改行、HTMLエンティティ、サイト名の区切り文字などを除去
    name = name
      .replace(/\n/g, ' ')                    // 改行をスペースに
      .replace(/&ndash;/g, '-')               // &ndash; を - に
      .replace(/&mdash;/g, '-')               // &mdash; を - に
      .replace(/&amp;/g, '&')                 // &amp; を & に
      .replace(/&quot;/g, '"')                // &quot; を " に
      .replace(/&#39;/g, "'")                 // &#39; を ' に
      .replace(/\s*[-|–—]\s*[^-|–—]+$/g, '')  // 末尾のサイト名部分を除去 ("- SITE_NAME" など)
      .replace(/\s+/g, ' ')                   // 連続スペースを単一に
      .trim();

    // JSON-LDから価格取得を試行
    let price: number | null = null;
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        if (price) break;
        try {
          // scriptタグを完全に除去（ループで繰り返し置換）
          let jsonContent = match;
          let prevLength = 0;
          while (jsonContent.length !== prevLength) {
            prevLength = jsonContent.length;
            jsonContent = jsonContent.replace(/<script[^>]*>/gi, '');
            jsonContent = jsonContent.replace(/<\/script>/gi, '');
          }
          const data = JSON.parse(jsonContent);
          
          // hasVariant配列をチェック（Shopifyなど）- JPYを優先
          if (data.hasVariant && Array.isArray(data.hasVariant)) {
            for (const variant of data.hasVariant) {
              if (variant.offers?.price && variant.offers?.priceCurrency === 'JPY') {
                price = parseInt(String(variant.offers.price).replace(/[^0-9]/g, ''), 10);
                break;
              }
            }
          }
          
          // 直接のoffers（JPYを優先）
          if (!price && data.offers?.price) {
            if (data.offers.priceCurrency === 'JPY' || !data.offers.priceCurrency) {
              price = parseInt(String(data.offers.price).replace(/[^0-9]/g, ''), 10);
            }
          }
          
          // @graphをチェック
          if (!price && data['@graph']) {
            for (const item of data['@graph']) {
              if (item.offers?.price) {
                if (item.offers.priceCurrency === 'JPY' || !item.offers.priceCurrency) {
                  price = parseInt(String(item.offers.price).replace(/[^0-9]/g, ''), 10);
                  break;
                }
              }
            }
          }
        } catch {
          // JSONパース失敗は無視
        }
      }
    }

    // Shopify/EC サイトのJSON価格取得（JPY通貨を優先）
    if (!price) {
      // "price":"NNNNN","priceCurrency":"JPY" パターン（引用符付き価格）
      const jpyQuotedMatch = html.match(/"price"\s*:\s*"(\d+)"\s*,\s*"priceCurrency"\s*:\s*"JPY"/);
      if (jpyQuotedMatch) {
        price = parseInt(jpyQuotedMatch[1], 10);
      }
    }
    
    if (!price) {
      // Shopifyサイトのセント単位価格（Shopifyかどうかを確認）
      const isShopify = html.includes('cdn.shopify.com') || html.includes('Shopify.theme');
      if (isShopify) {
        // Shopifyの場合、"price":NNNNNN (5桁以上、セント単位) をJPYとみなす
        const shopifyPriceMatch = html.match(/"price":(\d{5,})/);
        if (shopifyPriceMatch) {
          // 100で割って円に変換
          price = Math.round(parseInt(shopifyPriceMatch[1], 10) / 100);
        }
      }
    }

    // og:price:amount メタタグから価格取得（通貨がJPYの場合のみ）
    if (!price) {
      const ogCurrencyMatch = html.match(/<meta[^>]*property="og:price:currency"[^>]*content="([^"]+)"/);
      const currency = ogCurrencyMatch ? ogCurrencyMatch[1] : null;
      
      if (currency === 'JPY') {
        const ogPriceMatch = html.match(/<meta[^>]*property="og:price:amount"[^>]*content="([^"]+)"/) ||
                             html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:price:amount"/);
        if (ogPriceMatch) {
          price = parseInt(ogPriceMatch[1].replace(/,/g, ''), 10);
        }
      }
    }

    // フォールバック: HTMLから価格パターンを検索
    if (!price) {
      // まず価格用のクラス/ID内の価格を探す
      const structuredPriceMatch = 
        html.match(/<[^>]*class="[^"]*price[^"]*"[^>]*>\s*([\d,]+)円/i) ||
        html.match(/<[^>]*class="[^"]*price[^"]*"[^>]*>\s*¥?\s*([\d,]+)/i) ||
        html.match(/<[^>]*id="[^"]*price[^"]*"[^>]*>\s*([\d,]+)円/i) ||
        html.match(/data-price="([\d,]+)"/);
      if (structuredPriceMatch) {
        price = parseInt(structuredPriceMatch[1].replace(/,/g, ''), 10);
      }
    }
    
    if (!price) {
      // 一般的な価格パターン
      const priceMatch = html.match(/([\d,]+)円/) || html.match(/¥\s*([\d,]+)/) || html.match(/JPY\s*([\d,]+)/i);
      if (priceMatch) {
        price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      }
    }

    // OG画像
    const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) ||
                       html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    // ホスト名からソース名を生成
    const sourceName = hostname.replace(/^www\./, '').split('.')[0];

    return {
      name,
      price,
      imageUrl,
      source: 'other',
      sourceName: sourceName.charAt(0).toUpperCase() + sourceName.slice(1),
    };
  } catch (error) {
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
