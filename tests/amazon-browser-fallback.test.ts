import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  AMAZON_BOT_NOTE,
  isUnusableScrape,
  scrapeUrl,
  type AmazonBrowser,
  type AmazonBrowserRequest,
  type ScrapeDeps,
} from '../src/lib/scraper';

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

test('a blocked Amazon page still opens a browser, and soft-404 also tries the browser', async () => {
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

  // soft-404（本文を見ない HttpError）でも Puppeteer を試し、画像だけの成功も採用する
  const soft404ImageOnly = `<img id="landingImage" src="https://m.media-amazon.com/images/I/soft.jpg">
    <span id="productTitle">画像だけの商品</span><div id="apex_desktop"></div>`;
  const soft404 = await scrapeUrl(productUrl, {
    ...fetched('missing', 404),
    launchBrowser: async () => {
      launches += 1;
      return fakeBrowser(soft404ImageOnly, () => {});
    },
  });
  assert.equal(soft404.price, null);
  assert.equal(soft404.name, '画像だけの商品');
  assert.equal(soft404.imageUrl, 'https://m.media-amazon.com/images/I/soft.jpg');
  assert.equal(launches, 2);

  // ブラウザでも取れない soft-404 は BOT_CHALLENGE 付きで返す
  const soft404Blocked = await scrapeUrl(productUrl, {
    ...fetched('missing', 404),
    launchBrowser: async () => {
      launches += 1;
      return fakeBrowser('<html>api-services-support@amazon.com</html>', () => {});
    },
  });
  assert.equal(soft404Blocked.price, null);
  assert.equal(soft404Blocked.imageUrl, null);
  assert.equal(soft404Blocked.failureCode, 'BOT_CHALLENGE');
  assert.match(soft404Blocked.note || '', /ボット対策/);
  assert.equal(launches, 3);

  // 410 など soft block 以外の恒久 4xx はブラウザを起動しない
  const gone = await scrapeUrl(productUrl, {
    ...fetched('gone', 410),
    launchBrowser: async () => {
      launches += 1;
      throw new Error('browser launched');
    },
  });
  assert.equal(gone.name, '取得失敗');
  assert.equal(launches, 3);

  const unavailable = await scrapeUrl(productUrl, {
    ...fetched('unavailable', 503),
    launchBrowser: async () => {
      launches += 1;
      return fakeBrowser(priced, () => {});
    },
  });
  assert.equal(unavailable.price, 3499);
  assert.equal(launches, 4);
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

// 短縮リンク（#367）。短縮ホストは 301 で target へ、target は status と body で応答する。hosts は接続順。
const shortUrl = 'https://amzn.asia/d/0gH1wHkC';

function shortLink(status: number, body: string, target = productUrl): { deps: ScrapeDeps; hosts: string[] } {
  const hosts: string[] = [];
  return {
    hosts,
    deps: {
      maxRetries: 0,
      baseDelayMs: 0,
      timeoutMs: 1000,
      resolve: async () => [{ address: '1.1.1.1', family: 4 }],
      request: async (url) => {
        hosts.push(url.hostname);
        if (url.hostname === 'amzn.asia') {
          return { status: 301, location: target, body: Buffer.alloc(0) };
        }
        return { status, body: Buffer.from(body), contentType: 'text/html' };
      },
    },
  };
}

test('a short link whose product page soft-404s still reaches the browser and keeps price and image (#367)', async () => {
  for (const status of [403, 404]) {
    const browser = fakeBrowser(priced, () => {});
    let launches = 0;
    const link = shortLink(status, 'missing');
    const result = await scrapeUrl(shortUrl, {
      ...link.deps,
      launchBrowser: async () => {
        launches += 1;
        return browser;
      },
    });
    assert.equal(result.price, 3499, `status ${status}`);
    assert.equal(result.name, '届いた商品', `status ${status}`);
    assert.equal(result.imageUrl, 'https://m.media-amazon.com/images/I/case.jpg', `status ${status}`);
    assert.equal(result.source, 'amazon', `status ${status}`);
    assert.equal(result.note, undefined, `status ${status}`);
    assert.equal(result.failureCode, undefined, `status ${status}`);
    assert.equal(launches, 1, `status ${status}`);
    assert.equal(browser.closes, 1, `status ${status}`);
    // 展開（短縮→商品）と再取得（商品）の 3 接続だけ。許可ドメイン以外へは出ない。
    assert.deepEqual(link.hosts, ['amzn.asia', 'www.amazon.co.jp', 'www.amazon.co.jp'], `status ${status}`);
  }
});

test('short-link diagnostics omit sharing identifiers on product retry', async (t) => {
  const output: string[] = [];
  for (const method of ['log', 'error'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => output.push(args.map(String).join(' ')));
  }
  const target = productUrl + '?share=fixture-share-id#fixture-fragment';
  const result = await scrapeUrl(shortUrl + '?ref=fixture-short-id', {
    ...shortLink(404, 'missing', target).deps,
    launchBrowser: async () => fakeBrowser(priced, () => {}),
  });
  assert.equal(result.price, 3499);
  assert.doesNotMatch(output.join('\n'), /fixture-share-id|fixture-fragment|fixture-short-id/);
});

test('a short link blocked in the browser too returns BOT_CHALLENGE with the Amazon note and closes the browser', async () => {
  const blockedBrowser = fakeBrowser('<html>api-services-support@amazon.com</html>', () => {});
  const blocked = await scrapeUrl(shortUrl, {
    ...shortLink(404, 'missing').deps,
    launchBrowser: async () => blockedBrowser,
  });
  assert.equal(blocked.price, null);
  assert.equal(blocked.imageUrl, null);
  assert.equal(blocked.failureCode, 'BOT_CHALLENGE');
  assert.equal(blocked.note, AMAZON_BOT_NOTE);
  assert.equal(blockedBrowser.closes, 1);

  // ブラウザの遷移が失敗しても同じ結果で、ブラウザは閉じる
  const failingBrowser = fakeBrowser(priced, () => {
    throw new Error('navigation failed');
  });
  const failed = await scrapeUrl(shortUrl, {
    ...shortLink(403, 'forbidden').deps,
    launchBrowser: async () => failingBrowser,
  });
  assert.equal(failed.price, null);
  assert.equal(failed.failureCode, 'BOT_CHALLENGE');
  assert.equal(failed.note, AMAZON_BOT_NOTE);
  assert.equal(failingBrowser.closes, 1);
});

test('a short link without a price keeps a specific note; the short-link guidance is only a fallback', async () => {
  // 展開は 200、商品ページ本文がボット対策。注入 HTTP だけなのでブラウザは起動しない。
  const bot = await scrapeUrl(shortUrl, shortLink(200, '<html>Service Unavailable</html>').deps);
  assert.equal(bot.failureCode, 'BOT_CHALLENGE');
  assert.equal(bot.note, AMAZON_BOT_NOTE);

  // soft-404 で注入 HTTP だけのときも同じ（ブラウザ無しの経路）
  const soft = await scrapeUrl(shortUrl, shortLink(404, 'missing').deps);
  assert.equal(soft.failureCode, 'BOT_CHALLENGE');
  assert.equal(soft.note, AMAZON_BOT_NOTE);

  // 在庫切れなど、価格の無い通常の商品ページは従来どおり短縮リンクの案内
  const noPrice = await scrapeUrl(shortUrl, shortLink(200, outOfStock).deps);
  assert.equal(noPrice.price, null);
  assert.equal(noPrice.name, '在庫なし商品');
  assert.equal(noPrice.imageUrl, 'https://m.media-amazon.com/images/I/out.jpg');
  assert.match(noPrice.note || '', /短縮リンク/);
  assert.equal(noPrice.failureCode, undefined);
});

test('a valid short link to a priced product is unchanged: no browser, no note', async () => {
  let launches = 0;
  const link = shortLink(200, priced);
  const result = await scrapeUrl(shortUrl, {
    ...link.deps,
    launchBrowser: async () => {
      launches += 1;
      throw new Error('browser launched');
    },
  });
  assert.equal(result.price, 3499);
  assert.equal(result.name, '届いた商品');
  assert.equal(result.imageUrl, 'https://m.media-amazon.com/images/I/case.jpg');
  assert.equal(result.note, undefined);
  assert.equal(launches, 0);
  assert.deepEqual(link.hosts, ['amzn.asia', 'www.amazon.co.jp', 'www.amazon.co.jp']);
});

test('a short link whose product page answers anything but 403/404 (410, 5xx, 429, ...) does not open a browser', async () => {
  for (const status of [400, 401, 410, 429, 500, 503]) {
    let launches = 0;
    const link = shortLink(status, 'gone');
    const result = await scrapeUrl(shortUrl, {
      ...link.deps,
      launchBrowser: async () => {
        launches += 1;
        throw new Error('browser launched');
      },
    });
    assert.equal(result.price, null, `status ${status}`);
    assert.equal(result.imageUrl, null, `status ${status}`);
    assert.equal(result.failureCode, undefined, `status ${status}`);
    assert.equal(isUnusableScrape(result), true, `status ${status}`);
    assert.equal(launches, 0, `status ${status}`);
    assert.deepEqual(link.hosts, ['amzn.asia', 'www.amazon.co.jp'], `status ${status}`);
  }
});

test('a short-link soft-404 never grants browser access to a non-product, non-Amazon, or private destination', async () => {
  let launches = 0;
  const launchBrowser = async () => {
    launches += 1;
    throw new Error('browser launched');
  };
  const targets = [
    'https://www.amazon.co.jp/dp/',
    'https://www.amazon.co.jp/gp/product/short',
    'https://www.amazon.co.jp/s?k=case', // Amazon だが商品ページでない
    'https://www.amazon.co.jp/', // トップページ
    'https://evil.example/dp/B0HCNJW81Q', // Amazon 以外
    'https://www.amazon.co.jp.evil.example/dp/B0HCNJW81Q', // 似たホスト
    'https://user:pw@www.amazon.co.jp/dp/B0HCNJW81Q', // 認証情報つき
  ];
  for (const target of targets) {
    for (const status of [403, 404]) {
      const link = shortLink(status, 'missing', target);
      const result = await scrapeUrl(shortUrl, { ...link.deps, launchBrowser });
      assert.equal(result.price, null, target);
      assert.equal(result.imageUrl, null, target);
      assert.equal(result.failureCode, undefined, target);
      assert.equal(isUnusableScrape(result), true, target);
      // 展開の 2 接続だけ。商品の再取得にもブラウザにも進まない。
      assert.equal(link.hosts.length, 2, target);
    }
  }
  assert.equal(launches, 0);

  // 非公開アドレスへ解決される転送先は接続前に止まる
  const requested: string[] = [];
  const internal = await scrapeUrl(shortUrl, {
    maxRetries: 0,
    baseDelayMs: 0,
    timeoutMs: 1000,
    resolve: async (host) =>
      host === 'amzn.asia' ? [{ address: '1.1.1.1', family: 4 }] : [{ address: '169.254.169.254', family: 4 }],
    request: async (url) => {
      requested.push(url.hostname);
      return { status: 301, location: productUrl, body: Buffer.alloc(0) };
    },
    launchBrowser,
  });
  assert.equal(internal.price, null);
  assert.equal(isUnusableScrape(internal), true);
  assert.deepEqual(requested, ['amzn.asia']);

  // IP リテラルと http(s) 以外のスキームへの転送も同じ
  for (const location of ['http://169.254.169.254/dp/B0HCNJW81Q', 'ftp://www.amazon.co.jp/dp/B0HCNJW81Q']) {
    requested.length = 0;
    const result = await scrapeUrl(shortUrl, {
      maxRetries: 0,
      baseDelayMs: 0,
      timeoutMs: 1000,
      resolve: async () => [{ address: '1.1.1.1', family: 4 }],
      request: async (url) => {
        requested.push(url.hostname);
        return { status: 301, location, body: Buffer.alloc(0) };
      },
      launchBrowser,
    });
    assert.equal(isUnusableScrape(result), true, location);
    assert.deepEqual(requested, ['amzn.asia'], location);
  }
  assert.equal(launches, 0);
});

test('property: a soft-404 short link reaches the browser only for an allowed Amazon product URL without credentials', async () => {
  // 受け付ける転送先の仕様: 許可ドメインの商品パスで、認証情報が無い。それ以外は展開失敗のまま。
  const amazonHosts = ['www.amazon.co.jp', 'www.amazon.jp', 'www.amazon.com', 'amazon.co.jp', 'amazon.jp', 'amazon.com'];
  const otherHosts = ['www.amazon.co.jp.evil.example', 'evil.example', 'amazon.co.jp.example', 'wwwamazon.co.jp', 'm.media-amazon.com', 'www.amazon.de'];
  const productPaths = ['/dp/B0HCNJW81Q', '/gp/product/B0HCNJW81Q', '/gp/aw/d/B0HCNJW81Q', '/title/dp/B0HCNJW81Q/ref=sr_1'];
  const otherPaths = ['/', '/s', '/gp/cart/view.html', '/dpx/B0HCNJW81Q', '/gp/products/B0HCNJW81Q',
    '/dp/', '/gp/product/short'];

  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('https:', 'http:'),
      fc.constantFrom('', 'user:pw@', 'user@'),
      fc.constantFrom(...amazonHosts, ...otherHosts),
      fc.constantFrom(...productPaths, ...otherPaths),
      fc.constantFrom('', '?th=1&psc=1'),
      fc.constantFrom(403, 404),
      async (scheme, userinfo, host, path, query, status) => {
        const target = `${scheme}//${userinfo}${host}${path}${query}`;
        let launches = 0;
        const link = shortLink(status, 'missing', target);
        const result = await scrapeUrl(shortUrl, {
          ...link.deps,
          launchBrowser: async () => {
            launches += 1;
            throw new Error('browser launched');
          },
        });
        const accepted = amazonHosts.includes(host) && productPaths.includes(path) && userinfo === '';
        assert.equal(launches, accepted ? 1 : 0, target);
        // 受け付けたときだけ商品ページを再取得してからブラウザへ。それ以外は展開の 2 接続で止まる。
        assert.equal(link.hosts.length, accepted ? 3 : 2, target);
        assert.equal(result.price, null, target);
        assert.equal(result.imageUrl, null, target);
        if (accepted) {
          assert.equal(result.failureCode, 'BOT_CHALLENGE', target);
          assert.equal(result.note, AMAZON_BOT_NOTE, target);
        } else {
          assert.equal(result.failureCode, undefined, target);
          assert.equal(isUnusableScrape(result), true, target);
        }
      },
    ),
    { seed: 367, numRuns: 150 },
  );
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

function fakeBrowser(
  html: string,
  onGoto: (handler: ((request: AmazonBrowserRequest) => Promise<void> | void) | undefined) => Promise<void> | void,
): AmazonBrowser & { closes: number } {
  let interception = false;
  let handler: ((request: AmazonBrowserRequest) => Promise<void> | void) | undefined;
  const browser: AmazonBrowser & { closes: number } = {
    closes: 0,
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
    async close() { browser.closes += 1; },
  };
  return browser;
}

async function emit(
  handler: (request: AmazonBrowserRequest) => Promise<void> | void,
  requests: AmazonBrowserRequest[],
) {
  for (const next of requests) await handler(next);
}
