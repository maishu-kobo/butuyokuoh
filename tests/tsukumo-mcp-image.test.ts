import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchServerItemMedia } from '../src/lib/item-input';
import { installProductFetchPort } from '../src/lib/product-fetch-port';
import { regressionLookup } from '../src/lib/product-regression-fixtures';

const CODE = '4981254057384';
const PAGE = `https://shop.tsukumo.co.jp/goods/${CODE}/`;
const IMAGE = `https://cdn.tsukumo.co.jp/image/item/${CODE}_1.jpg`;

// 会員のページ取得は接続失敗のあと 1s、5s、15s 待つ。合計はサーバ画像の 20s を超える。
// ここでは 8s で打ち切る。画像と代替の商品名は 4s 未満で返り、ページへの接続は 1 回だけ。
test('fetchServerItemMedia returns the Tsukumo CDN image when the shop page connection fails', async () => {
  let pageRequests = 0;
  let releaseCdn = () => {};
  const cdnChecked = new Promise<void>((resolve) => {
    releaseCdn = resolve;
  });
  installProductFetchPort({
    lookup(target) {
      if (target.href === IMAGE) releaseCdn();
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
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 25_000);
      cdnChecked.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    installProductFetchPort(null);
  }
});
