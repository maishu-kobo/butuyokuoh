export interface ScrapedItem {
  name: string;
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
}

export async function scrapeUrl(url: string): Promise<ScrapedItem> {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname.includes('amazon.co.jp') || hostname.includes('amazon.com')) {
    return scrapeAmazon(url);
  } else if (hostname.includes('rakuten.co.jp')) {
    return scrapeRakuten(url);
  } else {
    return scrapeGeneric(url, hostname);
  }
}

async function scrapeAmazon(url: string): Promise<ScrapedItem> {
  try {
    const response = await fetch(url, {
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

async function scrapeRakuten(url: string): Promise<ScrapedItem> {
  try {
    const response = await fetch(url, {
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

async function scrapeGeneric(url: string, hostname: string): Promise<ScrapedItem> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      },
    });
    const html = await response.text();

    // タイトルから商品名
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const name = titleMatch ? titleMatch[1].trim() : '不明な商品';

    // JSON-LDから価格取得を試行
    let price: number | null = null;
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          if (data.offers?.price) {
            price = parseInt(data.offers.price, 10);
            break;
          } else if (data['@graph']) {
            for (const item of data['@graph']) {
              if (item.offers?.price) {
                price = parseInt(item.offers.price, 10);
                break;
              }
            }
          }
        } catch {
          // JSONパース失敗は無視
        }
      }
    }

    // フォールバック: HTMLから価格パターンを検索
    if (!price) {
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
