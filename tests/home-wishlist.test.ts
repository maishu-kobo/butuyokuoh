import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import {
  HOME_TABS,
  filterHomeItems,
  homeDragEnabled,
  homeTabAnimation,
  homeTabBySwipe,
  lowestPriceInSelectedGroup,
  type HomeListQuery,
  type HomeSortBy,
  type HomeTab,
} from '../src/lib/home-wishlist';

// ホームの絞り込みは page.tsx から切り出しても、今の比較のまま動く。
const SEED = 20261025;
const RUNS = 60;

type Row = {
  id: number;
  name: string;
  notes: string | null;
  category_name: string | null;
  category_id: number | null;
  priority: number;
  comparison_group_id: number | null;
  current_price: number | null;
  created_at: string;
  sort_order?: number;
};

const SORTS = ['priority', 'price_asc', 'price_desc', 'date_new', 'date_old', 'name'] as const;

const LETTERS = [...'abcABCあいうアイウ 012'];

function textArb(maxLength: number) {
  return fc.array(fc.constantFrom(...LETTERS), { maxLength }).map((chars) => chars.join(''));
}

const rowArb: fc.Arbitrary<Row> = fc.record({
  id: fc.integer({ min: 1, max: 9999 }),
  name: textArb(10),
  notes: fc.option(textArb(10), { nil: null }),
  category_name: fc.option(textArb(8), { nil: null }),
  category_id: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  priority: fc.integer({ min: 0, max: 5 }),
  comparison_group_id: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  current_price: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null }),
  created_at: fc.integer({ min: 0, max: 1_800_000_000_000 }).map((time) => new Date(time).toISOString()),
  sort_order: fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }),
});

const queryArb: fc.Arbitrary<HomeListQuery> = fc.record({
  selectedCategory: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  selectedPriority: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  selectedGroup: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
  searchQuery: textArb(6),
  sortBy: fc.constantFrom(...SORTS),
});

function baseQuery(sortBy: HomeSortBy = 'priority'): HomeListQuery {
  return {
    selectedCategory: null,
    selectedPriority: null,
    selectedGroup: null,
    searchQuery: '',
    sortBy,
  };
}

function row(partial: Partial<Row> & Pick<Row, 'id' | 'name'>): Row {
  return {
    notes: null,
    category_name: null,
    category_id: null,
    priority: 3,
    comparison_group_id: null,
    current_price: null,
    created_at: '2026-01-01T00:00:00.000Z',
    sort_order: 0,
    ...partial,
  };
}

// page.tsx が今やっている判定を、実装とは別に書く。
function matches(item: Row, query: HomeListQuery): boolean {
  if (query.selectedCategory && item.category_id !== query.selectedCategory) return false;
  if (query.selectedPriority && item.priority !== query.selectedPriority) return false;
  if (query.selectedGroup && item.comparison_group_id !== query.selectedGroup) return false;
  if (query.searchQuery) {
    const needle = query.searchQuery.toLowerCase();
    return Boolean(
      item.name.toLowerCase().includes(needle) ||
      item.notes?.toLowerCase().includes(needle) ||
      item.category_name?.toLowerCase().includes(needle),
    );
  }
  return true;
}

function compare(a: Row, b: Row, sortBy: HomeSortBy): number {
  switch (sortBy) {
    case 'price_asc':
    case 'price_desc': {
      const av = a.current_price;
      const bv = b.current_price;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortBy === 'price_asc' ? av - bv : bv - av;
    }
    case 'date_new':
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    case 'date_old':
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    case 'name':
      return a.name.localeCompare(b.name, 'ja');
    case 'priority':
    default:
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  }
}

test('filter keeps the same item objects and the current sort rules', () => {
  fc.assert(fc.property(fc.array(rowArb, { maxLength: 12 }), queryArb, (items, query) => {
    const before = items.map((item) => ({ ...item }));
    const result = filterHomeItems(items, query);
    assert.deepEqual(items, before);

    const expected = items.filter((item) => matches(item, query)).sort((a, b) => compare(a, b, query.sortBy));
    assert.equal(result.length, expected.length);
    result.forEach((item, index) => {
      assert.equal(item, expected[index]);
    });
  }), { seed: SEED, numRuns: RUNS });
});

test('search is case-insensitive across name, notes, and category', () => {
  const items = [
    row({ id: 1, name: 'Pen' }),
    row({ id: 2, name: 'ノート', notes: 'Blue PEN' }),
    row({ id: 3, name: '消しゴム', category_name: '文具Pen' }),
    row({ id: 4, name: 'コップ' }),
  ];
  const result = filterHomeItems(items, { ...baseQuery(), searchQuery: 'pen' });
  assert.deepEqual(result.map((item) => item.id), [1, 2, 3]);
});

test('category, priority, and group filters combine, and 0 means no filter', () => {
  const items = [
    row({ id: 1, name: 'a', category_id: 2, priority: 1, comparison_group_id: 4 }),
    row({ id: 2, name: 'b', category_id: 2, priority: 1, comparison_group_id: 9 }),
    row({ id: 3, name: 'c', category_id: 0, priority: 0, comparison_group_id: 0 }),
  ];
  const narrowed = filterHomeItems(items, {
    ...baseQuery(),
    selectedCategory: 2,
    selectedPriority: 1,
    selectedGroup: 4,
  });
  assert.deepEqual(narrowed.map((item) => item.id), [1]);

  const open = filterHomeItems(items, {
    ...baseQuery(),
    selectedCategory: 0,
    selectedPriority: 0,
    selectedGroup: 0,
  });
  assert.deepEqual(open.map((item) => item.id), [3, 1, 2]);
});

test('missing prices stay at the end for both price sorts, and 0 is a real price', () => {
  const items = [
    row({ id: 1, name: 'none', current_price: null, priority: 1 }),
    row({ id: 2, name: 'zero', current_price: 0, priority: 1 }),
    row({ id: 3, name: 'high', current_price: 500, priority: 1 }),
  ];
  assert.deepEqual(filterHomeItems(items, baseQuery('price_asc')).map((item) => item.id), [2, 3, 1]);
  assert.deepEqual(filterHomeItems(items, baseQuery('price_desc')).map((item) => item.id), [3, 2, 1]);
});

test('priority order breaks ties with sort_order, and names use Japanese collation', () => {
  const items = [
    row({ id: 1, name: 'い', priority: 2, sort_order: 2 }),
    row({ id: 2, name: 'あ', priority: 1, sort_order: 5 }),
    row({ id: 3, name: 'う', priority: 2, sort_order: 1 }),
  ];
  assert.deepEqual(filterHomeItems(items, baseQuery('priority')).map((item) => item.id), [2, 3, 1]);
  assert.deepEqual(filterHomeItems(items, baseQuery('name')).map((item) => item.name), ['あ', 'い', 'う']);
});

test('newer and older dates follow created_at', () => {
  const items = [
    row({ id: 1, name: 'old', created_at: '2024-01-01T00:00:00.000Z' }),
    row({ id: 2, name: 'new', created_at: '2026-05-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(filterHomeItems(items, baseQuery('date_new')).map((item) => item.id), [2, 1]);
  assert.deepEqual(filterHomeItems(items, baseQuery('date_old')).map((item) => item.id), [1, 2]);
});

test('drag stays available only for an unfiltered priority list', () => {
  fc.assert(fc.property(queryArb, (query) => {
    const enabled = query.sortBy === 'priority'
      && !query.selectedCategory
      && !query.selectedGroup
      && !query.selectedPriority
      && !query.searchQuery;
    assert.equal(homeDragEnabled(query), enabled);
  }), { seed: SEED, numRuns: RUNS });
});

test('the lowest group price ignores 0 and becomes Infinity when none remain', () => {
  const items = [
    { current_price: 0 },
    { current_price: null },
    { current_price: 800 },
    { current_price: 120 },
  ];
  assert.equal(lowestPriceInSelectedGroup(null, items), null);
  assert.equal(lowestPriceInSelectedGroup(0, items), null);
  assert.equal(lowestPriceInSelectedGroup(4, items), 120);
  assert.equal(lowestPriceInSelectedGroup(4, [{ current_price: 0 }, { current_price: null }]), Infinity);
});

test('swipe and tab animation keep the current direction', () => {
  assert.deepEqual(HOME_TABS, ['list', 'budget', 'purchased', 'stats', 'trash']);

  fc.assert(fc.property(fc.constantFrom(...HOME_TABS), fc.constantFrom('left' as const, 'right' as const), (active, direction) => {
    const index = HOME_TABS.indexOf(active);
    const next = homeTabBySwipe(active, direction);
    if (direction === 'left') {
      assert.equal(next, index < HOME_TABS.length - 1 ? HOME_TABS[index + 1] : null);
    } else {
      assert.equal(next, index > 0 ? HOME_TABS[index - 1] : null);
    }
    if (next) assert.equal(homeTabAnimation(active, next, direction), direction === 'left' ? 'slide-in-right' : 'slide-in-left');
  }), { seed: SEED, numRuns: RUNS });

  const later: HomeTab = 'trash';
  const earlier: HomeTab = 'list';
  assert.equal(homeTabAnimation('budget', later), 'slide-in-right');
  assert.equal(homeTabAnimation('stats', earlier), 'slide-in-left');
  assert.equal(homeTabAnimation('list', 'trash', 'right'), 'slide-in-left');
  assert.equal(homeTabAnimation('list', 'list'), null);
  assert.equal(homeTabBySwipe('list', 'right'), null);
  assert.equal(homeTabBySwipe('trash', 'left'), null);
});
