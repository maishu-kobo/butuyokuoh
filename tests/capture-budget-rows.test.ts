import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the budget screen does not indent photo groups or use the group name as a header', () => {
  const view = readFileSync(new URL('../src/components/BudgetView.tsx', import.meta.url), 'utf8');
  assert.match(view, /budgetRows\(/);
  assert.equal(view.includes('pl-4'), false);
  assert.match(view, /合計に数える/);
  assert.match(view, /合計に含まない/);
  assert.match(view, /budgetItemId/);
});
