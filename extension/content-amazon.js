// Amazon ほしいものリストからアイテムを取得

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getItems') {
    getAmazonWishlistItems().then(items => {
      sendResponse({ items });
    });
    return true; // 非同期レスポンスを示す
  }
});

async function getAmazonWishlistItems() {
  // まずスクロールして全アイテムを読み込む
  await autoScroll();

  const items = [];
  
  // アイテム要素を取得
  const itemElements = document.querySelectorAll('[data-itemid], li[data-id], .g-item-sortable, [id^="item_"]');
  
  itemElements.forEach((item) => {
    try {
      // 商品名
      const nameEl = item.querySelector('[id*="itemName"], .a-link-normal[title], h2 a, .g-title a, a[id*="itemName"]');
      const name = nameEl?.textContent?.trim() || nameEl?.getAttribute('title')?.trim();
      
      if (!name) return;

      // URL
      const linkEl = item.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      let url = linkEl?.href || '';
      
      // URLをクリーンアップ
      if (url) {
        const match = url.match(/\/dp\/([A-Z0-9]+)/) || url.match(/\/gp\/product\/([A-Z0-9]+)/);
        if (match) {
          url = `https://www.amazon.co.jp/dp/${match[1]}`;
        }
      }
      
      if (!url) return;

      // 価格
      const priceEl = item.querySelector('[id*="itemPrice"], .a-price .a-offscreen, .a-color-price, span[id*="item-price"]');
      const priceText = priceEl?.textContent || '';
      const priceMatch = priceText.match(/([\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      
      // 画像
      const imgEl = item.querySelector('img[src*="images-amazon"], img[src*="m.media-amazon"]');
      const imageUrl = imgEl?.src || null;
      
      items.push({ name, url, price, imageUrl });
    } catch (e) {
      console.error('Error parsing item:', e);
    }
  });

  // 重複を除去
  const uniqueItems = items.filter((item, index, self) =>
    index === self.findIndex(t => t.url === item.url)
  );

  return uniqueItems;
}

async function autoScroll() {
  return new Promise((resolve) => {
    let totalHeight = 0;
    const distance = 500;
    const delay = 300;
    
    const timer = setInterval(() => {
      window.scrollBy(0, distance);
      totalHeight += distance;

      // ページの終わりまでスクロール
      if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
        // もう少し待って動的読み込みを待つ
        setTimeout(() => {
          if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 1000);
      }
    }, delay);

    // タイムアウト（30秒）
    setTimeout(() => {
      clearInterval(timer);
      window.scrollTo(0, 0);
      resolve();
    }, 30000);
  });
}
