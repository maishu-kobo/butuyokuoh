import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactNode, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthContext } from '../src/components/AuthProvider';
import HomeListView from '../src/components/home/HomeListView';
import type { Item } from '../src/types';

const auth = {
  user: null,
  token: null,
  loading: false,
  isGuest: false,
  guestEnabled: false,
  ttlHours: 24,
  googleLogin: false,
  startGuest: async () => {},
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};

function markup(node: ReactNode): string {
  return renderToStaticMarkup(createElement(AuthContext.Provider, { value: auth }, node));
}

function item(partial: Partial<Item> & Pick<Item, 'id' | 'name'>): Item {
  return {
    url: 'https://example.test/item',
    image_url: null,
    current_price: 100,
    original_price: null,
    source: 'other',
    source_name: null,
    priority: 3,
    planned_purchase_date: null,
    comparison_group_id: null,
    category_id: null,
    notes: null,
    is_purchased: false,
    purchased_at: null,
    target_price: null,
    target_currency: null,
    quantity: 1,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

const quiet = {
  categories: [],
  groups: [],
  searchQuery: '',
  onSearchQuery: () => {},
  sortBy: 'priority' as const,
  onSortBy: () => {},
  selectedPriority: null,
  onSelectedPriority: () => {},
  selectedCategory: null,
  onSelectedCategory: () => {},
  selectedGroup: null,
  onSelectedGroup: () => {},
  isFilterOpen: false,
  onToggleFilter: () => {},
  selectionMode: false,
  selectedCount: 0,
  selectedItems: new Set<number>(),
  onToggleSelectionMode: () => {},
  onSelectAll: () => {},
  onDeselectAll: () => {},
  onClearFilters: () => {},
  onRetry: () => {},
  onDelete: () => {},
  onToggleSelect: () => {},
  onItemsChanged: () => {},
  onPhotoChanged: () => {},
  onImport: () => {},
  onRefreshAll: () => {},
  onViewRegistered: () => {},
  onDragEnd: () => {},
  refreshing: false,
  isGuest: true,
  dragEnabled: true,
  lowestPriceInGroup: null,
};

type Props = ComponentProps<typeof HomeListView>;
function render(overrides: Partial<Props> = {}): string {
  const loaded = [item({ id: 1, name: '読み込み済み商品' })];
  return markup(createElement(HomeListView, {
    ...quiet, items: loaded, filteredItems: loaded,
    wishlist: loaded.map(entry => ({ kind: 'item' as const, item: entry })),
    totalAmount: 50000, loading: false, loadError: false, dragEnabled: false,
    paging: { totalCount: 500, matchedCount: 120, hasMore: true, moreLoading: false,
      moreError: false, notice: '', onMore: () => {} },
    ...overrides,
  }));
}

test('paged view shows server counts and totals, independent of the loaded subset', () => {
  const html = render();
  assert.match(html, /500<span[^>]*>件<\/span>/);
  assert.match(html, /ほしいものリスト \(120件/);
  assert.ok(html.includes(`¥${(50000).toLocaleString()}`));
  assert.match(html, /読み込み済み商品/);
  assert.match(html, /もっと見る/);
  assert.match(html, /すべての候補を読み込んでください/);
  const selection = render({ selectionMode: true, selectedCount: 120 });
  assert.match(selection, /120件選択中/);
  assert.match(selection, /全選択/);
});

test('paged view distinguishes a filter with no matches from an empty collection', () => {
  const noMatches = render({ items: [], filteredItems: [], wishlist: [],
    paging: { totalCount: 500, matchedCount: 0, hasMore: false, moreLoading: false,
      moreError: false, notice: '', onMore: () => {} } });
  assert.match(noMatches, /条件に一致するアイテムがありません/);
  assert.match(noMatches, /条件をクリア/);
  assert.doesNotMatch(noMatches, /まだアイテムがありません/);
  assert.doesNotMatch(noMatches, /もっと見る/);
  const empty = render({ items: [], filteredItems: [], wishlist: [], totalAmount: 0,
    paging: { totalCount: 0, matchedCount: 0, hasMore: false, moreLoading: false,
      moreError: false, notice: '', onMore: () => {} } });
  assert.match(empty, /まだアイテムがありません/);
  assert.doesNotMatch(empty, /条件に一致するアイテムがありません/);
});

test('append errors preserve cards and expose a retry, with pending requests disabled', () => {
  const base = { totalCount: 500, matchedCount: 120, hasMore: true, moreLoading: false,
    moreError: true, notice: '', onMore: () => {} };
  const html = render({ paging: base });
  assert.match(html, /読み込み済み商品/);
  assert.match(html, /role="alert"[^>]*>追加読み込みに失敗しました/);
  assert.match(html, /追加読み込みを再試行/);
  assert.doesNotMatch(html, />読み込みに失敗しました</);
  const pending = render({ paging: { ...base, moreError: false, moreLoading: true } });
  assert.match(pending, /<button[^>]*disabled=""[^>]*>読み込み中\.\.\.<\/button>/);
  const reset = render({ paging: { ...base, moreError: false, notice: '一覧が変更されたため先頭から読み込み直しました。' } });
  assert.match(reset, /role="status"[^>]*>一覧が変更されたため/);
});

test('server pages are not sliced again at the legacy 50-item display boundary', () => {
  const loaded = Array.from({ length: 51 }, (_, i) => item({ id: i + 1, name: `ページ商品${String(i + 1).padStart(4, '0')}` }));
  const html = render({ items: loaded, filteredItems: loaded,
    wishlist: loaded.map(entry => ({ kind: 'item' as const, item: entry })),
    paging: { totalCount: 51, matchedCount: 51, hasMore: false, moreLoading: false,
      moreError: false, notice: '', onMore: () => {} } });
  assert.match(html, /ページ商品0051/);
  assert.doesNotMatch(html, /もっと見る/);
});

test('refresh does not replace existing cards with the initial loading screen', () => {
  assert.match(render({ loading: true }), /読み込み済み商品/);
  const initial = render({ loading: true, items: [], filteredItems: [], wishlist: [] });
  assert.doesNotMatch(initial, /読み込み済み商品/);
  assert.match(initial, /読み込み中/);
});


test('pending search keeps its previous rows visible but prevents stale item actions', () => {
  const html = render({ loading: true });
  assert.match(html, /読み込み済み商品/);
  assert.match(html, /前の結果を表示/);
  assert.match(html, /inert=""/);
  assert.match(html, /aria-busy="true"/);
});

test('drag loading hint is absent when sorting or filtering would still forbid dragging', () => {
  assert.doesNotMatch(render({ sortBy: 'price_asc' }), /ドラッグで順序を変えるには/);
  assert.doesNotMatch(render({ searchQuery: '商品' }), /ドラッグで順序を変えるには/);
});
