import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { budgetRows } from '../src/lib/capture/budget-rows';

test('several shops stay flat rows with a chooser, and one shop is a normal row', () => {
  const pencil = { id: 1, name: '天幕のジャードゥーガル 3', comparison_group_id: null, group_origin: null };
  const yahoo = { id: 2, name: 'Belkin Yahoo', comparison_group_id: 7, group_origin: 'photo' as const };
  const rakuten = { id: 3, name: 'Belkin 楽天', comparison_group_id: 7, group_origin: 'photo' as const };
  const single = { id: 4, name: '単品ショップ', comparison_group_id: 8, group_origin: 'photo' as const };
  assert.deepEqual(budgetRows([pencil, yahoo, rakuten, single]), [
    { item: pencil, chooseGroupId: null },
    { item: yahoo, chooseGroupId: 7 },
    { item: rakuten, chooseGroupId: 7 },
    { item: single, chooseGroupId: null },
  ]);
});

test('a shop alone in one month still has a chooser when another shop is registered', () => {
  const yahoo = { id: 2, name: 'Belkin Yahoo', comparison_group_id: 7, group_origin: 'photo' as const };
  const rakuten = { id: 3, name: 'Belkin 楽天', comparison_group_id: 7, group_origin: 'photo' as const };
  assert.deepEqual(budgetRows([yahoo], [yahoo, rakuten]), [{ item: yahoo, chooseGroupId: 7 }]);
});

test('a hand-made group stays one row per item without a chooser', () => {
  const left = { id: 1, name: '左', comparison_group_id: 9, group_origin: null };
  const right = { id: 2, name: '右', comparison_group_id: 9, group_origin: 'manual' };
  assert.deepEqual(budgetRows([left, right]).map((row) => row.chooseGroupId), [null, null]);
});

test('photo shops stay the same flat rows, and a group name is not inserted as a header', () => {
  const yahoo = {
    id: 2,
    name: 'Belkin Yahoo',
    comparison_group_id: 7,
    group_origin: 'photo' as const,
    comparison_group_name: 'Belkin',
  };
  const rakuten = {
    id: 3,
    name: 'Belkin 楽天',
    comparison_group_id: 7,
    group_origin: 'photo' as const,
    comparison_group_name: 'Belkin',
  };
  const rows = budgetRows([yahoo, rakuten]);
  assert.deepEqual(rows.map((row) => row.item), [yahoo, rakuten]);
  assert.deepEqual(rows.map((row) => row.chooseGroupId), [7, 7]);
  assert.deepEqual(rows.map((row) => Object.keys(row).sort()), [
    ['chooseGroupId', 'item'],
    ['chooseGroupId', 'item'],
  ]);
  assert.equal(rows.some((row) => row.item.name === 'Belkin'), false);
});

test('every visible item stays one flat row, with no header and no indent', () => {
  fc.assert(fc.property(
    fc.array(fc.record({
      id: fc.integer({ min: 1, max: 1000 }),
      name: fc.string(),
      comparison_group_id: fc.option(fc.integer({ min: 1, max: 20 }), { nil: null }),
      group_origin: fc.constantFrom('photo', 'manual', null),
    }), { maxLength: 8 }),
    (items) => {
      const rows = budgetRows(items);
      assert.equal(rows.length, items.length);
      rows.forEach((row, index) => {
        assert.equal(row.item, items[index]);
        assert.deepEqual(Object.keys(row).sort(), ['chooseGroupId', 'item']);
        assert.equal('indent' in row, false);
        assert.equal('header' in row, false);
      });
    },
  ), { seed: 20261023, numRuns: 40 });
});
