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
    // 方法1: JSON-LDから取得を試みる
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd.textContent);
        if (data.name && data.offers) {
          return {
            name: data.name,
            url: window.location.href.split('?')[0],
            price: data.offers.price ? parseInt(data.offers.price, 10) : null,
            imageUrl: data.image || null,
          };
        }
      } catch (e) {
        console.log('JSON-LD parse failed:', e);
      }
    }

    // 方法2: Next.jsのデータから取得を試みる
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
      try {
        const nextData = JSON.parse(nextDataEl.textContent);
        const pageProps = nextData?.props?.pageProps;
        if (pageProps?.item || pageProps?.product) {
          const item = pageProps.item || pageProps.product;
          return {
            name: item.title || item.name,
            url: window.location.href.split('?')[0],
            price: item.taxIncludedPrice || item.price || null,
            imageUrl: item.images?.[0] || item.imageUrl || null,
          };
        }
      } catch (e) {
        console.log('Next.js data parse failed:', e);
      }
    }

    // 方法3: DOMから取得（従来の方法 + 新セレクター）
    // 商品名
    const nameEl = document.querySelector('.item-name') ||
                   document.querySelector('[class*="ItemName"]') ||
                   document.querySelector('[class*="item_name"]') ||
                   document.querySelector('[class*="itemName"]') ||
                   document.querySelector('h1.normal_reserve_item_name') ||
                   document.querySelector('.page-heading--title') ||
                   document.querySelector('title');

    let name = nameEl?.textContent?.trim();

    // titleタグから取得した場合、余分な部分を削除
    if (nameEl?.tagName === 'TITLE' && name) {
      name = name.replace(/\s*[|｜:：].*/g, '').trim();
    }

    if (!name) return null;

    // URL
    const url = window.location.href.split('?')[0];

    // 価格（新しいセレクターを追加）
    const priceEl = document.querySelector('[class*="Price__value"]') ||
                    document.querySelector('[class*="price-"]') ||
                    document.querySelector('.price2') ||
                    document.querySelector('[class*="important"]') ||
                    document.querySelector('[data-testid="price"]');
    const priceText = priceEl?.textContent || '';
    const priceMatch = priceText.match(/([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

    // 画像（新しいセレクターを追加）
    const imgEl = document.querySelector('[class*="ImageMain"] img') ||
                  document.querySelector('[class*="image-gallery"] img') ||
                  document.querySelector('.rakutenLimitedId_ImageMain1-3 img') ||
                  document.querySelector('#rakutenLimitedId_ImageMain1-3 img') ||
                  document.querySelector('[class*="mainImage"] img') ||
                  document.querySelector('.image-main img');
    const imageUrl = imgEl?.src || null;

    return { name, url, price, imageUrl };
  } catch (e) {
    console.error('Error getting product info:', e);
    return null;
  }
}
