// 楽天 お気に入りからアイテムを取得

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getItems') {
    getRakutenFavoriteItems().then(items => {
      sendResponse({ items });
    });
    return true;
  }
});

async function getRakutenFavoriteItems() {
  // スクロールして全アイテムを読み込む
  await autoScroll();

  const items = [];
  
  // 楽天のお気に入りアイテム
  const itemElements = document.querySelectorAll('.rnkRanking_item, .searchresultitem, [data-item-id], .item, .bookmark-item, .product-item');
  
  itemElements.forEach((item) => {
    try {
      // 商品名
      const nameEl = item.querySelector('.title a, h2 a, .itemName a, a.title, .name a, .product-name a');
      const name = nameEl?.textContent?.trim();
      
      if (!name) return;

      // URL
      const linkEl = item.querySelector('a[href*="item.rakuten.co.jp"], a[href*="product.rakuten.co.jp"]');
      const url = linkEl?.href || '';
      
      if (!url) return;

      // 価格
      const priceEl = item.querySelector('.price, .important, [class*="price"], .item-price');
      const priceText = priceEl?.textContent || '';
      const priceMatch = priceText.match(/([\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      
      // 画像
      const imgEl = item.querySelector('img[src*="thumbnail"], img[src*="r.r10s.jp"], img[src*="rakuten"]');
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

      if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
        setTimeout(() => {
          if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 1000);
      }
    }, delay);

    // タイムアウト
    setTimeout(() => {
      clearInterval(timer);
      window.scrollTo(0, 0);
      resolve();
    }, 30000);
  });
}
