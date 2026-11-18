import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchServerItemMedia } from '../src/lib/item-input';
import { installProductFetchPort } from '../src/lib/product-fetch-port';
import { regressionLookup } from '../src/lib/product-regression-fixtures';

const CODE = '4981254057384';
const PAGE = `https://shop.tsukumo.co.jp/goods/${CODE}/`;
const IMAGE = `https://cdn.tsukumo.co.jp/image/item/${CODE}_1.jpg`;

// 会員のページ取得は接続失敗のあと 1s、5s、15s 待つ。合計はサーバ画像の 20s を超える。
// ここでは 8s で打ち切る。画像と代替の商品名は 4s 未満で返り、ページへの接続は 1 回だけ。
describe('Tsukumo MCP media budget', { concurrency: false }, () => {
test('fetchServerItemMedia returns the Tsukumo CDN image when the shop page connection fails', async () => {
  let pageRequests = 0;
  installProductFetchPort({
    lookup(target) {
      return regressionLookup(target);
    },
  });
  try {
    const started = Date.now();
    const media = await fetchServerItemMedia(PAGE, {
      timeoutMs: 8_000,
      deps: {
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async () => {
          pageRequests += 1;
          throw new Error('socket hang up');
        },
      },
    });
    const elapsed = Date.now() - started;
    const detail = `elapsed=${elapsed} pageRequests=${pageRequests}`;
    assert.equal(media.imageUrl, IMAGE, detail);
    assert.equal(media.price, null, detail);
    assert.equal(media.scraped?.name, `ツクモの商品（${CODE}）`, detail);
    assert.equal(pageRequests, 1, detail);
    assert.ok(elapsed < 4_000, detail);
  } finally {
    installProductFetchPort(null);
  }
});

test('fetchServerItemMedia keeps retrying a non-Tsukumo page when maxRetries is omitted', async () => {
  let pageRequests = 0;
  const media = await fetchServerItemMedia('https://shop.example.com/products/pen', {
    deps: {
      baseDelayMs: 0,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => {
        pageRequests += 1;
        throw new Error('socket hang up');
      },
    },
  });
  assert.equal(media.imageUrl, null);
  assert.equal(media.price, null);
  assert.equal(pageRequests, 4);
});

test('fetchServerItemMedia uses the redirected Tsukumo CDN image when the destination connection hangs', async () => {
  const destination = 'https://shop.tsukumo.co.jp/goods/0406621759011/';
  const destinationImage = 'https://cdn.tsukumo.co.jp/image/item/0406621759011_1.jpg';
  let pageRequests = 0;
  installProductFetchPort({
    lookup(target) {
      if (target.href === destinationImage || target.href === IMAGE) {
        return { status: 200, contentType: 'image/jpeg' };
      }
      return regressionLookup(target);
    },
  });
  try {
    const started = Date.now();
    const media = await fetchServerItemMedia(PAGE, {
      timeoutMs: 20_000,
      deps: {
        // maxRetries / timeoutMs は渡さない。登録経路の既定（1 回・8s hop）を検証する。
        baseDelayMs: 0,
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async (url, _address, _headers, signal) => {
          pageRequests += 1;
          if (url.href === PAGE) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { status: 302, location: destination, body: Buffer.alloc(0) };
          }
          await new Promise<never>((_resolve, reject) => {
            const fail = () => reject(new Error('aborted'));
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          });
          return { status: 500, body: Buffer.alloc(0) };
        },
      },
    });
    const elapsed = Date.now() - started;
    // 転送先で切れたあとは、転送先の商品番号の公式画像だけを残す（#374）。
    assert.equal(media.imageUrl, destinationImage, `elapsed=${elapsed}`);
    assert.equal(media.price, null);
    assert.equal(media.scraped?.name, 'ツクモの商品（0406621759011）');
    assert.equal(pageRequests, 2);
    assert.ok(elapsed < 12_000, `elapsed=${elapsed}`);
  } finally {
    installProductFetchPort(null);
  }
});
});

test('price-only Tsukumo fetches keep page retries when maxRetries is omitted', async () => {
  const { scrapeUrl } = await import('../src/lib/scraper');
  let pageRequests = 0;
  const priceHtml = '<title>HDD</title><p>販売価格: 24,981円</p>';
  const result = await scrapeUrl(PAGE, {
    baseDelayMs: 0,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async () => {
      pageRequests += 1;
      if (pageRequests < 3) throw new Error('socket hang up');
      return { status: 200, body: Buffer.from(priceHtml), contentType: 'text/html' };
    },
  }, 'price');
  assert.equal(result.price, 24981);
  assert.equal(result.imageUrl, null);
  assert.equal(pageRequests, 3);
});
