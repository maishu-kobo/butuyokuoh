import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeFilterPanel from '../src/components/home/HomeFilterPanel';
import HomeTabNav from '../src/components/home/HomeTabNav';

const props = {
  isOpen: false, onToggle() {}, searchQuery: '', onSearchQuery() {},
  sortBy: 'priority' as const, onSortBy() {}, selectedPriority: null, onSelectedPriority() {},
  categories: [], selectedCategory: null, onSelectedCategory() {},
  groups: [], selectedGroup: null, onSelectedGroup() {},
};

test('closed filters retain a named search field and sort control', () => {
  const html = renderToStaticMarkup(createElement(HomeFilterPanel, props));
  assert.match(html, /type="search"/);
  assert.match(html, /商品名、メモ、カテゴリで検索/);
  assert.match(html, /並び順/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+"/);
});

test('filter changes are exposed without relying on category color', () => {
  const html = renderToStaticMarkup(createElement(HomeFilterPanel, {
    ...props, isOpen: true, selectedPriority: 3,
  }));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /適用中/);
});

test('navigation reports exactly one active destination', () => {
  const html = renderToStaticMarkup(createElement(HomeTabNav, {
    activeTab: 'budget', onChange() {}, onOpenList() {},
  }));
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 4);
  assert.match(html, /aria-label="物欲王の画面"/);
});

