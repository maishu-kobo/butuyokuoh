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

// 許可されたAmazonウィシュリストドメイン（完全一致）
const AMAZON_WISHLIST_DOMAINS = new Set([
  'www.amazon.co.jp',
  'www.amazon.jp',
  'www.amazon.com',
  'amazon.co.jp',
  'amazon.jp',
  'amazon.com',
]);

// 許可された楽天ウィシュリストドメイン
const RAKUTEN_WISHLIST_DOMAINS = new Set([
  'my.bookmark.rakuten.co.jp',
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
 * ウィシュリストURLを検証
 * hostname.includes() ではなく、完全一致で検証
 */
function validateWishlistUrl(listUrl: string): { isValid: boolean; source: 'amazon' | 'rakuten' | null; sanitizedUrl: string } {
  try {
    const parsedUrl = new URL(listUrl);

    // HTTPSのみ許可
    if (parsedUrl.protocol !== 'https:') {
      return { isValid: false, source: null, sanitizedUrl: '' };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // ソースを判定（完全一致）
    let source: 'amazon' | 'rakuten' | null = null;
    if (AMAZON_WISHLIST_DOMAINS.has(hostname)) {
      source = 'amazon';
    } else if (RAKUTEN_WISHLIST_DOMAINS.has(hostname)) {
      source = 'rakuten';
    }

    if (!source) {
      return { isValid: false, source: null, sanitizedUrl: '' };
    }

    // URLを再構築
    const sanitizedUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`;

    return { isValid: true, source, sanitizedUrl };
  } catch {
    return { isValid: false, source: null, sanitizedUrl: '' };
  }
}

export async function scrapeAmazonWishlist(sanitizedUrl: string): Promise<WishlistResult> {
  // SSRF対策: page.goto直前にホスト名を再検証
  const hostname = getHostname(sanitizedUrl);
  if (!hostname || !AMAZON_WISHLIST_DOMAINS.has(hostname)) {
    return {
      source: 'amazon',
      listName: 'エラー',
      items: [],
      error: '無効なURLです',
    };
  }

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

    await page.goto(sanitizedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // リスト名を取得
    const listName = await page.$eval(
      '#profile-list-name, [data-csa-c-content-id] h1, h1',
      (el) => el.textContent?.trim() || 'Amazon ほしいものリスト'
    ).catch(() => 'Amazon ほしいものリスト');

    // スクロールして全アイテムを読み込む
    let previousHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluateHandle('window.scrollTo(0, document.body.scrollHeight)');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const currentHeight = await page.evaluateHandle('document.body.scrollHeight');
      const height = await currentHeight.jsonValue() as number;
      if (height === previousHeight) break;
      previousHeight = height;
    }

    // アイテムを抽出（ページコンテキスト内で実行）
    const items = await page.$$eval('[data-itemid], li[data-id], .g-item-sortable', (elements) => {
      return elements.map((item) => {
        try {
          // 商品名
          const nameEl = item.querySelector('[id*="itemName"], .a-link-normal[title], h2 a, .g-title a');
          const name = nameEl?.textContent?.trim() || (nameEl as HTMLElement)?.getAttribute('title')?.trim() || '';

          // URL
          const linkEl = item.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]') as HTMLAnchorElement;
          let url = linkEl?.href || '';

          // URLをクリーンアップ
          if (url && !url.startsWith('http')) {
            url = 'https://www.amazon.co.jp' + url;
          }
          if (url) {
            const match = url.match(/\/dp\/([A-Z0-9]+)/) || url.match(/\/gp\/product\/([A-Z0-9]+)/);
            if (match) {
              const domainMatch = url.match(/https?:\/\/(www\.amazon\.co\.jp|www\.amazon\.jp|www\.amazon\.com|amazon\.co\.jp|amazon\.jp|amazon\.com)/);
              const domain = domainMatch ? `https://${domainMatch[1].replace(/^(amazon)/, 'www.$1')}` : 'https://www.amazon.co.jp';
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

          return { name, url, price, imageUrl };
        } catch {
          return null;
        }
      }).filter((item): item is WishlistItem => item !== null && !!item.name && !!item.url);
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

export async function scrapeRakutenFavorites(sanitizedUrl: string): Promise<WishlistResult> {
  // SSRF対策: page.goto直前にホスト名を再検証
  const hostname = getHostname(sanitizedUrl);
  if (!hostname || !RAKUTEN_WISHLIST_DOMAINS.has(hostname)) {
    return {
      source: 'rakuten',
      listName: 'エラー',
      items: [],
      error: '無効なURLです',
    };
  }

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

    await page.goto(sanitizedUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // スクロールして全アイテムを読み込む
    let previousHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluateHandle('window.scrollTo(0, document.body.scrollHeight)');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const currentHeight = await page.evaluateHandle('document.body.scrollHeight');
      const height = await currentHeight.jsonValue() as number;
      if (height === previousHeight) break;
      previousHeight = height;
    }

    // アイテムを抽出
    const items = await page.$$eval('.rnkRanking_item, .searchresultitem, [data-item-id], .item', (elements) => {
      return elements.map((item) => {
        try {
          // 商品名
          const nameEl = item.querySelector('.title a, h2 a, .itemName a, a.title');
          const name = nameEl?.textContent?.trim() || '';

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

          return { name, url, price, imageUrl };
        } catch {
          return null;
        }
      }).filter((item): item is WishlistItem => item !== null && !!item.name && !!item.url);
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
  const validation = validateWishlistUrl(listUrl);

  if (!validation.isValid || !validation.source) {
    return {
      source: 'amazon',
      listName: 'エラー',
      items: [],
      error: '対応していないサイトです。Amazon または 楽天のURLを入力してください。',
    };
  }

  if (validation.source === 'amazon') {
    return scrapeAmazonWishlist(validation.sanitizedUrl);
  } else {
    return scrapeRakutenFavorites(validation.sanitizedUrl);
  }
}
