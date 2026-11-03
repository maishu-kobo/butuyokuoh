import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthContext } from '../src/components/AuthProvider';
import ItemCard from '../src/components/ItemCard';
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

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    name: 'Rokid スマートグラス',
    url: 'https://www.amazon.co.jp/dp/EXAMPLE',
    image_url: 'https://m.media-amazon.com/images/I/example.jpg',
    current_price: null,
    original_price: null,
    source: 'amazon',
    source_name: 'Amazon',
    priority: 3,
    planned_purchase_date: '2026-11-28',
    comparison_group_id: null,
    category_id: null,
    notes: '今作ってるいやつ',
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

function card(overrides: Partial<Item> = {}): string {
  return markup(createElement(ItemCard, {
    item: item(overrides),
    onUpdate: () => {},
    onDelete: () => {},
  }));
}

const actionBar = 'bg-gray-50 dark:bg-slate-700 flex items-center justify-between border-t';
const productHref = 'https://www.amazon.co.jp/dp/EXAMPLE';

function productAnchors(html: string): string[] {
  const matches = html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g);
  return [...matches]
    .filter((match) => match[1] === productHref)
    .map((match) => match[0]);
}

test('http product url makes image, title, and store button open the page in a new tab', () => {
  const html = card();
  const anchors = productAnchors(html);
  assert.ok(anchors.length >= 3, `expected image, title, and store links, got ${anchors.length}`);
  for (const anchor of anchors) {
    assert.match(anchor, /target="_blank"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
  }

  assert.match(html, new RegExp(`<a\\b[^>]*href="${productHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>[\\s\\S]*?<img\\b`));
  assert.match(html, />Amazonで開く</);
  assert.match(html, /min-h-\[44px\]/);

  const actionAt = html.indexOf(actionBar);
  assert.ok(actionAt > 0, 'action bar');
  const openAt = html.indexOf('>Amazonで開く<');
  assert.ok(openAt > 0 && openAt < actionAt, 'store open control stays above the action bar');
  const actionHtml = html.slice(actionAt);
  assert.equal(actionHtml.includes('Amazonで開く'), false);
  const actionHrefs = [...actionHtml.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assert.equal(actionHrefs.some((href) => href === productHref), false);
});

test('items without a linkable url do not expose product-page anchors', () => {
  for (const url of ['manual://memo', 'javascript:alert(1)', '', null]) {
    const html = card({
      id: 2,
      name: 'URLなしのペン',
      url: url as string,
      image_url: null,
      source: 'other',
      source_name: null,
    });
    assert.equal(html.includes('target="_blank"'), false, String(url));
    assert.equal(html.includes('で開く'), false, String(url));
    assert.match(html, /<h3\b[^>]*>URLなしのペン<\/h3>/);
  }
});

test('store open label follows the item source name', () => {
  assert.match(card({ source: 'rakuten', source_name: '楽天' }), />楽天で開く</);
  assert.match(
    card({
      source: 'yahoo',
      source_name: 'Yahoo!ショッピング',
      url: 'https://store.shopping.yahoo.co.jp/shop/a',
    }),
    />Yahoo!ショッピングで開く</,
  );
  assert.match(
    card({
      source: 'other',
      source_name: 'Apple',
      url: 'https://www.apple.com/shop/buy-mac',
    }),
    />Appleで開く</,
  );
  assert.match(
    card({
      source: 'other',
      source_name: null,
      url: 'https://example.com/item',
    }),
    />商品ページを開く</,
  );
});
