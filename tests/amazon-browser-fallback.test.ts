import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeUrl, type AmazonBrowser, type AmazonBrowserRequest, type ScrapeDeps } from '../src/lib/scraper';

const productUrl = 'https://www.amazon.co.jp/dp/B0HCNJW81Q';
const outOfStock = `<img id="landingImage" src="https://m.media-amazon.com/images/I/out.jpg">
  <span id="productTitle">在庫なし商品</span><div id="apex_desktop"></div>`;
const priced = `<img id="landingImage" src="https://m.media-amazon.com/images/I/case.jpg">
  <span id="productTitle">届いた商品</span>
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">￥3,499</span></span></div>`;

function fetched(body: string, status = 200): ScrapeDeps {
  return {
    maxRetries: 0,
    baseDelayMs: 0,
    timeoutMs: 1000,
    resolve: async () => [{ address: '1.1.1.1', family: 4 }],
    request: async () => ({ status, body: Buffer.from(body), contentType: 'text/html' }),
  };
}

test('a normal Amazon page without a price does not open a browser', async () => {
  let launches = 0;
  const result = await scrapeUrl(productUrl, {
    ...fetched(outOfStock),
    launchBrowser: async () => {
      launches += 1;
      throw new Error('browser launched');
    },
  });

  assert.equal(result.name, '在庫なし商品');
  assert.equal(result.price, null);
  assert.equal(result.imageUrl, 'https://m.media-amazon.com/images/I/out.jpg');
  assert.equal(result.source, 'amazon');
  assert.equal(launches, 0);
});

test('an Amazon price from fetch does not open a browser', async () => {
  let launches = 0;
  const result = await scrapeUrl(productUrl, {
    ...fetched(priced),
    launchBrowser: async () => {
      launches += 1;
      throw new Error('browser launched');
    },
  });
  assert.equal(result.price, 3499);
  assert.equal(result.name, '届いた商品');
  assert.equal(launches, 0);
});

test('a blocked Amazon page still opens a browser, and a missing page does not', async () => {
  let launches = 0;
  const browser = fakeBrowser(priced, () => {});
  const blocked = await scrapeUrl(productUrl, {
    ...fetched('<html>Service Unavailable</html>'),
    launchBrowser: async () => {
      launches += 1;
      return browser;
    },
  });
  assert.equal(blocked.price, 3499);
  assert.equal(blocked.name, '届いた商品');
  assert.equal(launches, 1);

  const missing = await scrapeUrl(productUrl, {
    ...fetched('missing', 404),
    launchBrowser: async () => {
      launches += 1;
      throw new Error('browser launched');
    },
  });
  assert.equal(missing.price, null);
  assert.equal(missing.name, '取得失敗');
  assert.equal(launches, 1);

  const unavailable = await scrapeUrl(productUrl, {
    ...fetched('unavailable', 503),
    launchBrowser: async () => {
      launches += 1;
      return fakeBrowser(priced, () => {});
    },
  });
  assert.equal(unavailable.price, 3499);
  assert.equal(launches, 2);
});

test('Amazon browser fallback drops image, font, and media requests', async () => {
  const actions: string[] = [];
  const requests: AmazonBrowserRequest[] = [
    request('image', 'https://m.media-amazon.com/images/I/a.jpg', false, actions),
    request('font', 'https://m.media-amazon.com/fonts/a.woff2', false, actions),
    request('media', 'https://m.media-amazon.com/video/a.mp4', false, actions),
    request('stylesheet', 'https://m.media-amazon.com/css/a.css', false, actions),
    request('script', 'https://m.media-amazon.com/js/a.js', false, actions),
    request('xhr', 'https://www.amazon.co.jp/api/price', false, actions),
    request('document', productUrl, true, actions),
    request('document', 'http://127.0.0.1/latest/meta-data', true, actions),
  ];
  const result = await scrapeUrl(productUrl, {
    ...fetched('<html>Service Unavailable</html>'),
    launchBrowser: async () => fakeBrowser(priced, (handler) => handler && emit(handler, requests)),
  });

  assert.equal(result.price, 3499);
  assert.deepEqual(actions, [
    'abort:image:https://m.media-amazon.com/images/I/a.jpg',
    'abort:font:https://m.media-amazon.com/fonts/a.woff2',
    'abort:media:https://m.media-amazon.com/video/a.mp4',
    'continue:stylesheet:https://m.media-amazon.com/css/a.css',
    'continue:script:https://m.media-amazon.com/js/a.js',
    'continue:xhr:https://www.amazon.co.jp/api/price',
    `continue:document:${productUrl}`,
    'abort:document:http://127.0.0.1/latest/meta-data',
  ]);
});

function request(type: string, url: string, navigation: boolean, actions: string[]): AmazonBrowserRequest {
  let settled = false;
  const finish = async (action: 'abort' | 'continue') => {
    if (settled) throw new Error(`request settled twice: ${type} ${url}`);
    settled = true;
    actions.push(`${action}:${type}:${url}`);
  };
  return {
    url: () => url,
    resourceType: () => type,
    isNavigationRequest: () => navigation,
    continue: () => finish('continue'),
    abort: () => finish('abort'),
  };
}

function fakeBrowser(html: string, onGoto: (handler: ((request: AmazonBrowserRequest) => Promise<void> | void) | undefined) => Promise<void> | void): AmazonBrowser {
  let interception = false;
  let handler: ((request: AmazonBrowserRequest) => Promise<void> | void) | undefined;
  let closed = false;
  return {
    async newPage() {
      return {
        async setUserAgent() {},
        async setExtraHTTPHeaders() {},
        async setRequestInterception(enabled: boolean) { interception = enabled; },
        on(_event, next) { handler = next; },
        async goto() {
          if (!interception) throw new Error('request interception is off');
          await onGoto(handler);
        },
        async content() { return html; },
      };
    },
    async close() { closed = true; },
    // closed is observed only to keep the fake honest if a future test reads it.
    get closed() { return closed; },
  } as AmazonBrowser;
}

async function emit(
  handler: (request: AmazonBrowserRequest) => Promise<void> | void,
  requests: AmazonBrowserRequest[],
) {
  for (const next of requests) await handler(next);
}
