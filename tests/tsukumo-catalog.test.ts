import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tsukumoCatalogImage } from '../src/lib/tsukumo-catalog';

const CODE = '4981254057384';
const IMAGE = `https://cdn.tsukumo.co.jp/image/item/${CODE}_1.jpg`;

test('tsukumoCatalogImage derives the official CDN path from a goods URL', () => {
  assert.deepEqual(tsukumoCatalogImage(`https://shop.tsukumo.co.jp/goods/${CODE}/`), {
    productNumber: CODE,
    path: `/image/item/${CODE}_1.jpg`,
    imageUrl: IMAGE,
  });
});

test('tsukumoCatalogImage accepts a trailing-slash-less goods path and ignores query/hash', () => {
  assert.equal(
    tsukumoCatalogImage(`https://shop.tsukumo.co.jp/goods/${CODE}?ref=share#top`)?.imageUrl,
    IMAGE,
  );
  assert.equal(
    tsukumoCatalogImage(`https://shop.tsukumo.co.jp/goods/${CODE}`)?.productNumber,
    CODE,
  );
});

test('tsukumoCatalogImage rejects non-goods hosts, schemes, credentials, and path injection', () => {
  for (const value of [
    null,
    undefined,
    '',
    'not-a-url',
    `http://shop.tsukumo.co.jp/goods/${CODE}/`,
    `https://cdn.tsukumo.co.jp/image/item/${CODE}_1.jpg`,
    `https://evil.example/goods/${CODE}/`,
    `https://user:pass@shop.tsukumo.co.jp/goods/${CODE}/`,
    `https://shop.tsukumo.co.jp/goods/${CODE}/related/`,
    `https://shop.tsukumo.co.jp/goods/../etc/passwd/`,
    `https://shop.tsukumo.co.jp/goods/${CODE}%2f../x/`,
    'https://shop.tsukumo.co.jp/goods/abc123def4567/',
    'https://shop.tsukumo.co.jp/goods/498125405738/',
    'https://shop.tsukumo.co.jp/goods/49812540573845/',
    'https://shop.tsukumo.co.jp/search/',
  ]) {
    assert.equal(tsukumoCatalogImage(value), null, String(value));
  }
});
