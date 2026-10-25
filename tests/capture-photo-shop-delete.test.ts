import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { wishlistRows, type ListItem } from '../src/lib/capture/list-card';
import { photoShopDeleteIds } from '../src/lib/capture/photo-group-actions';

const SEED = 20261023;
const group = [{ id: 7, origin: 'photo' as const, name: '牛乳' }];

function shop(id: number, price: number): ListItem {
  return {
    id,
    name: `牛乳${id}`,
    url: `https://item.rakuten.co.jp/shop/${id}`,
    current_price: price,
    source: 'rakuten',
    source_name: '楽天',
    price_fetched_at: '2026-10-22 01:02:03',
    comparison_group_id: 7,
    comparison_group_origin: 'photo',
    is_purchased: 0,
    deleted_at: null,
  };
}

function rowsAfter(memberIds: readonly number[], shopId: number) {
  const trash = photoShopDeleteIds(memberIds, shopId);
  const left = memberIds.filter((id) => !trash.includes(id));
  return { trash, rows: wishlistRows(left.map((id) => shop(id, id * 100)), group) };
}

test('deleting one open shop trashes only that shop and keeps the other shops together', () => {
  const { trash, rows } = rowsAfter([10, 11, 12], 11);
  assert.deepEqual(trash, [11]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'photo');
  if (rows[0].kind !== 'photo') return;
  assert.deepEqual(rows[0].shops.map((entry) => entry.itemId), [10, 12]);
});

test('deleting one of two shops leaves a single registration, not a one-shop group', () => {
  const { trash, rows } = rowsAfter([10, 11], 10);
  assert.deepEqual(trash, [10]);
  assert.deepEqual(rows, [{ kind: 'item', item: shop(11, 1100) }]);
});

test('deleting the last open shop trashes that product and leaves no list row', () => {
  const { trash, rows } = rowsAfter([11], 11);
  assert.deepEqual(trash, [11]);
  assert.deepEqual(rows, []);
});

test('a shop that is not in the open product is not trashed', () => {
  assert.deepEqual(photoShopDeleteIds([10, 11], 99), []);
  assert.deepEqual(photoShopDeleteIds([], 10), []);
});

test('an open shop delete never trashes a sibling, and the last shop is the whole product', () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 6 }),
    fc.integer({ min: 0, max: 5 }),
    (memberIds, index) => {
      const shopId = memberIds[index % memberIds.length];
      const trash = photoShopDeleteIds(memberIds, shopId);
      assert.deepEqual(trash, [shopId]);
      const left = memberIds.filter((id) => id !== shopId);
      const rows = wishlistRows(left.map((id) => shop(id, id * 100)), group);
      if (left.length >= 2) {
        assert.equal(rows.length, 1);
        assert.equal(rows[0].kind, 'photo');
      } else if (left.length === 1) {
        assert.equal(rows[0].kind, 'item');
        if (rows[0].kind === 'item') assert.equal(rows[0].item.id, left[0]);
      } else {
        assert.deepEqual(rows, []);
      }
    },
  ), { seed: SEED, numRuns: 40 });
});
