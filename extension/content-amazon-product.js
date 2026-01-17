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

    // 価格 - 複数のセレクタを試行（2024年以降のAmazonレイアウト対応）
    let price = null;
    
    // 方法1: corePriceDisplay（新しいレイアウト）
    const corePriceEl = document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen');
    if (corePriceEl) {
      price = extractPrice(corePriceEl.textContent);
    }
    
    // 方法2: apex_desktop（もう一つの新レイアウト）
    if (!price) {
      const apexPriceEl = document.querySelector('#apex_desktop .a-price .a-offscreen');
      if (apexPriceEl) {
        price = extractPrice(apexPriceEl.textContent);
      }
    }
    
    // 方法3: corePrice_feature_div
    if (!price) {
      const coreFeatureEl = document.querySelector('#corePrice_feature_div .a-price .a-offscreen');
      if (coreFeatureEl) {
        price = extractPrice(coreFeatureEl.textContent);
      }
    }

    // 方法4: 一般的な.a-price .a-offscreen（最初のもの）
    if (!price) {
      const generalPriceEl = document.querySelector('.a-price .a-offscreen');
      if (generalPriceEl) {
        price = extractPrice(generalPriceEl.textContent);
      }
    }
    
    // 方法5: 旧レイアウトのpriceblock系
    if (!price) {
      const oldPriceEl = document.querySelector('#priceblock_ourprice') ||
                         document.querySelector('#priceblock_dealprice') ||
                         document.querySelector('#priceblock_saleprice');
      if (oldPriceEl) {
        price = extractPrice(oldPriceEl.textContent);
      }
    }
    
    // 方法6: data-a-color="price"属性
    if (!price) {
      const colorPriceEl = document.querySelector('[data-a-color="price"] .a-offscreen');
      if (colorPriceEl) {
        price = extractPrice(colorPriceEl.textContent);
      }
    }
    
    // 方法7: 全体から最初の価格っぽい要素を探す
    if (!price) {
      const allPriceEls = document.querySelectorAll('.a-price-whole');
      for (const el of allPriceEls) {
        const wholeText = el.textContent?.replace(/[^\d]/g, '');
        if (wholeText) {
          price = parseInt(wholeText, 10);
          break;
        }
      }
    }

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

    console.log('[物欲王] Amazon商品情報:', { name, url, price, imageUrl });

    return { name, url, price, imageUrl };
  } catch (e) {
    console.error('[物欲王] Error getting product info:', e);
    return null;
  }
}

function extractPrice(text) {
  if (!text) return null;
  // 「¥1,234」「1,234円」「￥1234」などから数値を抽出
  const match = text.match(/([\d,]+)/);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return null;
}
