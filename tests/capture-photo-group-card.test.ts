import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthContext } from '../src/components/AuthProvider';
import ItemCard from '../src/components/ItemCard';
import PhotoGroupCard from '../src/components/PhotoGroupCard';
import type { WishlistRow } from '../src/lib/capture/list-card';
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

function face(overrides: Partial<Item> = {}): Item {
  return {
    id: 10,
    name: '牛乳A',
    url: 'https://store.shopping.yahoo.co.jp/shop/a',
    image_url: null,
    current_price: 800,
    original_price: null,
    source: 'yahoo',
    source_name: 'Yahoo!ショッピング',
    priority: 3,
    planned_purchase_date: null,
    comparison_group_id: 7,
    category_id: null,
    notes: null,
    is_purchased: false,
    purchased_at: null,
    target_price: null,
    target_currency: null,
    quantity: 1,
    deleted_at: null,
    created_at: '2026-10-22 00:00:00',
    updated_at: '2026-10-22 00:00:00',
    ...overrides,
  };
}

function milkCard(): Extract<WishlistRow, { kind: 'photo' }> {
  return {
    kind: 'photo',
    groupId: 7,
    name: '牛乳',
    minPrice: 500,
    maxPrice: 1200,
    rangeText: '¥500〜¥1,200',
    itemIds: [10, 11],
    shops: [
      {
        itemId: 12,
        name: '牛乳C',
        site: '楽天',
        shopName: '楽天',
        price: 500,
        fetchedAt: '2026-10-22 01:02:03',
        url: 'https://item.rakuten.co.jp/shop/c',
        purchased: true,
      },
      {
        itemId: 10,
        name: '牛乳A',
        site: 'Yahoo!ショッピング',
        shopName: 'Yahoo!ショッピング',
        price: 800,
        fetchedAt: '2026-10-22 01:02:03',
        url: 'https://store.shopping.yahoo.co.jp/shop/a',
        purchased: false,
      },
      {
        itemId: 11,
        name: '牛乳B',
        site: '楽天',
        shopName: '楽天市場の店',
        price: 1200,
        fetchedAt: null,
        url: 'https://item.rakuten.co.jp/shop/b',
        purchased: false,
      },
    ],
  };
}

function photoMarkup(): string {
  return markup(createElement(PhotoGroupCard, {
    card: milkCard(),
    item: face(),
    onUpdate: () => {},
  }));
}

function urlMarkup(item: Item = face({
  id: 1,
  name: '手入力ペン',
  url: 'manual://pen',
  source: 'other',
  source_name: null,
  current_price: 400,
  comparison_group_id: null,
})): string {
  return markup(createElement(ItemCard, {
    item,
    onUpdate: () => {},
    onDelete: () => {},
  }));
}

const actionBar = 'bg-gray-50 dark:bg-slate-700 flex items-center justify-between border-t';

test('a closed photo group keeps shop facts in the info area, on the same card as a url item', () => {
  const html = photoMarkup();
  const actionAt = html.indexOf(actionBar);
  const summaryAt = html.indexOf('data-testid="photo-group-low"');
  assert.ok(actionAt > 0, 'action bar');
  assert.ok(summaryAt > 0, 'lowest price');
  assert.ok(summaryAt < actionAt, 'lowest price sits above the action bar');
  assert.ok(html.indexOf('data-testid="photo-group-range"') < actionAt);
  assert.ok(html.indexOf('>3件<') < actionAt);
  assert.ok(html.indexOf('ショップを見る') < actionAt);

  const below = html.slice(actionAt);
  assert.equal(below.includes('photo-group-low'), false);
  assert.equal(below.includes('photo-group-range'), false);
  assert.equal(below.includes('ショップを見る'), false);
  assert.equal(below.includes('最安'), false);

  assert.match(html, /data-testid="photo-group-low"[^>]*>最安 ¥500</);
  assert.match(html, /data-testid="photo-group-range"[^>]*>¥500〜¥1,200</);
  assert.match(html, /aria-label="牛乳のショップを見る"/);
  assert.equal(html.includes('牛乳A'), false);
  assert.equal(html.includes('牛乳B'), false);
  assert.equal(html.includes('牛乳C'), false);
  assert.equal(html.includes('商品ページ'), false);

  const url = urlMarkup();
  assert.equal(url.includes('photo-group-low'), false);
  assert.equal(url.includes('ショップを見る'), false);
  assert.ok(url.includes(actionBar));
  assert.match(url, /<button[^>]*>購入済みにする<\/button>/);
});
