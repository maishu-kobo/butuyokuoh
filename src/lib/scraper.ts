import { validateAndSanitizeUrl, sanitizeGenericUrl } from './url-validator';
import { StockStatus } from '@/types';

export interface ScrapedItem {
  name: string;
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
  stockStatus: StockStatus;
  note?: string; // ユーザーへのメッセージ（短縮リンクの制限など）
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
    return path.includes('/dp/') || 
           path.includes('/gp/product/') || 
           path.includes('/gp/aw/d/');
  } catch {
    return false;
  }
}

/**
 * 短縮リンクURLを安全に構築する（SSRF対策）
 */
function buildSafeShortUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    
    if (!AMAZON_SHORT_DOMAINS.has(hostname)) {
      return null;
    }
    
    return `https://${hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * 短縮リンクを展開してリダイレクト先のURLを取得
 */
async function expandShortUrl(url: string): Promise<string | null> {
  const safeUrl = buildSafeShortUrl(url);
  if (!safeUrl) {
    console.error('SSRF protection: URL is not an Amazon short URL:', url);
    return null;
  }
  
  try {
    const response = await fetch(safeUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9',
      },
    });
    
    const finalUrl = response.url;
    console.log('Final URL after redirect:', finalUrl);
    
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

/**
 * Amazonの在庫状態を判定
 */
function detectAmazonStockStatus(html: string): StockStatus {
  // id="availability" 内のテキストをチェック
  const availabilityMatch = html.match(/<div[^>]*id="availability"[^>]*>([\s\S]*?)<\/div>/i);
  if (availabilityMatch) {
    const availabilityText = availabilityMatch[1].toLowerCase();
    
    // 在庫あり
    if (availabilityText.includes('在庫あり') || 
        availabilityText.includes('in stock') ||
        availabilityText.includes('残り') ||
        availabilityText.includes('お届け')) {
      return 'in_stock';
    }
    
    // 在庫切れ
    if (availabilityText.includes('在庫切れ') || 
        availabilityText.includes('out of stock') ||
        availabilityText.includes('お取り扱いできません') ||
        availabilityText.includes('currently unavailable')) {
      return 'out_of_stock';
    }
  }
  
  // カートに入れるボタンの有無でも判定
  if (html.includes('add-to-cart-button') || html.includes('buy-now-button')) {
    return 'in_stock';
  }
  
  // 「現在在庫切れです」のメッセージ
  if (html.includes('現在在庫切れです') || html.includes('Currently unavailable')) {
    return 'out_of_stock';
  }
  
  return 'unknown';
}

/**
 * 楽天の在庫状態を判定
 */
function detectRakutenStockStatus(html: string): StockStatus {
  const lowerHtml = html.toLowerCase();
  
  // 在庫切れパターン
  if (lowerHtml.includes('sold out') ||
      lowerHtml.includes('品切れ') ||
      lowerHtml.includes('売り切れ') ||
      lowerHtml.includes('入荷待ち') ||
      lowerHtml.includes('在庫切れ') ||
      lowerHtml.includes('予約受付終了')) {
    return 'out_of_stock';
  }
  
  // カートボタンや購入ボタンがあれば在庫あり
  if (html.includes('買い物かごに入れる') || 
      html.includes('カートに入れる') ||
      html.includes('購入手続きへ')) {
    return 'in_stock';
  }
  
  return 'unknown';
}

/**
 * 一般サイトの在庫状態を判定
 */
function detectGenericStockStatus(html: string): StockStatus {
  const lowerHtml = html.toLowerCase();
  
  // 在庫切れパターン
  if (lowerHtml.includes('sold out') ||
      lowerHtml.includes('out of stock') ||
      lowerHtml.includes('品切れ') ||
      lowerHtml.includes('売り切れ') ||
      lowerHtml.includes('在庫切れ') ||
      lowerHtml.includes('入荷待ち') ||
      lowerHtml.includes('完売')) {
    return 'out_of_stock';
  }
  
  // 在庫ありパターン
  if (lowerHtml.includes('in stock') ||
      lowerHtml.includes('在庫あり') ||
      lowerHtml.includes('カートに入れる') ||
      lowerHtml.includes('add to cart') ||
      lowerHtml.includes('buy now')) {
    return 'in_stock';
  }
  
  return 'unknown';
}

export async function scrapeUrl(url: string): Promise<ScrapedItem> {
  // Amazonの短縮リンクの場合、展開を試みる
  if (isAmazonShortUrl(url)) {
    console.log('Detected Amazon short URL, attempting to expand:', url);
    const expandedUrl = await expandShortUrl(url);
    
    if (expandedUrl) {
      console.log('Expanded to:', expandedUrl);
      
      if (isAmazonProductUrl(expandedUrl)) {
        const result = await scrapeAmazon(expandedUrl);
        if (!result.price) {
          result.note = '短縮リンクからの登録のため価格を取得できませんでした。商品ページのフルURLで登録し直すと価格を取得できる場合があります。';
        }
        return result;
      } else {
        console.log('Expanded URL is not a product page:', expandedUrl);
        return {
          name: '短縮リンクの展開に失敗しました。リンクが期限切れか無効な可能性があります。',
          price: null,
          imageUrl: null,
          source: 'amazon',
          sourceName: 'Amazon',
          stockStatus: 'unknown',
        };
      }
    } else {
      console.log('Failed to expand short URL');
      return {
        name: 'Amazonの短縮リンクを展開できませんでした。通常のURLをお試しください。',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
        stockStatus: 'unknown',
      };
    }
  }

  const validation = validateAndSanitizeUrl(url);

  if (validation.isValid) {
    if (validation.source === 'amazon') {
      return scrapeAmazon(validation.sanitizedUrl);
    } else if (validation.source === 'rakuten') {
      return scrapeRakuten(validation.sanitizedUrl);
    }
  }

  const genericValidation = sanitizeGenericUrl(url);
  if (!genericValidation.isValid) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
      stockStatus: 'unknown',
    };
  }

  return scrapeGeneric(genericValidation.sanitizedUrl, genericValidation.hostname);
}

async function scrapeAmazon(sanitizedUrl: string): Promise<ScrapedItem> {
  const hostname = getHostname(sanitizedUrl);
  if (!hostname || !AMAZON_DOMAINS.has(hostname)) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'amazon',
      sourceName: 'Amazon',
      stockStatus: 'unknown',
    };
  }

  try {
    const response = await fetch(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9',
        'Cookie': 'i18n-prefs=JPY; lc-acbjp=ja_JP',
      },
    });
    const html = await response.text();

    if (html.includes('api-services-support@amazon.com') || 
        html.includes('Service Unavailable') ||
        html.includes('ロボットではない') ||
        html.includes('automated access') ||
        !html.includes('productTitle')) {
      console.log('Amazon bot detection or error page detected');
      return {
        name: 'Amazonのボット対策により価格を取得できませんでした',
        price: null,
        imageUrl: null,
        source: 'amazon',
        sourceName: 'Amazon',
        stockStatus: 'unknown',
        note: 'Amazonのボット対策により自動取得が制限されています。価格は手動で編集してください。',
      };
    }

    const nameMatch = html.match(/<span[^>]*id="productTitle"[^>]*>([^<]+)<\/span>/);
    const name = nameMatch ? nameMatch[1].trim() : '不明な商品';

    let price: number | null = null;
    const priceWholeMatch = html.match(/a-price-whole">([\d,]+)/);
    if (priceWholeMatch) {
      price = parseInt(priceWholeMatch[1].replace(/,/g, ''), 10);
    }

    const imageMatch = html.match(/"hiRes":"([^"]+)"/) || html.match(/id="landingImage"[^>]*src="([^"]+)"/);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    const stockStatus = detectAmazonStockStatus(html);

    return {
      name,
      price,
      imageUrl,
      source: 'amazon',
      sourceName: 'Amazon',
      stockStatus,
    };
  } catch (error) {
    console.error('Amazon scraping error:', error);
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'amazon',
      sourceName: 'Amazon',
      stockStatus: 'unknown',
    };
  }
}

async function scrapeRakuten(sanitizedUrl: string): Promise<ScrapedItem> {
  const hostname = getHostname(sanitizedUrl);
  if (!hostname || !RAKUTEN_DOMAINS.has(hostname)) {
    return {
      name: '無効なURL',
      price: null,
      imageUrl: null,
      source: 'rakuten',
      sourceName: '楽天市場',
      stockStatus: 'unknown',
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

    const nameMatch = html.match(/<span[^>]*class="[^"]*item_name[^"]*"[^>]*>([^<]+)</) ||
                      html.match(/<h1[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : '不明な商品';

    const priceMatch = html.match(/([\d,]+)円/) || html.match(/¥([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    const imageMatch = html.match(/"image":\s*"([^"]+)"/) || html.match(/<img[^>]*class="[^"]*main[^"]*"[^>]*src="([^"]+)"/);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    const stockStatus = detectRakutenStockStatus(html);

    return {
      name,
      price,
      imageUrl,
      source: 'rakuten',
      sourceName: '楽天市場',
      stockStatus,
    };
  } catch (error) {
    console.error('Rakuten scraping error:', error);
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'rakuten',
      sourceName: '楽天市場',
      stockStatus: 'unknown',
    };
  }
}

async function scrapeGeneric(sanitizedUrl: string, hostname: string): Promise<ScrapedItem> {
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
      stockStatus: 'unknown',
    };
  }

  try {
    const response = await fetch(sanitizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        'Cookie': 'localization=JP; cart_currency=JPY',
      },
    });
    const html = await response.text();

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let name = titleMatch ? titleMatch[1].trim() : '不明な商品';
    name = name
      .replace(/\n/g, ' ')
      .replace(/&ndash;/g, '-')
      .replace(/&mdash;/g, '-')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s*[-|–—]\s*[^-|–—]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    let price: number | null = null;
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        if (price) break;
        try {
          let jsonContent = match;
          let prevLength = 0;
          while (jsonContent.length !== prevLength) {
            prevLength = jsonContent.length;
            jsonContent = jsonContent.replace(/<script[^>]*>/gi, '');
            jsonContent = jsonContent.replace(/<\/script>/gi, '');
          }
          const data = JSON.parse(jsonContent);
          
          if (data.hasVariant && Array.isArray(data.hasVariant)) {
            for (const variant of data.hasVariant) {
              if (variant.offers?.price && variant.offers?.priceCurrency === 'JPY') {
                price = parseInt(String(variant.offers.price).replace(/[^0-9]/g, ''), 10);
                break;
              }
            }
          }
          
          if (!price && data.offers) {
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price && (offer.priceCurrency === 'JPY' || !offer.priceCurrency)) {
                  price = parseInt(String(offer.price).replace(/[^0-9]/g, ''), 10);
                  break;
                }
              }
            } else if (data.offers.price) {
              if (data.offers.priceCurrency === 'JPY' || !data.offers.priceCurrency) {
                price = parseInt(String(data.offers.price).replace(/[^0-9]/g, ''), 10);
              }
            }
          }
          
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

    if (!price) {
      const jpyQuotedMatch = html.match(/"price"\s*:\s*"(\d+)"\s*,\s*"priceCurrency"\s*:\s*"JPY"/);
      if (jpyQuotedMatch) {
        price = parseInt(jpyQuotedMatch[1], 10);
      }
    }
    
    if (!price) {
      const isShopify = html.includes('cdn.shopify.com') || html.includes('Shopify.theme');
      if (isShopify) {
        const shopifyPriceMatch = html.match(/"price":(\d{5,})/);
        if (shopifyPriceMatch) {
          price = Math.round(parseInt(shopifyPriceMatch[1], 10) / 100);
        }
      }
    }

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

    if (!price) {
      const eccubePriceMatch = html.match(/id="price02_default">([\d,]+)/);
      if (eccubePriceMatch) {
        price = parseInt(eccubePriceMatch[1].replace(/,/g, ''), 10);
      }
    }

    if (!price) {
      const salePriceMatch = html.match(/販売価格[\s：:]*¥?\s*([\d,]+)/);
      if (salePriceMatch) {
        const extracted = parseInt(salePriceMatch[1].replace(/,/g, ''), 10);
        if (extracted >= 100) {
          price = extracted;
        }
      }
    }

    if (!price) {
      const structuredPriceMatches = html.matchAll(/<[^>]*(?:class|id)="[^"]*price[^"]*"[^>]*>\s*¥?\s*([\d,]+)/gi);
      for (const match of structuredPriceMatches) {
        const extracted = parseInt(match[1].replace(/,/g, ''), 10);
        if (extracted > 0) {
          price = extracted;
          break;
        }
      }
    }

    if (!price) {
      const dataPriceMatch = html.match(/data-price="([\d,]+)"/);
      if (dataPriceMatch) {
        const extracted = parseInt(dataPriceMatch[1].replace(/,/g, ''), 10);
        if (extracted > 0) {
          price = extracted;
        }
      }
    }
    
    if (!price) {
      const priceMatches = html.matchAll(/([\d,]+)円/g);
      for (const match of priceMatches) {
        const extracted = parseInt(match[1].replace(/,/g, ''), 10);
        if (extracted > 0) {
          price = extracted;
          break;
        }
      }
    }

    if (!price) {
      const yenMatch = html.match(/¥\s*([\d,]+)/) || html.match(/JPY\s*([\d,]+)/i);
      if (yenMatch) {
        const extracted = parseInt(yenMatch[1].replace(/,/g, ''), 10);
        if (extracted > 0) {
          price = extracted;
        }
      }
    }

    let imageUrl: string | null = null;
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) ||
                         html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/);
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1];
    }

    if (!imageUrl) {
      const pictureMatch = html.match(/<img[^>]*class="[^"]*picture[^"]*"[^>]*src="([^"]+)"/) ||
                           html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*picture[^"]*"/);
      if (pictureMatch) {
        imageUrl = pictureMatch[1];
      }
    }

    if (!imageUrl) {
      const productImageMatch = html.match(/<img[^>]*(?:class|id)="[^"]*(?:product|main|item)[^"]*"[^>]*src="([^"]+)"/) ||
                                html.match(/<img[^>]*src="([^"]+)"[^>]*(?:class|id)="[^"]*(?:product|main|item)[^"]*"/);
      if (productImageMatch) {
        imageUrl = productImageMatch[1];
      }
    }

    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        const urlObj = new URL(sanitizedUrl);
        imageUrl = imageUrl.startsWith('/') 
          ? `${urlObj.protocol}//${urlObj.host}${imageUrl}`
          : `${urlObj.protocol}//${urlObj.host}/${imageUrl}`;
      } catch {
        // URL変換失敗時はそのまま
      }
    }

    const sourceName = hostname.replace(/^www\./, '').split('.')[0];
    const stockStatus = detectGenericStockStatus(html);

    return {
      name,
      price,
      imageUrl,
      source: 'other',
      sourceName: sourceName.charAt(0).toUpperCase() + sourceName.slice(1),
      stockStatus,
    };
  } catch (error) {
    console.error('Generic scraping error:', error);
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
      stockStatus: 'unknown',
    };
  }
}
