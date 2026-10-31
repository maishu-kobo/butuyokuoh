import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db } from './bugfix-harness';

const items = '../src/app/api/items/route.ts';
const item = '../src/app/api/items/[id]/route.ts';
const categories = '../src/app/api/categories/route.ts';
const category = '../src/app/api/categories/[id]/route.ts';
const groups = '../src/app/api/comparison-groups/route.ts';
const group = '../src/app/api/comparison-groups/[id]/route.ts';
const preview = '../src/app/api/items/preview/route.ts';
const extensionAdd = '../src/app/api/extension-add/route.ts';
const extensionImport = '../src/app/api/extension-import/route.ts';
const notify = '../src/app/api/notification-settings/route.ts';
const wishlist = '../src/app/api/import-wishlist/route.ts';

function codeOf(json: unknown) {
  return json && typeof json === 'object' && 'code' in json ? (json as { code?: string }).code : undefined;
}

test('member APIs reject invalid type, length, and range and keep valid writes', async () => {
  const owner = await createMember('member-input');
  const database = await db();
  const itemCount = () => (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(owner.id) as { n: number }).n;
  const categoryCount = () => (database.prepare('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').get(owner.id) as { n: number }).n;
  const groupCount = () => (database.prepare('SELECT COUNT(*) AS n FROM comparison_groups WHERE user_id = ?').get(owner.id) as { n: number }).n;

  const rejected = [
    { manual: true, name: 'x'.repeat(201), price: 100 },
    { manual: true, name: '   ', price: 100 },
    { manual: true, name: '負の価格', price: -1 },
    { manual: true, name: '高すぎ', price: 1_000_000_001 },
    { manual: true, name: '文字の価格', price: '100' },
    { manual: true, name: '優先度ゼロ', priority: 0 },
    { manual: true, name: '優先度六', priority: 6 },
    { manual: true, name: '優先度文字', priority: '3' },
    { manual: true, name: '個数', quantity: {} },
    { manual: true, name: '個数ゼロ', quantity: 0 },
    { manual: true, name: '個数超過', quantity: 1000 },
    { manual: true, name: 'メモ', notes: 'n'.repeat(2001) },
    { manual: true, name: '日付', planned_purchase_date: '2026/10/01' },
    { manual: true, name: '長い画像', image_url: 'https://example.test/' + 'a'.repeat(2048) },
    { manual: true, name: '長いURL', url: 'https://example.test/' + 'u'.repeat(2048) },
  ];
  for (const body of rejected) {
    const response = await call(items, 'POST', '/api/items', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(codeOf(response.json), 'INVALID_INPUT', JSON.stringify(body));
  }
  assert.equal(itemCount(), 0);

  const { NextRequest } = await import('next/server');
  const { POST } = await import('../src/app/api/items/route');
  for (const raw of ['[]', '{', 'null']) {
    const response = await POST(new NextRequest('http://127.0.0.1/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    }));
    assert.equal(response.status, 400, raw);
  }

  const huge = await call(items, 'POST', '/api/items', { manual: true, name: '大きい', notes: 'x'.repeat(17_000) });
  assert.equal(huge.status, 413);
  assert.equal(codeOf(huge.json), 'BODY_TOO_LARGE');
  assert.equal(itemCount(), 0);

  const created = await call(items, 'POST', '/api/items', {
    manual: true,
    name: 'x'.repeat(200),
    price: 0,
    priority: 5,
    quantity: 999,
    notes: 'n'.repeat(2000),
    planned_purchase_date: '2026-10-23',
    image_url: '/uploads/1_1.png',
    url: `https://example.test/${'u'.repeat(2027)}`,
    sort_order: 0,
  });
  assert.equal(created.status, 201, created.text);
  const saved = created.json as { id: number; name: string; quantity: number; priority: number; image_url: string; notes: string; url: string };
  assert.equal(saved.name.length, 200);
  assert.equal(saved.quantity, 999);
  assert.equal(saved.priority, 5);
  assert.equal(saved.image_url, '/uploads/1_1.png');
  assert.equal(saved.notes.length, 2000);
  assert.equal(saved.url.length, 2048);
  assert.equal(itemCount(), 1);

  const httpsImage = await call(item, 'PATCH', `/api/items/${saved.id}`, {
    image_url: 'https://example.test/item.png',
    current_price: 10,
  }, { id: String(saved.id) });
  assert.equal(httpsImage.status, 200, httpsImage.text);

  const clearedImage = await call(item, 'PATCH', `/api/items/${saved.id}`, { image_url: null }, { id: String(saved.id) });
  assert.equal(clearedImage.status, 200, clearedImage.text);

  for (const body of [{ current_price: -1 }, { url: null }, { quantity: 0 }, { priority: 9 }, { name: '' }]) {
    const response = await call(item, 'PATCH', `/api/items/${saved.id}`, body, { id: String(saved.id) });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(codeOf(response.json), 'INVALID_INPUT', JSON.stringify(body));
  }
  const stored = database.prepare('SELECT current_price, url, image_url, quantity, priority, name FROM items WHERE id = ?').get(saved.id) as {
    current_price: number; url: string; image_url: string | null; quantity: number; priority: number; name: string;
  };
  assert.equal(stored.current_price, 10);
  assert.equal(stored.url.length, 2048);
  assert.equal(stored.image_url, null);
  assert.equal(stored.quantity, 999);
  assert.equal(stored.priority, 5);
  assert.equal(stored.name.length, 200);

  for (const body of [
    { name: '棚', color: 'blue' },
    { name: 'c'.repeat(201), color: '#6b7280' },
    { name: '棚', color: '#6b7280', icon: 'i'.repeat(33) },
    { name: '棚', color: '#abc' },
  ]) {
    const response = await call(categories, 'POST', '/api/categories', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(codeOf(response.json), 'INVALID_INPUT', JSON.stringify(body));
  }
  assert.equal(categoryCount(), 0);
  const categoryOk = await call(categories, 'POST', '/api/categories', { name: '棚', color: '#6b7280', icon: 'i'.repeat(32) });
  assert.equal(categoryOk.status, 201, categoryOk.text);
  const categoryId = (categoryOk.json as { id: number }).id;
  const badColor = await call(category, 'PUT', `/api/categories/${categoryId}`, { color: 'red' }, { id: String(categoryId) });
  assert.equal(badColor.status, 400);
  assert.equal((database.prepare('SELECT color FROM categories WHERE id = ?').get(categoryId) as { color: string }).color, '#6b7280');

  for (const body of [{ name: '   ', priority: 3 }, { name: '椅子', priority: 0 }, { name: '椅子', priority: 6 }, { name: 'g'.repeat(201) }]) {
    const response = await call(groups, 'POST', '/api/comparison-groups', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(codeOf(response.json), 'INVALID_INPUT', JSON.stringify(body));
  }
  assert.equal(groupCount(), 0);
  const groupOk = await call(groups, 'POST', '/api/comparison-groups', { name: '椅子', priority: 5 });
  assert.equal(groupOk.status, 201, groupOk.text);
  const groupId = (groupOk.json as { id: number; priority: number }).id;
  assert.equal((groupOk.json as { priority: number }).priority, 5);
  const badPriority = await call(group, 'PUT', `/api/comparison-groups/${groupId}`, { priority: 0 }, { id: String(groupId) });
  assert.equal(badPriority.status, 400);
  assert.equal((database.prepare('SELECT priority FROM comparison_groups WHERE id = ?').get(groupId) as { priority: number }).priority, 5);
  assert.equal((await call(group, 'DELETE', `/api/comparison-groups/${groupId}`, undefined, { id: String(groupId) })).status, 200);
  assert.equal(groupCount(), 0);

  const javascriptPreview = await call(preview, 'POST', '/api/items/preview', { url: 'javascript:alert(1)' });
  assert.equal(javascriptPreview.status, 400);
  assert.equal((javascriptPreview.json as { error: string }).error, 'URLは http または https を指定してください');
  const filePreview = await call(preview, 'POST', '/api/items/preview', { url: 'file:///etc/passwd' });
  assert.equal(filePreview.status, 400);
  const malformedPreview = await call(preview, 'POST', '/api/items/preview', { url: 'not-a-url' });
  assert.equal(malformedPreview.status, 400);
  assert.equal((malformedPreview.json as { error: string }).error, '無効なURL形式です');

  const { generateToken } = await import('../src/lib/auth');
  const token = generateToken(owner as never);
  const port = await import('../src/lib/product-fetch-port');
  // 店への実接続を避け、取得失敗を即返す。
  port.installProductFetchPort({ lookup: () => undefined });
  try {
    // 価格・画像はサーバ取得のみなのでクライアント価格の不正は無視する。優先度の範囲外は従来どおり拒否。
    const extensionBadPriority = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: { name: '範囲', url: 'https://example.test/priority', price: 10, imageUrl: null, priority: 9, categoryId: null },
    });
    assert.equal(extensionBadPriority.status, 400);
    assert.equal(itemCount(), 1);
    const longName = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: { name: 'y'.repeat(201), url: 'https://example.test/long', price: 10, imageUrl: null, priority: 3, categoryId: null },
    });
    assert.equal(longName.status, 200, longName.text);
    assert.equal(
      (database.prepare('SELECT name FROM items WHERE url = ?').get('https://example.test/long') as { name: string }).name.length,
      200,
    );
    const extensionOk = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: { name: '拡張', url: 'https://example.test/extension', price: 100, imageUrl: 'https://example.test/ext.png', priority: 3, categoryId: null },
    });
    assert.equal(extensionOk.status, 200, extensionOk.text);
    const extensionRow = database.prepare('SELECT current_price, image_url FROM items WHERE url = ?').get('https://example.test/extension') as {
      current_price: number | null;
      image_url: string | null;
    };
    assert.equal(extensionRow.current_price, null);
    assert.equal(extensionRow.image_url, null);
  } finally {
    port.installProductFetchPort(null);
  }

  const imported = await call(extensionImport, 'POST', '/api/extension-import', {
    token,
    source: 'other',
    items: [
      { name: '高い', url: 'https://example.test/bad-price', price: -1, imageUrl: null },
      { name: 'z'.repeat(201), url: 'https://example.test/long-name', price: 10, imageUrl: null },
      { name: '残す', url: 'https://example.test/keep', price: 10, imageUrl: 'https://example.test/keep.png' },
    ],
  });
  assert.equal(imported.status, 200, imported.text);
  // 不正価格はスキップ。長い品名は 200 文字に切り詰めて取り込む。
  assert.equal((imported.json as { imported: number }).imported, 2);
  const urls = (database.prepare('SELECT url FROM items WHERE user_id = ? ORDER BY url').all(owner.id) as { url: string }[]).map((row) => row.url);
  assert.deepEqual(urls, [
    'https://example.test/extension',
    'https://example.test/keep',
    'https://example.test/long',
    'https://example.test/long-name',
    saved.url,
  ]);
  assert.equal(
    (database.prepare('SELECT name FROM items WHERE url = ?').get('https://example.test/long-name') as { name: string }).name.length,
    200,
  );

  const longHook = `https://hooks.slack.com/services/${'a'.repeat(2100)}`;
  const rejectedHook = await call(notify, 'PUT', '/api/notification-settings', { slack_webhook: longHook, notify_on_price_drop: false });
  assert.equal(rejectedHook.status, 400);
  assert.equal(codeOf(rejectedHook.json), 'INVALID_INPUT');
  const hookRow = database.prepare('SELECT slack_webhook FROM user_notification_settings WHERE user_id = ?').get(owner.id) as { slack_webhook: string | null } | undefined;
  assert.equal(hookRow?.slack_webhook ?? null, null);
  const savedHook = await call(notify, 'PUT', '/api/notification-settings', {
    slack_webhook: 'https://hooks.slack.com/services/T/B/X',
    discord_webhook: 'https://discord.com/api/webhooks/1/token',
    notify_on_price_drop: true,
    notify_on_target_price: false,
  });
  assert.equal(savedHook.status, 200, savedHook.text);

  const longList = `https://www.amazon.co.jp/hz/wishlist/ls/${'a'.repeat(2100)}`;
  const rejectedList = await call(wishlist, 'POST', '/api/import-wishlist', { url: longList });
  assert.equal(rejectedList.status, 400);
  assert.equal(codeOf(rejectedList.json), 'INVALID_INPUT');
});
