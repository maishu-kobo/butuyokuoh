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
    const url = window.location.href.split('?')[0];

    // 方法1: window.itemData から取得（楽天の新しいページ）
    if (window.itemData) {
      try {
        const data = window.itemData;
        return {
          name: data.title || data.name,
          url: url,
          price: data.taxIncludedPrice || data.price || null,
          imageUrl: data.images?.[0] || data.imageUrl || null,
        };
      } catch (e) {
        console.log('itemData parse failed:', e);
      }
    }

    // 方法2: __NEXT_DATA__ から取得
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
      try {
        const nextData = JSON.parse(nextDataEl.textContent);
        const pageProps = nextData?.props?.pageProps;
        // メイン商品データを探す
        const item = pageProps?.item || pageProps?.product || pageProps?.itemData;
        if (item) {
          return {
            name: item.title || item.name,
            url: url,
            price: item.taxIncludedPrice || item.price || null,
            imageUrl: item.images?.[0] || item.imageUrl || null,
          };
        }
      } catch (e) {
        console.log('Next.js data parse failed:', e);
      }
    }

    // 方法3: scriptタグ内のitemInfoSkuを探す
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const content = script.textContent || '';
      // itemInfoSku または itemData を探す
      const match = content.match(/(?:itemInfoSku|itemData)\s*[=:]\s*(\{[\s\S]*?\});/);
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          if (data.title || data.name) {
            return {
              name: data.title || data.name,
              url: url,
              price: data.taxIncludedPrice || data.price || null,
              imageUrl: data.images?.[0] || data.imageUrl || null,
            };
          }
        } catch (e) {
          console.log('Script data parse failed:', e);
        }
      }
    }

    // 方法4: メタタグから取得
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogTitle?.content) {
      // 価格をDOMから取得
      const priceEl = document.querySelector('[class*="Price__value"]') ||
                      document.querySelector('[class*="price-"]') ||
                      document.querySelector('.price2');
      const priceText = priceEl?.textContent || '';
      const priceMatch = priceText.match(/([\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;

      // 「【楽天市場】」を先頭から削除し、末尾の「:ショップ名」も削除
      let name = ogTitle.content
        .replace(/^【楽天市場】/, '')
        .replace(/\s*[:：][^:：]*$/, '')
        .trim();

      return {
        name: name,
        url: url,
        price: price,
        imageUrl: ogImage?.content || null,
      };
    }

    // 方法5: titleタグから最終手段として取得
    const title = document.title;
    if (title) {
      return {
        name: title.replace(/\s*[|｜:：].*/g, '').trim(),
        url: url,
        price: null,
        imageUrl: null,
      };
    }

    return null;
  } catch (e) {
    console.error('Error getting product info:', e);
    return null;
  }
}
