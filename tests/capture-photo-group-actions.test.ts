import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { photoGroupDeleteIds, photoGroupSaveWrites } from '../src/lib/capture/photo-group-actions';

const SEED = 20261023;

test('deleting a photo group removes every shop, including one already purchased', () => {
  assert.deepEqual(photoGroupDeleteIds([10, 12, 11], 10), [10, 12, 11]);
});

test('saving priority and comparison group updates every shop and leaves each shop name and price on the face', () => {
  const body = {
    name: '代表の名前',
    url: 'https://store.shopping.yahoo.co.jp/shop/face',
    priority: 1,
    planned_purchase_date: '2026-11-01',
    notes: '顔のメモ',
    target_price: 900,
    target_currency: 'JPY',
    category_id: 4,
    comparison_group_id: 9,
    quantity: 2,
    image_url: 'https://item-shopping.c.yimg.jp/i/g/face',
    current_price: 800,
  };
  assert.deepEqual(photoGroupSaveWrites([10, 11, 12], 10, body), [
    { id: 10, body },
    { id: 11, body: { priority: 1, comparison_group_id: 9 } },
    { id: 12, body: { priority: 1, comparison_group_id: 9 } },
  ]);
});

test('clearing the comparison group clears it on every shop', () => {
  const body = { name: '代表', priority: 3, comparison_group_id: null };
  assert.deepEqual(photoGroupSaveWrites([2, 3], 3, body), [
    { id: 2, body: { priority: 3, comparison_group_id: null } },
    { id: 3, body },
  ]);
});

test('one registered item stays a single delete and a single save', () => {
  const body = { name: '単品ショップ', priority: 2, comparison_group_id: null, current_price: 300 };
  assert.deepEqual(photoGroupDeleteIds([4], 4), [4]);
  assert.deepEqual(photoGroupSaveWrites([4], 4, body), [{ id: 4, body }]);
});

test('a save without priority or comparison group does not rewrite the other shops', () => {
  const body = { name: '名前だけ', current_price: 100 };
  assert.deepEqual(photoGroupSaveWrites([10, 11], 10, body), [{ id: 10, body }]);
});

test('photo group writes keep every member and never copy shop-specific fields', () => {
  const shopFields = ['name', 'url', 'notes', 'current_price', 'image_url', 'category_id', 'quantity', 'target_price', 'planned_purchase_date'];
  fc.assert(fc.property(
    fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { minLength: 2, maxLength: 6 }),
    fc.integer({ min: 1, max: 5 }),
    fc.option(fc.integer({ min: 1, max: 20 }), { nil: null }),
    fc.string(),
    (memberIds, priority, comparisonGroupId, name) => {
      const faceId = memberIds[0];
      const body = { name, url: `https://example.test/${faceId}`, priority, comparison_group_id: comparisonGroupId, current_price: faceId * 10 };
      const deletes = photoGroupDeleteIds(memberIds, faceId);
      assert.deepEqual(deletes, memberIds);
      const writes = photoGroupSaveWrites(memberIds, faceId, body);
      assert.deepEqual(writes.map((write) => write.id), memberIds);
      assert.equal(writes[0].body, body);
      for (const write of writes.slice(1)) {
        assert.deepEqual(Object.keys(write.body).sort(), ['comparison_group_id', 'priority']);
        assert.equal(write.body.priority, priority);
        assert.equal(write.body.comparison_group_id, comparisonGroupId);
        for (const field of shopFields) assert.equal(Object.hasOwn(write.body, field), false);
      }
    },
  ), { seed: SEED, numRuns: 40 });
});
