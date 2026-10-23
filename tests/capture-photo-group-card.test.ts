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

function photoMarkup(shopsOpen = false): string {
  return markup(createElement(PhotoGroupCard, {
    card: milkCard(),
    item: face(),
    onUpdate: () => {},
    shopsOpen,
  }));
}

function purchaseButton(html: string): string {
  const match = html.match(/<button\b[^>]*>購入済みにする<\/button>/);
  assert.ok(match, 'purchase button');
  return match[0];
}

const enabledPurchase = '<button class="text-sm px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200">購入済みにする</button>';

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
  assert.equal(purchaseButton(url), enabledPurchase);
});

test('two or more shops gray out the card purchase button and explain how to choose a shop', () => {
  const html = photoMarkup();
  const button = purchaseButton(html);
  assert.match(button, /aria-disabled="true"/);
  assert.doesNotMatch(button, /\sdisabled(?:=|\s|>)/);
  assert.match(button, /bg-gray-200/);
  assert.match(button, /text-gray-500/);
  assert.doesNotMatch(button, /bg-green-100/);
  const id = button.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(id);
  const tip = html.match(new RegExp(`<span\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
  assert.ok(tip, id);
  assert.match(tip[0], /role="tooltip"/);
  assert.match(tip[0], /group-hover:block/);
  assert.match(tip[0], /group-focus-within:block/);
  assert.match(html, /ショップが複数あります。ショップ一覧から購入したショップを選んで購入済みにしてください/);

  const one = markup(createElement(ItemCard, {
    item: face(),
    onUpdate: () => {},
    onDelete: () => {},
    shopCount: 1,
  }));
  assert.equal(purchaseButton(one), enabledPurchase);
  assert.equal(one.includes('ショップが複数あります'), false);
});

test('an opened shop list lets each unpurchased shop be marked purchased', () => {
  assert.equal(photoMarkup().includes('photo-shop-list'), false);
  const html = photoMarkup(true);
  const listAt = html.indexOf('data-testid="photo-shop-list"');
  const actionAt = html.indexOf(actionBar);
  assert.ok(listAt > 0 && actionAt > listAt);
  const list = html.slice(listAt, actionAt);
  assert.match(list, /牛乳A/);
  assert.match(list, /牛乳B/);
  assert.match(list, /牛乳C/);
  assert.equal(list.match(/<button\b[^>]*>購入済みにする<\/button>/g)?.length, 2);
  const bought = list.slice(list.indexOf('牛乳C'), list.indexOf('牛乳A'));
  assert.match(bought, />購入済み</);
  assert.equal(bought.includes('購入済みにする'), false);
});
