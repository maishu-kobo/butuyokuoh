import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planItemPage } from '../src/lib/item-page-plan.mjs';

test('stable pages cover hundreds of items once and never split a photo group', () => {
  for (const size of [0, 1, 49, 50, 51, 500, 1001]) {
    const rows = Array.from({ length: size }, (_, i) => ({
      id: i + 1, comparison_group_id: i % 7 === 0 ? 7 : null,
      comparison_group_origin: i % 7 === 0 ? 'photo' : null,
    }));
    for (const limit of [1, 7, 50, 100]) {
      const pages: number[][] = [];
      let offset: number | null = 0;
      do {
        const page = planItemPage(rows, offset, limit);
        pages.push(page.ids);
        offset = page.nextOffset;
      } while (offset !== null);
      const ids = pages.flat();
      assert.equal(new Set(ids).size, size);
      assert.deepEqual(ids.sort((a, b) => a - b), rows.map(row => row.id));
      const photoIds = rows.filter(row => row.comparison_group_id === 7).map(row => row.id);
      if (size) assert.ok(photoIds.every(id => pages[0].includes(id)));
    }
  }
});

test('manual comparison groups stay separate and input is not mutated', () => {
  const rows = [1, 2, 3].map(id => ({ id, comparison_group_id: 8, comparison_group_origin: null }));
  const before = JSON.stringify(rows);
  assert.deepEqual(planItemPage(rows, 0, 2), { ids: [1, 2], nextOffset: 2, rowCount: 3 });
  assert.deepEqual(planItemPage(rows, 2, 2), { ids: [3], nextOffset: null, rowCount: 3 });
  assert.equal(JSON.stringify(rows), before);
});

test('invalid boundaries and duplicate IDs are rejected', () => {
  for (const limit of [0, -1, 101, 1.5, Number.NaN]) assert.throws(() => planItemPage([], 0, limit));
  for (const offset of [-1, 1, 0.5, Number.NaN]) assert.throws(() => planItemPage([], offset));
  assert.throws(() => planItemPage([
    { id: 1, comparison_group_id: null }, { id: 1, comparison_group_id: null },
  ]));
});
