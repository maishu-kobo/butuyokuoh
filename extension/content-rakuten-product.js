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

    // ページ全体のHTMLから情報を抽出
    const html = document.documentElement.innerHTML;

    // 価格を取得: taxIncludedPrice を探す
    let price = null;
    const priceMatch = html.match(/"taxIncludedPrice"\s*:\s*([\d.]+)/);
    if (priceMatch) {
      price = Math.round(parseFloat(priceMatch[1]));
    }

    // 商品名を取得: og:title から
    const ogTitle = document.querySelector('meta[property="og:title"]');
    let name = null;
    if (ogTitle?.content) {
      name = ogTitle.content
        .replace(/^【楽天市場】/, '')
        .replace(/\s*[:：][^:：]*$/, '')
        .trim();
    }

    // 商品名が取れなかった場合: title属性を探す
    if (!name) {
      const titleMatch = html.match(/"title"\s*:\s*"([^"]+)"/);
      if (titleMatch) {
        name = titleMatch[1];
      }
    }

    // それでも取れなかった場合: titleタグから
    if (!name) {
      name = document.title
        .replace(/^【楽天市場】/, '')
        .replace(/\s*[|｜:：].*/g, '')
        .trim();
    }

    // 画像を取得: og:image から
    const ogImage = document.querySelector('meta[property="og:image"]');
    let imageUrl = ogImage?.content || null;

    // og:imageが取れなかった場合: images配列から
    if (!imageUrl) {
      const imageMatch = html.match(/"images"\s*:\s*\[\s*"([^"]+)"/);
      if (imageMatch) {
        imageUrl = imageMatch[1];
      }
    }

    if (!name) {
      return null;
    }

    return { name, url, price, imageUrl };
  } catch (e) {
    console.error('Error getting product info:', e);
    return null;
  }
}
