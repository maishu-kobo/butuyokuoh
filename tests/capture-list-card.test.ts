import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatYenSpan, wishlistRows, type ListItem } from '../src/lib/capture/list-card';

function item(overrides: Partial<ListItem> & Pick<ListItem, 'id' | 'name'>): ListItem {
  return {
    url: `https://store.shopping.yahoo.co.jp/shop/${overrides.id}`,
    current_price: 1000,
    source: 'yahoo',
    source_name: 'Yahoo!ショッピング',
    price_fetched_at: '2026-10-22 01:02:03',
    comparison_group_id: null,
    is_purchased: 0,
    deleted_at: null,
    ...overrides,
  };
}

test('a manual item and a hand-made group stay as separate cards in the same order', () => {
  const pen = item({ id: 1, name: '手入力ペン', url: 'manual://pen', source: 'other', source_name: null, current_price: 400 });
  const left = item({ id: 2, name: '左', comparison_group_id: 9, comparison_group_name: '手のグループ' });
  const right = item({ id: 3, name: '右', comparison_group_id: 9, comparison_group_name: '手のグループ', current_price: 1500 });
  const rows = wishlistRows([pen, left, right], [{ id: 9, origin: null, name: '手のグループ' }]);
  assert.deepEqual(rows, [
    { kind: 'item', item: pen },
    { kind: 'item', item: left },
    { kind: 'item', item: right },
  ]);

  const labeled = wishlistRows([left, right], [{ id: 9, origin: 'manual', name: '手のグループ' }]);
  assert.deepEqual(labeled.map((row) => row.kind), ['item', 'item']);
});

test('one photo candidate is a single card with that price as the range', () => {
  const only = item({
    id: 4,
    name: '単品ショップ',
    comparison_group_id: 2,
    comparison_group_origin: 'photo',
    current_price: 300,
    source: 'rakuten',
    source_name: '楽天',
    url: 'https://item.rakuten.co.jp/shop/one',
  });
  const rows = wishlistRows([only], [{ id: 2, origin: 'photo', name: '単品' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'photo');
  if (rows[0].kind !== 'photo') return;
  assert.equal(rows[0].name, '単品');
  assert.equal(rows[0].minPrice, 300);
  assert.equal(rows[0].maxPrice, 300);
  assert.equal(rows[0].rangeText, formatYenSpan(300, 300));
  assert.equal(rows[0].shops.length, 1);
  assert.equal(rows[0].shops[0].site, '楽天');
  assert.equal(rows[0].shops[0].shopName, '楽天');
  assert.equal(rows[0].shops[0].purchased, false);
  assert.equal(rows[0].shops[0].url, 'https://item.rakuten.co.jp/shop/one');
  assert.equal(rows[0].shops[0].fetchedAt, '2026-10-22 01:02:03');
  assert.deepEqual(rows[0].itemIds, [4]);
});

test('several photo candidates collapse into one card with the cheapest and the span', () => {
  const pen = item({ id: 1, name: '手入力ペン', url: 'manual://pen', source: 'other', source_name: null });
  const cheap = item({
    id: 10,
    name: '牛乳A',
    comparison_group_id: 7,
    current_price: 800,
    url: 'https://store.shopping.yahoo.co.jp/shop/a',
  });
  const dear = item({
    id: 11,
    name: '牛乳B',
    comparison_group_id: 7,
    current_price: 1200,
    source: 'rakuten',
    source_name: '楽天',
    url: 'https://item.rakuten.co.jp/shop/b',
    price_fetched_at: null,
  });
  const rows = wishlistRows([pen, cheap, dear], [{ id: 7, origin: 'photo', name: '牛乳' }]);
  assert.deepEqual(rows.map((row) => row.kind === 'item' ? row.item.id : row.groupId), [1, 7]);
  const card = rows[1];
  assert.equal(card.kind, 'photo');
  if (card.kind !== 'photo') return;
  assert.equal(card.name, '牛乳');
  assert.equal(card.minPrice, 800);
  assert.equal(card.maxPrice, 1200);
  assert.equal(card.rangeText, '¥800〜¥1,200');
  assert.deepEqual(card.shops.map((shop) => shop.itemId), [10, 11]);
  assert.equal(card.shops[1].fetchedAt, null);
  assert.equal(card.shops[1].site, '楽天');
  assert.deepEqual(card.itemIds, [10, 11]);
});

test('a purchased shop stays inside the photo card and widens the price span', () => {
  const visible = item({
    id: 10,
    name: '牛乳A',
    comparison_group_id: 7,
    current_price: 800,
  });
  const bought = item({
    id: 12,
    name: '牛乳C',
    comparison_group_id: 7,
    current_price: 500,
    source: 'rakuten',
    source_name: '楽天',
    url: 'https://item.rakuten.co.jp/shop/c',
    is_purchased: 1,
  });
  const unrelated = item({ id: 99, name: '買ったペン', url: 'manual://bought', is_purchased: 1, source: 'other', source_name: null });
  const rows = wishlistRows([visible], [{ id: 7, origin: 'photo', name: '牛乳' }], [bought, unrelated]);
  assert.equal(rows.length, 1);
  const card = rows[0];
  assert.equal(card.kind, 'photo');
  if (card.kind !== 'photo') return;
  assert.equal(card.minPrice, 500);
  assert.equal(card.maxPrice, 800);
  assert.equal(card.rangeText, '¥500〜¥800');
  assert.deepEqual(card.shops.map((shop) => [shop.itemId, shop.purchased]), [[12, true], [10, false]]);
  assert.deepEqual(card.itemIds, [10]);
  assert.equal(wishlistRows([], [{ id: 7, origin: 'photo', name: '牛乳' }], [bought]).length, 0);
});

test('a missing price does not set the span, and a deleted purchase is left out', () => {
  const priced = item({ id: 10, name: '牛乳A', comparison_group_id: 7, current_price: 800 });
  const unknown = item({ id: 11, name: '牛乳B', comparison_group_id: 7, current_price: null });
  const gone = item({
    id: 13,
    name: '消えた',
    comparison_group_id: 7,
    current_price: 100,
    is_purchased: 1,
    deleted_at: '2026-10-01 00:00:00',
  });
  const rows = wishlistRows([priced, unknown], [{ id: 7, origin: 'photo', name: '牛乳' }], [gone]);
  const card = rows[0];
  assert.equal(card.kind, 'photo');
  if (card.kind !== 'photo') return;
  assert.equal(card.minPrice, 800);
  assert.equal(card.maxPrice, 800);
  assert.deepEqual(card.shops.map((shop) => shop.itemId), [10, 11]);
});
