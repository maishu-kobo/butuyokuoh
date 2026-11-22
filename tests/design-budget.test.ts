import assert from 'node:assert/strict';
import test from 'node:test';
import type { Item } from '../src/types';
import { budgetSelectionState, reconcileBudgetSelection, scheduleBudgetRows, toggleBudgetSelection } from '../src/lib/design-budget';

const item = (id: number, props: Partial<Item> = {}) => ({ id, name: '商品'+id, current_price: 1000, quantity: 1,
  comparison_group_id: null, planned_purchase_date: '2026-11-15', ...props } as Item);

test('photo offers share one dated row while preserving every offer and the counted choice', () => {
  const cheap = item(1, { comparison_group_id: 4, group_origin: 'photo', countsInTotal: false, comparison_group_name: 'カメラ' });
  const chosen = item(2, { comparison_group_id: 4, group_origin: 'photo', countsInTotal: true, current_price: 1400 });
  const rows = scheduleBudgetRows([cheap, chosen], [cheap, chosen]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'カメラ');
  assert.equal(rows[0].item.id, 2);
  assert.deepEqual(rows[0].offers.map(x => x.id), [1, 2]);
  assert.deepEqual(rows[0].monthItems.map(x => x.id), [1, 2]);
});

test('manual comparison groups remain separate purchases and dates sort chronologically', () => {
  const a = item(1, { comparison_group_id: 4, group_origin: 'manual', planned_purchase_date: '2026-11-20' });
  const b = item(2, { comparison_group_id: 4, group_origin: 'manual' });
  assert.deepEqual(scheduleBudgetRows([a,b], [a,b]).map(row => row.item.id), [2,1]);
});

test('a photo offer in a different month stays visible without losing the other store options', () => {
  const a = item(1, { comparison_group_id: 4, group_origin: 'photo', countsInTotal: true });
  const b = item(2, { comparison_group_id: 4, group_origin: 'photo', countsInTotal: false, planned_purchase_date: '2026-12-01' });
  const rows = scheduleBudgetRows([b], [a,b]);
  assert.equal(rows[0].item.id, 2);
  assert.equal(rows[0].item.countsInTotal, false);
  assert.deepEqual(rows[0].offers.map(x => x.id), [1,2]);
  assert.deepEqual(rows[0].monthItems.map(x => x.id), [2]);
});

test('initial selection includes the counted offers and unknown prices without counting alternative stores twice', () => {
  const items = [item(1), item(2, {countsInTotal:false}), item(3, {current_price:null})];
  assert.deepEqual([...reconcileBudgetSelection(null, items, new Set())], [1,3]);
});

test('bulk selection and clearing only change the displayed scope and expose a mixed state', () => {
  const items = [item(1), item(2), item(3, {countsInTotal:false})];
  assert.equal(budgetSelectionState(items,new Set([1,9])),'mixed');
  const all = toggleBudgetSelection(items,new Set([1,3,9]));
  assert.deepEqual([...all].sort(),[1,2,9]);
  assert.equal(budgetSelectionState(items,all),true);
  assert.deepEqual([...toggleBudgetSelection(items,all)],[9]);
  assert.equal(budgetSelectionState(items,new Set([9])),false);
  assert.equal(budgetSelectionState([],new Set([9])),false);
});

test('refresh preserves unchecked items and transfers the selected purchase to the newly counted offer', () => {
  const before = [item(1,{group_origin:'photo',comparison_group_id:4,countsInTotal:true}),item(2,{group_origin:'photo',comparison_group_id:4,countsInTotal:false}),item(3)];
  const after = [{...before[0],countsInTotal:false},{...before[1],countsInTotal:true},before[2]];
  assert.deepEqual([...reconcileBudgetSelection(before,after,new Set([1]))],[2]);
  assert.deepEqual([...reconcileBudgetSelection(before,after,new Set())],[]);
});

test('date changes keep selection while removed items disappear and newly added purchases are selected', () => {
  const before=[item(1),item(2)];
  const after=[item(1,{planned_purchase_date:null}),item(3),item(4,{countsInTotal:false})];
  assert.deepEqual([...reconcileBudgetSelection(before,after,new Set([1,2]))],[1,3]);
});
