import type { ScrapedItem } from './scraper';

function parseYenPrice(value: unknown): number | null {
  const price = Number(String(value).replace(/[,¥￥\s]/g, ''));
  return Number.isFinite(price) && price > 0 && price <= 1_000_000_000 ? Math.round(price) : null;
}

/**
 * Apple Store の構成（buy-）ページ。モデル未選択で単一価格が無い。
 * ページ内の「月額」「最低購入金額」「修理サービス料」などを商品価格と誤認しやすい。
 */
export function isAppleShopBuyPage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host !== 'www.apple.com' && host !== 'apple.com') return false;
    return /\/shop\/buy[-/]/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// 分割払い・月額・保証修理料など、商品本体の売価ではない円表記の近傍語。
const NON_PRODUCT_PRICE_HINT =
  /分割|月々|\/\s*月|円\s*\/\s*月|最低購入|ペイディ|あと払い|サービス料|AppleCare|修理|損傷|月額|金利|手数料|送料|配送料/;

function yenMatchLooksLikeProductPrice(html: string, index: number, matched: string): boolean {
  const start = Math.max(0, index - 80);
  const end = Math.min(html.length, index + matched.length + 48);
  return !NON_PRODUCT_PRICE_HINT.test(html.slice(start, end));
}

function firstProductYenMatch(
  html: string,
  pattern: RegExp,
): number | null {
  for (const match of html.matchAll(pattern)) {
    if (match.index == null) continue;
    if (!yenMatchLooksLikeProductPrice(html, match.index, match[0])) continue;
    const extracted = parseInt(match[1].replace(/,/g, ''), 10);
    if (extracted > 0) return extracted;
  }
  return null;
}

// Pure parser shared by member scraping and the bounded guest HTTP client.
export function parseProductHtml(html: string, sanitizedUrl: string): ScrapedItem {
  const hostname = new URL(sanitizedUrl).hostname;
  const appleBuyPage = isAppleShopBuyPage(sanitizedUrl);
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
              price = parseYenPrice(variant.offers.price);
              break;
            }
          }
        }
        
        // 直接のoffers（JPYを優先）
        if (!price && data.offers) {
          // offersが配列の場合
          if (Array.isArray(data.offers)) {
            for (const offer of data.offers) {
              if (offer.price && (offer.priceCurrency === 'JPY' || !offer.priceCurrency)) {
                price = parseYenPrice(offer.price);
                break;
              }
            }
          } else if (data.offers.price) {
            // offersがオブジェクトの場合
            if (data.offers.priceCurrency === 'JPY' || !data.offers.priceCurrency) {
              price = parseYenPrice(data.offers.price);
            }
          }
        }
        
        // @graphをチェック
        if (!price && data['@graph']) {
          for (const item of data['@graph']) {
            if (item.offers?.price) {
              if (item.offers.priceCurrency === 'JPY' || !item.offers.priceCurrency) {
                price = parseYenPrice(item.offers.price);
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

  // フォールバック: HTMLから価格パターンを検索。
  // Apple の構成ページは単一価格が無く、月額・修理料・最低購入金額を拾いやすいので
  // JSON-LD / og:price 以外の緩い円表記フォールバックは使わない（価格未取得）。
  if (!price && !appleBuyPage) {
    // EC-CUBE系サイトの販売価格（price02_default）を優先
    const eccubePriceMatch = html.match(/id="price02_default">([\d,]+)/);
    if (eccubePriceMatch) {
      price = parseInt(eccubePriceMatch[1].replace(/,/g, ''), 10);
    }
  }

  if (!price && !appleBuyPage) {
    // 「販売価格」の近くにある価格を探す（より厳密なパターン）
    // 「販売価格: 1,234円」や「販売価格：¥1,234」のような形式
    const salePriceMatch = html.match(/販売価格[\s：:]*¥?\s*([\d,]+)/);
    if (salePriceMatch) {
      const extracted = parseInt(salePriceMatch[1].replace(/,/g, ''), 10);
      if (extracted >= 100) { // 100円未満は除外
        price = extracted;
      }
    }
  }

  if (!price && !appleBuyPage) {
    // まず価格用のクラス/ID内の価格を探す（0円を除外）
    const structuredPriceMatches = html.matchAll(/<[^>]*(?:class|id)="[^"]*price[^"]*"[^>]*>\s*¥?\s*([\d,]+)/gi);
    for (const match of structuredPriceMatches) {
      if (match.index != null && !yenMatchLooksLikeProductPrice(html, match.index, match[0])) continue;
      const extracted = parseInt(match[1].replace(/,/g, ''), 10);
      if (extracted > 0) {
        price = extracted;
        break;
      }
    }
  }

  if (!price && !appleBuyPage) {
    // data-price属性
    const dataPriceMatch = html.match(/data-price="([\d,]+)"/);
    if (dataPriceMatch) {
      const extracted = parseInt(dataPriceMatch[1].replace(/,/g, ''), 10);
      if (extracted > 0) {
        price = extracted;
      }
    }
  }

  if (!price && !appleBuyPage) {
    // 一般的な価格パターン。分割払い・月額・保証修理料などの近傍は除外する。
    price = firstProductYenMatch(html, /([\d,]+)円/g);
  }

  if (!price && !appleBuyPage) {
    price = firstProductYenMatch(html, /¥\s*([\d,]+)/g)
      ?? firstProductYenMatch(html, /JPY\s*([\d,]+)/gi);
  }

  // OG画像
  let imageUrl: string | null = null;
  const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) ||
                       html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/);
  if (ogImageMatch) {
    imageUrl = ogImageMatch[1];
  }

  // OG画像がない場合のフォールバック
  if (!imageUrl) {
    // EC-CUBE系: class="picture" の画像
    const pictureMatch = html.match(/<img[^>]*class="[^"]*picture[^"]*"[^>]*src="([^"]+)"/) ||
                         html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*picture[^"]*"/);
    if (pictureMatch) {
      imageUrl = pictureMatch[1];
    }
  }

  if (!imageUrl) {
    // 商品画像っぽいパターン: product, main, item などを含むクラス/IDの画像
    const productImageMatch = html.match(/<img[^>]*(?:class|id)="[^"]*(?:product|main|item)[^"]*"[^>]*src="([^"]+)"/) ||
                              html.match(/<img[^>]*src="([^"]+)"[^>]*(?:class|id)="[^"]*(?:product|main|item)[^"]*"/);
    if (productImageMatch) {
      imageUrl = productImageMatch[1];
    }
  }

  // Resolve relative/CDN images and prefer HTTPS on secure product pages.
  if (imageUrl) {
    try {
      const image = new URL(imageUrl.replace(/&amp;/g, '&'), sanitizedUrl);
      if (image.protocol === 'http:' && sanitizedUrl.startsWith('https:')) image.protocol = 'https:';
      imageUrl = ['https:', 'http:'].includes(image.protocol) ? image.href : null;
    } catch { imageUrl = null; }
  }

  // ホスト名からソース名を生成
  const sourceName = hostname.replace(/^www\./, '').split('.')[0];

  return {
    name,
    price,
    imageUrl,
    source: 'other',
    sourceName: sourceName.charAt(0).toUpperCase() + sourceName.slice(1),
  };
}
