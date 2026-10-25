import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/lib/db';
import { saveSearchCandidates } from '../src/lib/capture/live-search';
import { registerCapturedCandidates } from '../src/lib/capture/register';
import { createYahooRateGate, createYahooSearch, type YahooFetch } from '../src/lib/capture/yahoo';
import { createRakutenLimiter, createRakutenSearch, type RakutenHttp } from '../src/lib/capture/rakuten';
import type { SearchQuery } from '../src/lib/capture/contract';
import type Database from 'better-sqlite3';

const NOW = Date.parse('2026-10-23T00:33:53.164Z');
const QUERY: SearchQuery = { name: 'Belkin 電源アダプタ', brand: null, model: null, jan: null };

function member(db: Database.Database) {
  return Number(db.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('image-search@example.com', '会員', 'member')",
  ).run().lastInsertRowid);
}

function yahooSearch(hits: Record<string, unknown>[]) {
  const fetch: YahooFetch = async () => new Response(JSON.stringify({ hits }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  return createYahooSearch({
    appId: 'test-app-id',
    userId: 'user-1',
    gate: createYahooRateGate(),
    now: () => NOW,
    fetch,
    schedule: () => () => {},
  });
}

function rakutenSearch(items: Record<string, unknown>[]) {
  const http: RakutenHttp = async () => ({ status: 200, body: JSON.stringify({ items }) });
  return createRakutenSearch({
    credentials: { applicationId: 'test-app-id', accessKey: 'test-access-key' },
    http,
    limiter: createRakutenLimiter(),
    userId: 'user-1',
    now: () => new Date(NOW),
  });
}

test('a provider image survives search and registration, and a product-page image does not', async () => {
  const yahoo = await yahooSearch([
    {
      name: 'Belkin 本体',
      url: 'https://store.shopping.yahoo.co.jp/shop/belkin',
      code: 'belkin',
      price: 1338,
      seller: { name: 'Yahoo店' },
      image: { medium: 'https://item-shopping.c.yimg.jp/i/g/belkin' },
    },
    {
      name: '商品ページの画像',
      url: 'https://store.shopping.yahoo.co.jp/shop/page',
      code: 'page',
      price: 1500,
      seller: { name: 'Yahoo店' },
      image: { medium: 'https://store.shopping.yahoo.co.jp/shop/belkin.jpg' },
    },
  ]).search(QUERY);
  assert.equal(yahoo.ok, true);
  if (!yahoo.ok) return;
  assert.deepEqual(yahoo.value.map((item) => item.imageUrl ?? null), [
    'https://item-shopping.c.yimg.jp/i/g/belkin',
    null,
  ]);

  const rakuten = await rakutenSearch([
    {
      itemName: 'Belkin 楽天',
      itemPrice: 2000,
      itemUrl: 'https://item.rakuten.co.jp/shop/belkin',
      itemCode: 'shop:belkin',
      shopName: '楽天店',
      mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/belkin.jpg' }],
    },
    {
      itemName: 'tshopの画像',
      itemPrice: 2100,
      itemUrl: 'https://item.rakuten.co.jp/shop/tshop',
      itemCode: 'shop:tshop',
      shopName: '楽天店',
      mediumImageUrls: [{ imageUrl: 'https://tshop.r10s.jp/belkin.jpg' }],
    },
  ]).search(QUERY);
  assert.equal(rakuten.ok, true);
  if (!rakuten.ok) return;
  assert.deepEqual(rakuten.value.map((item) => item.imageUrl), [
    'https://thumbnail.image.rakuten.co.jp/belkin.jpg',
    'https://tshop.r10s.jp/belkin.jpg',
  ]);

  const db = openDatabase(':memory:');
  try {
    const userId = member(db);
    const one = saveSearchCandidates(db, userId, QUERY, { candidates: [yahoo.value[0]], amazonUrl: '', failures: [] }, NOW);
    assert.ok(one);
    const savedOne = registerCapturedCandidates(db, userId, [one.storedIds[0]], NOW);
    assert.equal(savedOne.ok, true);
    if (!savedOne.ok) return;
    assert.equal(savedOne.comparisonGroupId, null);
    assert.equal(
      (db.prepare('SELECT image_url FROM items WHERE id = ?').get(savedOne.itemIds[0]) as { image_url: string | null }).image_url,
      'https://item-shopping.c.yimg.jp/i/g/belkin',
    );

    const both = saveSearchCandidates(db, userId, { ...QUERY, name: '比較アダプタ' }, {
      candidates: [
        { ...yahoo.value[0], url: 'https://store.shopping.yahoo.co.jp/shop/belkin-group' },
        rakuten.value[0],
      ],
      amazonUrl: '',
      failures: [],
    }, NOW);
    assert.ok(both);
    const savedBoth = registerCapturedCandidates(db, userId, both.storedIds, NOW);
    assert.equal(savedBoth.ok, true);
    if (!savedBoth.ok) return;
    assert.equal(typeof savedBoth.comparisonGroupId, 'number');
    const images = db.prepare(
      'SELECT source, image_url FROM items WHERE comparison_group_id = ? ORDER BY source',
    ).all(savedBoth.comparisonGroupId) as { source: string; image_url: string | null }[];
    assert.deepEqual(images, [
      { source: 'rakuten', image_url: 'https://thumbnail.image.rakuten.co.jp/belkin.jpg' },
      { source: 'yahoo', image_url: 'https://item-shopping.c.yimg.jp/i/g/belkin' },
    ]);
  } finally {
    db.close();
  }
});
