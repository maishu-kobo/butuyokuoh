import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import type { ComparisonGroup, Item } from '../src/types';
import { bulkPurchaseItems } from '../src/lib/bulk-purchase';

const groups = [
  { id: 7, name: '写真商品A', origin: 'photo' },
  { id: 8, name: '写真商品B', origin: 'photo' },
  { id: 9, name: '手動の比較', origin: 'manual' },
] as ComparisonGroup[];
function item(id: number, fields: Partial<Item> = {}): Item {
  return { id, name: `試用品${id}`, source: 'other', url: 'manual://test', current_price: 1000,
    comparison_group_id: null, is_purchased: false, deleted_at: null, ...fields } as Item;
}

test('bulk purchase prefers the selected budgeted shop and retains every ordinary item', () => {
  const items = [
    item(1, { comparison_group_id: 7, current_price: 1000, countsInTotal: false }),
    item(2, { comparison_group_id: 7, current_price: 2000, countsInTotal: true }),
    item(3), item(4, { comparison_group_id: 9 }), item(5, { comparison_group_id: 9 }),
  ];
  const selected = new Set(items.map(entry => entry.id));
  const before = structuredClone(items);
  assert.deepEqual(bulkPurchaseItems(items, groups, selected).map(entry => entry.id), [2, 3, 4, 5]);
  assert.deepEqual(items, before);
  assert.deepEqual([...selected], [1, 2, 3, 4, 5]);
});

test('a selected alternative is never replaced by an unselected budgeted shop', () => {
  const items = [
    item(1, { comparison_group_id: 7, countsInTotal: false }),
    item(2, { comparison_group_id: 7, countsInTotal: true }),
  ];
  assert.deepEqual(bulkPurchaseItems(items, groups, new Set([1])).map(entry => entry.id), [1]);
});

test('fallback shops use stable price order even without group metadata', () => {
  const items = [
    item(3, { comparison_group_id: 7, comparison_group_origin: 'photo', current_price: null }),
    item(2, { comparison_group_id: 7, comparison_group_origin: 'photo', current_price: 100 }),
    item(1, { comparison_group_id: 7, comparison_group_origin: 'photo', current_price: 100 }),
    item(4, { comparison_group_id: 8, comparison_group_origin: 'photo', current_price: null }),
    item(5, { comparison_group_id: 8, comparison_group_origin: 'photo', current_price: null }),
  ];
  assert.deepEqual(bulkPurchaseItems(items, [], new Set([1, 2, 3, 4, 5])).map(entry => entry.id), [1, 4]);
});

test('bulk purchase never adds unselected items, repeats a photo group, or loses ordinary selections', () => {
  fc.assert(fc.property(fc.array(fc.record({
    kind: fc.integer({ min: 0, max: 3 }),
    price: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null }),
    selected: fc.boolean(), purchased: fc.boolean(), deleted: fc.boolean(), counted: fc.boolean(),
  }), { maxLength: 30 }), entries => {
    const items = entries.map((entry, index) => item(index + 1, {
      comparison_group_id: [null, 7, 8, 9][entry.kind], current_price: entry.price,
      countsInTotal: entry.counted, is_purchased: entry.purchased,
      deleted_at: entry.deleted ? '2026-11-25 00:00:00' : null,
    }));
    const selected = new Set(items.filter((_, index) => entries[index].selected).map(entry => entry.id));
    selected.add(9999); // A stale selection is not an eligible purchase.
    const result = bulkPurchaseItems(items, groups, selected);
    assert.equal(new Set(result.map(entry => entry.id)).size, result.length);
    assert.ok(result.every(entry => selected.has(entry.id) && !entry.is_purchased && !entry.deleted_at));
    const eligible = items.filter(entry => selected.has(entry.id) && !entry.is_purchased && !entry.deleted_at);
    for (const groupId of [7, 8]) {
      const candidates = eligible.filter(entry => entry.comparison_group_id === groupId);
      const chosen = result.filter(entry => entry.comparison_group_id === groupId);
      assert.equal(chosen.length, candidates.length ? 1 : 0);
      if (candidates.some(entry => entry.countsInTotal === true)) assert.equal(chosen[0].countsInTotal, true);
    }
    const ordinary = (entry: Item) => entry.comparison_group_id !== 7 && entry.comparison_group_id !== 8;
    assert.deepEqual(result.filter(ordinary).map(entry => entry.id), eligible.filter(ordinary).map(entry => entry.id));
  }), { seed: 435, numRuns: 200 });
});
