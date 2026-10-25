import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactNode } from 'react';
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

test('an empty wishlist still shows the count, total, and the empty message', () => {
  const html = markup(createElement(HomeListView, {
    ...quiet,
    items: [],
    filteredItems: [],
    wishlist: [],
    totalAmount: 0,
    loading: false,
    loadError: false,
  }));
  assert.match(html, /0<span[^>]*>件<\/span>/);
  assert.match(html, /¥0/);
  assert.match(html, /まだアイテムがありません。上のフォームから追加してください。/);
  assert.match(html, /検索・フィルター/);
  assert.match(html, /インポートはログイン後に利用できます/);
  assert.doesNotMatch(html, /適用中/);
});

test('a filtered-out wishlist offers the same clear action', () => {
  const html = markup(createElement(HomeListView, {
    ...quiet,
    items: [item({ id: 1, name: 'ペン' })],
    filteredItems: [],
    wishlist: [],
    totalAmount: 1200,
    loading: false,
    loadError: false,
    searchQuery: 'ない',
    isFilterOpen: true,
  }));
  assert.match(html, /条件に一致するアイテムがありません/);
  assert.match(html, /条件をクリア/);
  assert.match(html, /適用中/);
  assert.ok(html.includes(`¥${(1200).toLocaleString()}`));
  assert.match(html, /ほしいものリスト \(0件/);
});

test('a failed load still offers retry instead of the empty list', () => {
  const html = markup(createElement(HomeListView, {
    ...quiet,
    items: [],
    filteredItems: [],
    wishlist: [],
    totalAmount: 0,
    loading: false,
    loadError: true,
  }));
  assert.match(html, /読み込みに失敗しました/);
  assert.match(html, /再試行/);
  assert.doesNotMatch(html, /まだアイテムがありません/);
});
