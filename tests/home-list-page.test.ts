import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { filterHomeItems, type HomeListQuery, type HomeSortBy } from '../src/lib/home-wishlist';
import {
  HOME_LIST_PAGE_SIZE,
  alignHomeListPage,
  createHomeListPage,
  homeListDragOrders,
  homeListHasMore,
  homeListQueryPageKey,
  reduceHomeListPage,
  selectAllFilteredIds,
  visibleHomeItems,
  visibleWishlistRows,
} from '../src/lib/home-list-page';

// 絞り込みと並びのあとの画面上のページ。1ページは定数の50件。
const SEED = 20261025;

type Row = {
  id: number;
  name: string;
  notes: string | null;
  category_name: string | null;
  category_id: number | null;
  priority: number;
  comparison_group_id: number | null;
  comparison_group_origin?: string | null;
  current_price: number | null;
  created_at: string;
  sort_order: number;
};

type ItemRow = { kind: 'item'; item: Row };
type PhotoRow = { kind: 'photo'; itemIds: readonly number[] };
type ListRow = ItemRow | PhotoRow;

function baseQuery(sortBy: HomeSortBy = 'priority'): HomeListQuery {
  return {
    selectedCategory: null,
    selectedPriority: null,
    selectedGroup: null,
    searchQuery: '',
    sortBy,
  };
}

function row(id: number, overrides: Partial<Row> = {}): Row {
  return {
    id,
    name: `品${id}`,
    notes: null,
    category_name: null,
    category_id: null,
    priority: 3,
    comparison_group_id: null,
    comparison_group_origin: null,
    current_price: 100,
    created_at: '2026-01-01T00:00:00.000Z',
    sort_order: 0,
    ...overrides,
  };
}

function idsOf(items: readonly { id: number }[]): number[] {
  return items.map((item) => item.id);
}

function shownIds(rows: readonly ListRow[]): number[] {
  return rows.flatMap((entry) => entry.kind === 'item' ? [entry.item.id] : [...entry.itemIds]);
}

test('the list page size is the constant 50 and the first page is that prefix', () => {
  assert.equal(HOME_LIST_PAGE_SIZE, 50);
  const items = Array.from({ length: 120 }, (_, index) => row(index + 1, { name: index < 80 ? `本${index}` : `ペン${index}` }));
  const filtered = filterHomeItems(items, { ...baseQuery(), searchQuery: '本' });
  assert.equal(filtered.length, 80);
  const page = createHomeListPage();
  const visible = visibleHomeItems(filtered, page);
  assert.equal(visible.length, HOME_LIST_PAGE_SIZE);
  assert.deepEqual(idsOf(visible), idsOf(filtered.slice(0, HOME_LIST_PAGE_SIZE)));
  assert.ok(visible.every((item) => item.name.includes('本')));
  assert.equal(homeListHasMore(page, filtered.length), true);
});

test('もっと見る appends the next 50 and the control is gone when every filtered item is shown', () => {
  const items = Array.from({ length: 120 }, (_, index) => row(index + 1));
  let page = createHomeListPage();
  assert.deepEqual(idsOf(visibleHomeItems(items, page)), idsOf(items.slice(0, 50)));
  assert.equal(homeListHasMore(page, items.length), true);

  page = reduceHomeListPage(page, { type: 'show-more', total: items.length });
  assert.deepEqual(idsOf(visibleHomeItems(items, page)), idsOf(items.slice(0, 100)));
  assert.equal(homeListHasMore(page, items.length), true);

  page = reduceHomeListPage(page, { type: 'show-more', total: items.length });
  assert.deepEqual(idsOf(visibleHomeItems(items, page)), idsOf(items));
  assert.equal(homeListHasMore(page, items.length), false);

  const stayed = reduceHomeListPage(page, { type: 'show-more', total: items.length });
  assert.deepEqual(idsOf(visibleHomeItems(items, stayed)), idsOf(items));
  assert.equal(homeListHasMore(stayed, items.length), false);

  const exact = createHomeListPage();
  const fifty = items.slice(0, 50);
  assert.equal(homeListHasMore(exact, fifty.length), false);
  assert.deepEqual(idsOf(visibleHomeItems(fifty, exact)), idsOf(fifty));
});

test('changing the filter or the sort returns to the first 50', () => {
  const items = Array.from({ length: 60 }, (_, index) => row(index + 1, {
    name: String(1000 - index).padStart(4, '0'),
    priority: (index % 5) + 1,
    category_id: index % 2 === 0 ? 1 : 2,
    comparison_group_id: index % 3 === 0 ? 7 : null,
  }));
  const priorityOrder = filterHomeItems(items, baseQuery());
  const nameOrder = filterHomeItems(items, { ...baseQuery(), sortBy: 'name' });
  assert.notDeepEqual(idsOf(priorityOrder.slice(0, 50)), idsOf(nameOrder.slice(0, 50)));

  const baseKey = homeListQueryPageKey(baseQuery());
  assert.notEqual(baseKey, homeListQueryPageKey({ ...baseQuery(), sortBy: 'name' }));
  assert.notEqual(baseKey, homeListQueryPageKey({ ...baseQuery(), searchQuery: 'あ' }));
  assert.notEqual(baseKey, homeListQueryPageKey({ ...baseQuery(), selectedCategory: 1 }));
  assert.notEqual(baseKey, homeListQueryPageKey({ ...baseQuery(), selectedPriority: 2 }));
  assert.notEqual(baseKey, homeListQueryPageKey({ ...baseQuery(), selectedGroup: 7 }));
  assert.equal(baseKey, homeListQueryPageKey(baseQuery()));

  let page = reduceHomeListPage(createHomeListPage(), { type: 'show-more', total: items.length });
  assert.equal(visibleHomeItems(priorityOrder, page).length, 60);
  const expanded = { key: baseKey, page };
  assert.equal(alignHomeListPage(expanded, baseKey), expanded);

  page = alignHomeListPage(expanded, homeListQueryPageKey({ ...baseQuery(), sortBy: 'name' })).page;
  assert.deepEqual(idsOf(visibleHomeItems(nameOrder, page)), idsOf(nameOrder.slice(0, 50)));
  assert.equal(homeListHasMore(page, nameOrder.length), true);

  const categoryOrder = filterHomeItems(items, { ...baseQuery(), selectedCategory: 1 });
  page = alignHomeListPage(
    { key: homeListQueryPageKey({ ...baseQuery(), sortBy: 'name' }), page },
    homeListQueryPageKey({ ...baseQuery(), selectedCategory: 1 }),
  ).page;
  assert.deepEqual(idsOf(visibleHomeItems(categoryOrder, page)), idsOf(categoryOrder.slice(0, HOME_LIST_PAGE_SIZE)));
});

test('drag reorder saves sort_order so hidden items keep their place', () => {
  const items = [
    ...Array.from({ length: 40 }, (_, index) => row(index + 1, { priority: 1 })),
    ...Array.from({ length: 40 }, (_, index) => row(index + 41, { priority: 3 })),
  ];
  const filtered = filterHomeItems(items, baseQuery());
  assert.deepEqual(idsOf(filtered), Array.from({ length: 80 }, (_, index) => index + 1));
  const visible = visibleHomeItems(filtered, createHomeListPage());
  assert.deepEqual(idsOf(visible), Array.from({ length: 50 }, (_, index) => index + 1));

  const orders = homeListDragOrders(filtered, 45, 42);
  assert.ok(orders);
  assert.equal(orders.has(1), false);
  assert.equal(orders.has(51), true);

  const saved = filtered.map((item) => ({
    ...item,
    sort_order: orders.has(item.id) ? orders.get(item.id)! : item.sort_order,
  }));
  const ranked = filterHomeItems(saved, baseQuery());
  assert.deepEqual(idsOf(ranked), [
    ...Array.from({ length: 40 }, (_, index) => index + 1),
    41, 45, 42, 43, 44,
    ...Array.from({ length: 35 }, (_, index) => index + 46),
  ]);
  assert.deepEqual(idsOf(ranked.slice(50)), Array.from({ length: 30 }, (_, index) => index + 51));
});

test('全選択 selects every filtered item, including ones not on screen', () => {
  const items = [
    ...Array.from({ length: 70 }, (_, index) => row(index + 1, { name: `本${index}` })),
    ...Array.from({ length: 10 }, (_, index) => row(index + 100, { name: `ペン${index}` })),
  ];
  const filtered = filterHomeItems(items, { ...baseQuery(), searchQuery: '本' });
  const visible = visibleHomeItems(filtered, createHomeListPage());
  const selected = selectAllFilteredIds(filtered);
  assert.equal(selected.length, 70);
  assert.deepEqual(selected, idsOf(filtered));
  assert.ok(selected.some((id) => !visible.some((item) => item.id === id)));
  assert.ok(selected.every((id) => id < 100));
});

test('a photo group split by the page does not show the hidden member', () => {
  const items = Array.from({ length: 52 }, (_, index) => row(index + 1));
  const wishlist: ListRow[] = [
    ...items.slice(0, 49).map((item): ItemRow => ({ kind: 'item', item })),
    { kind: 'photo', itemIds: [50, 51] },
    { kind: 'item', item: items[51] },
  ];
  const first = visibleWishlistRows(items, wishlist, createHomeListPage());
  assert.deepEqual(shownIds(first), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(first.at(-1)?.kind, 'item');

  const rest = reduceHomeListPage(createHomeListPage(), { type: 'show-more', total: items.length });
  const shown = visibleWishlistRows(items, wishlist, rest);
  assert.equal(shown.at(-2)?.kind, 'photo');
  assert.deepEqual(shownIds(shown), Array.from({ length: 52 }, (_, index) => index + 1));
  assert.equal(homeListHasMore(rest, items.length), false);
});

test('show more grows by the page size and never past the filtered list', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 180 }),
    fc.integer({ min: 0, max: 6 }),
    (total, clicks) => {
      const items = Array.from({ length: total }, (_, index) => index + 1);
      let page = createHomeListPage();
      for (let click = 0; click < clicks; click += 1) {
        page = reduceHomeListPage(page, { type: 'show-more', total });
      }
      const expected = Math.min(HOME_LIST_PAGE_SIZE * (clicks + 1), total);
      assert.deepEqual(visibleHomeItems(items, page), items.slice(0, expected));
      assert.equal(homeListHasMore(page, total), expected < total);
    },
  ), { seed: SEED, numRuns: 40 });
});

test('dragging inside the first page leaves the hidden suffix in place', () => {
  fc.assert(fc.property(
    fc.integer({ min: 51, max: 80 }),
    fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 80, maxLength: 80 }),
    (total, priorities) => {
      const items = Array.from({ length: total }, (_, index) => row(index + 1, { priority: priorities[index] }));
      const filtered = filterHomeItems(items, baseQuery());
      const visible = visibleHomeItems(filtered, createHomeListPage());
      const pairs = new Map<number, number[]>();
      for (const item of visible) {
        const list = pairs.get(item.priority) ?? [];
        list.push(item.id);
        pairs.set(item.priority, list);
      }
      const pair = [...pairs.values()].find((list) => list.length >= 2);
      fc.pre(pair != null);
      const orders = homeListDragOrders(filtered, pair[1], pair[0]);
      assert.ok(orders);
      const saved = filtered.map((item) => ({
        ...item,
        sort_order: orders.has(item.id) ? orders.get(item.id)! : item.sort_order,
      }));
      const ranked = filterHomeItems(saved, baseQuery());
      assert.deepEqual(idsOf(ranked.slice(HOME_LIST_PAGE_SIZE)), idsOf(filtered.slice(HOME_LIST_PAGE_SIZE)));
    },
  ), { seed: SEED, numRuns: 30 });
});
