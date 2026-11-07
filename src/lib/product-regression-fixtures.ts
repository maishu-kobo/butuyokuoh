// 固定の商品ページ。外部の店には接続しない。本文はテストが期待する値そのもので、実装の戻り値から作らない。

export const PITAKA_URL = 'https://pitakajapan.com/products/magez-grip';
export const PITAKA_NAME = 'MagEZ Grip 3';
export const PITAKA_PRICE = 3999;
export const PITAKA_IMAGE = 'https://pitakajapan.com/cdn/grip.webp?a=1&b=2';

export const AMAZON_SHORT_URL = 'https://amzn.asia/d/0gH1wHkC';
export const AMAZON_PRODUCT_URL = 'https://www.amazon.co.jp/dp/B0FIXPRICE';
export const AMAZON_NAME = 'NIMASO & ケース';
export const AMAZON_PRICE = 3499;
export const AMAZON_IMAGE = 'https://m.media-amazon.com/images/I/case.jpg';

export const AMAZON_NO_PRICE_URL = 'https://www.amazon.co.jp/dp/B0FIXNOPRC';
export const AMAZON_NO_PRICE_NAME = '在庫なし商品';

export const RAKUTEN_URL = 'https://item.rakuten.co.jp/crispin/giacometti_fg173_anero/?variantId=43308';
export const RAKUTEN_NAME = '日本語の商品';
export const RAKUTEN_PRICE = 107800;
export const RAKUTEN_IMAGE = 'https://shop.r10s.jp/example/shoes.jpg';

export const FAIL_URL = 'https://example.com/products/fetch-failed';
export const EMPTY_URL = 'https://example.com/products/reference-only';
export const BOT_URL = 'https://www.amazon.co.jp/dp/B0BOTCHK01';
export const TIMEOUT_URL = 'https://example.com/products/timeout';
export const RELATIVE_IMAGE_URL = 'https://example.com/products/relative-image';

const pitakaHtml = `<title>MagEZ Grip 3 – PITAKA Japan</title>
<meta property="og:image" content="http://pitakajapan.com/cdn/grip.webp?a=1&amp;b=2">
<script type="application/ld+json">{"hasVariant":[{"offers":{"price":"3999.00","priceCurrency":"JPY"}}]}</script>`;

const amazonHtml = `<img src="https://m.media-amazon.com/images/I/case.jpg" id="landingImage">
<span id="productTitle">NIMASO &amp; ケース</span>
<div id="corePriceDisplay_desktop_feature_div">
  <span class="a-price a-text-price"><span class="a-offscreen">￥8,999</span></span>
  <div class="installment"><span class="a-price">￥300</span></div>
  <span class="a-price priceToPay"><span class="a-offscreen">￥3,499</span><span aria-hidden="true">￥3,499</span></span>
</div><div id="recommendations"><span class="a-price">￥999</span></div>`;

const amazonNoPriceHtml = `<span id="productTitle">在庫なし商品</span>
<img src="https://m.media-amazon.com/images/I/case.jpg" id="landingImage">
<div id="recommendations"><span class="a-price">￥2,599</span></div>`;

const eucName = Buffer.from('c6fccbdcb8eca4cebea6c9ca', 'hex');
const rakutenHtml = Buffer.concat([
  Buffer.from('<title>'), eucName,
  Buffer.from('</title><span class="normal_reserve_item_name"><b>nested name</b></span><p>200'),
  Buffer.from('b1df', 'hex'),
  Buffer.from('</p><meta property="og:image" content="https://shop.r10s.jp/example/shoes.jpg"><script type="application/ld+json">{"offers":{"price":107800,"priceCurrency":"JPY"}}</script>'),
]);

export type ProductFixture = {
  status: number;
  location?: string;
  body?: Buffer;
  contentType?: string;
  hang?: boolean;
};

const html = (value: string): ProductFixture => ({
  status: 200,
  body: Buffer.from(value),
  contentType: 'text/html; charset=UTF-8',
});

const fixtures = new Map<string, ProductFixture>([
  [PITAKA_URL, html(pitakaHtml)],
  [AMAZON_SHORT_URL, { status: 301, location: AMAZON_PRODUCT_URL, body: Buffer.alloc(0) }],
  [AMAZON_PRODUCT_URL, html(amazonHtml)],
  [AMAZON_NO_PRICE_URL, html(amazonNoPriceHtml)],
  [RAKUTEN_URL, { status: 200, body: rakutenHtml, contentType: 'text/html; charset=EUC-JP' }],
  [FAIL_URL, { status: 403, body: Buffer.from('forbidden'), contentType: 'text/html' }],
  [EMPTY_URL, html('<html><body>Reference</body></html>')],
  [BOT_URL, html('<title>Robot Check</title><p>automated access</p>')],
  [TIMEOUT_URL, { status: 200, hang: true }],
  [RELATIVE_IMAGE_URL, html('<title>Product</title><meta property="og:image" content="//cdn.example.com/a.webp">')],
]);

export function regressionLookup(url: URL): ProductFixture | undefined {
  return fixtures.get(url.href);
}

export function regressionFetchPort() {
  return { lookup: regressionLookup, timeoutMs: 400 };
}
