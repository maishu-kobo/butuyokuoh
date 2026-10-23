import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSortOrders, type SortableListItem } from '../src/lib/capture/list-order';

function row(id: number, overrides: Partial<SortableListItem> = {}): SortableListItem {
  return {
    id,
    priority: 3,
    comparison_group_id: null,
    comparison_group_origin: null,
    ...overrides,
  };
}

test('plain items move within one priority and leave other priorities alone', () => {
  const items = [row(1, { priority: 1 }), row(2), row(3), row(4)];
  const orders = nextSortOrders(items, 4, 2);
  assert.ok(orders);
  assert.equal(orders.has(1), false);
  assert.equal(orders.get(4), 0);
  assert.equal(orders.get(2), 1);
  assert.equal(orders.get(3), 2);
  assert.equal(nextSortOrders(items, 2, 1), null);
  assert.equal(nextSortOrders(items, 2, 2), null);
});

test('dragging a photo group moves every member together and keeps hand-made items separate', () => {
  const items = [
    row(1),
    row(10, { comparison_group_id: 7, comparison_group_origin: 'photo' }),
    row(11, { comparison_group_id: 7, comparison_group_origin: 'photo' }),
    row(4),
    row(20, { comparison_group_id: 9, comparison_group_origin: 'manual' }),
    row(21, { comparison_group_id: 9, comparison_group_origin: 'manual' }),
  ];
  const orders = nextSortOrders(items, 10, 4);
  assert.ok(orders);
  assert.deepEqual([...orders.entries()], [
    [1, 0],
    [4, 1],
    [20, 2],
    [21, 3],
    [10, 4],
    [11, 5],
  ]);
  const back = nextSortOrders(items, 4, 10);
  assert.ok(back);
  assert.deepEqual([...back.entries()], [
    [1, 0],
    [4, 1],
    [10, 2],
    [11, 3],
    [20, 4],
    [21, 5],
  ]);
});
