// Amazon 商品ページから商品情報を取得

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getProductInfo') {
    const product = getAmazonProductInfo();
    sendResponse({ product });
    return true;
  }
});

function getAmazonProductInfo() {
  try {
    // 商品名
    const nameEl = document.getElementById('productTitle') || 
                   document.querySelector('#title span') ||
                   document.querySelector('h1.a-size-large');
    const name = nameEl?.textContent?.trim();

    if (!name) return null;

    // URL（クリーンな形式に）
    let url = window.location.href;
    const match = url.match(/\/dp\/([A-Z0-9]+)/) || url.match(/\/gp\/product\/([A-Z0-9]+)/);
    if (match) {
      const domain = window.location.hostname;
      url = `https://${domain}/dp/${match[1]}`;
    }

    // 価格
    const priceEl = document.querySelector('.a-price .a-offscreen') ||
                    document.querySelector('#priceblock_ourprice') ||
                    document.querySelector('#priceblock_dealprice') ||
                    document.querySelector('#priceblock_saleprice') ||
                    document.querySelector('.a-color-price') ||
                    document.querySelector('[data-a-color="price"] .a-offscreen');
    const priceText = priceEl?.textContent || '';
    const priceMatch = priceText.match(/([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    // 画像
    const imgEl = document.getElementById('landingImage') ||
                  document.getElementById('imgBlkFront') ||
                  document.querySelector('#main-image-container img') ||
                  document.querySelector('#imageBlock img');
    let imageUrl = imgEl?.src || null;
    
    // 高解像度画像を取得（可能なら）
    if (imgEl?.dataset?.oldHires) {
      imageUrl = imgEl.dataset.oldHires;
    }

    return { name, url, price, imageUrl };
  } catch (e) {
    console.error('Error getting product info:', e);
    return null;
  }
}
