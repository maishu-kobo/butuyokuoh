import puppeteer from 'puppeteer';

export interface WishlistItem {
  name: string;
  url: string;
  price: number | null;
  imageUrl: string | null;
}

export interface WishlistResult {
  source: 'amazon' | 'rakuten';
  listName: string;
  items: WishlistItem[];
  error?: string;
}

export async function scrapeAmazonWishlist(listUrl: string): Promise<WishlistResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    });

    await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // リスト名を取得
    const listName = await page.$eval(
      '#profile-list-name, [data-csa-c-content-id] h1, h1',
      (el) => el.textContent?.trim() || 'Amazon ほしいものリスト'
    ).catch(() => 'Amazon ほしいものリスト');

    // スクロールして全アイテムを読み込む
    let previousHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) break;
      previousHeight = currentHeight;
    }

    // アイテムを抽出
    const items = await page.evaluate(() => {
      const results: WishlistItem[] = [];
      
      // Amazon wishlist item selectors
      const itemElements = document.querySelectorAll('[data-itemid], li[data-id], .g-item-sortable');
      
      itemElements.forEach((item) => {
        try {
          // 商品名
          const nameEl = item.querySelector('[id*="itemName"], .a-link-normal[title], h2 a, .g-title a');
          const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('title')?.trim();
          
          // URL
          const linkEl = item.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]') as HTMLAnchorElement;
          let url = linkEl?.href || '';
          
          // URLをクリーンアップ（相対パスの場合）
          if (url && !url.startsWith('http')) {
            url = 'https://www.amazon.co.jp' + url;
          }
          // パラメータを除去してクリーンなURLに（元のドメインを保持）
          if (url) {
            const match = url.match(/\/dp\/([A-Z0-9]+)/) || url.match(/\/gp\/product\/([A-Z0-9]+)/);
            if (match) {
              // 元のドメインを抽出（amazon.jp, amazon.co.jp, amazon.com）
              const domainMatch = url.match(/https?:\/\/(www\.)?amazon\.(co\.jp|jp|com)/);
              const domain = domainMatch ? `https://www.amazon.${domainMatch[2]}` : 'https://www.amazon.co.jp';
              url = `${domain}/dp/${match[1]}`;
            }
          }
          
          // 価格
          const priceEl = item.querySelector('[id*="itemPrice"], .a-price .a-offscreen, .a-color-price');
          const priceText = priceEl?.textContent || '';
          const priceMatch = priceText.match(/([\d,]+)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
          
          // 画像
          const imgEl = item.querySelector('img[src*="images-amazon"], img[src*="m.media-amazon"]') as HTMLImageElement;
          const imageUrl = imgEl?.src || null;
          
          if (name && url) {
            results.push({ name, url, price, imageUrl });
          }
        } catch (e) {
          // スキップ
        }
      });
      
      return results;
    });

    return {
      source: 'amazon',
      listName,
      items,
    };
  } catch (error) {
    console.error('Amazon wishlist scraping error:', error);
    return {
      source: 'amazon',
      listName: 'エラー',
      items: [],
      error: error instanceof Error ? error.message : 'スクレイピングに失敗しました',
    };
  } finally {
    await browser.close();
  }
}

export async function scrapeRakutenFavorites(listUrl: string): Promise<WishlistResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    });

    await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // スクロールして全アイテムを読み込む
    let previousHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) break;
      previousHeight = currentHeight;
    }

    // アイテムを抽出
    const items = await page.evaluate(() => {
      const results: WishlistItem[] = [];
      
      // 楽天お気に入りのアイテム
      const itemElements = document.querySelectorAll('.rnkRanking_item, .searchresultitem, [data-item-id], .item');
      
      itemElements.forEach((item) => {
        try {
          // 商品名
          const nameEl = item.querySelector('.title a, h2 a, .itemName a, a.title');
          const name = nameEl?.textContent?.trim();
          
          // URL
          const linkEl = item.querySelector('a[href*="item.rakuten.co.jp"], a[href*="product.rakuten.co.jp"]') as HTMLAnchorElement;
          const url = linkEl?.href || '';
          
          // 価格
          const priceEl = item.querySelector('.price, .important, [class*="price"]');
          const priceText = priceEl?.textContent || '';
          const priceMatch = priceText.match(/([\d,]+)/);
          const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
          
          // 画像
          const imgEl = item.querySelector('img[src*="thumbnail"], img[src*="r.r10s.jp"]') as HTMLImageElement;
          const imageUrl = imgEl?.src || null;
          
          if (name && url) {
            results.push({ name, url, price, imageUrl });
          }
        } catch (e) {
          // スキップ
        }
      });
      
      return results;
    });

    return {
      source: 'rakuten',
      listName: '楽天 お気に入り',
      items,
    };
  } catch (error) {
    console.error('Rakuten favorites scraping error:', error);
    return {
      source: 'rakuten',
      listName: 'エラー',
      items: [],
      error: error instanceof Error ? error.message : 'スクレイピングに失敗しました',
    };
  } finally {
    await browser.close();
  }
}

export async function scrapeWishlist(listUrl: string): Promise<WishlistResult> {
  const url = new URL(listUrl);
  const hostname = url.hostname.toLowerCase();

  if (hostname.includes('amazon.co.jp') || hostname.includes('amazon.jp') || hostname.includes('amazon.com')) {
    return scrapeAmazonWishlist(listUrl);
  } else if (hostname.includes('rakuten.co.jp')) {
    return scrapeRakutenFavorites(listUrl);
  } else {
    return {
      source: 'amazon',
      listName: 'エラー',
      items: [],
      error: '対応していないサイトです。Amazon または 楽天のURLを入力してください。',
    };
  }
}
