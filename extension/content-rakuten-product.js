// 楽天 商品ページから商品情報を取得

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProductInfo') {
    const product = getRakutenProductInfo();
    sendResponse({ product });
    return true;
  }
});

function getRakutenProductInfo() {
  try {
    // 商品名
    const nameEl = document.querySelector('.item_name') ||
                   document.querySelector('h1.normal_reserve_item_name') ||
                   document.querySelector('[class*="item-name"]') ||
                   document.querySelector('h1');
    const name = nameEl?.textContent?.trim();

    if (!name) return null;

    // URL
    const url = window.location.href.split('?')[0];

    // 価格
    const priceEl = document.querySelector('.price2') ||
                    document.querySelector('.important') ||
                    document.querySelector('[class*="price"]');
    const priceText = priceEl?.textContent || '';
    const priceMatch = priceText.match(/([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    // 画像
    const imgEl = document.querySelector('.rakutenLimitedId_ImageMain1-3 img') ||
                  document.querySelector('#rakutenLimitedId_ImageMain1-3 img') ||
                  document.querySelector('.image-main img') ||
                  document.querySelector('[class*="main-image"] img');
    const imageUrl = imgEl?.src || null;

    return { name, url, price, imageUrl };
  } catch (e) {
    console.error('Error getting product info:', e);
    return null;
  }
}
