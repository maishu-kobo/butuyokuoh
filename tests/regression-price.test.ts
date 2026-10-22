import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db, useUser } from './regression-harness';
import { deriveScrapeOutcome } from '../src/lib/scraper';
import { priceCheckItems, priceDropNotification, recordPriceIfChanged } from '../src/lib/price-check-items';
import { isAllowedWebhookUrl, sanitizeGenericUrl, validateAndSanitizeUrl } from '../src/lib/url-validator';
import type { Item } from '../src/types';

const notify = '../src/app/api/notification-settings/route.ts';
const extensionAdd = '../src/app/api/extension-add/route.ts';
const extensionImport = '../src/app/api/extension-import/route.ts';
const extensionCategories = '../src/app/api/extension-categories/route.ts';

test('price checks skip guests, purchases, and trash, and manual urls stay selected', async () => {
  const member = await createMember('prices');
  const database = await db();
  const guestId = Number(database.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('price-guest@guest.invalid', 'ゲスト', 'guest')",
  ).run().lastInsertRowid);
  const add = (userId: number, name: string, url: string, flags: { purchased?: number; deleted?: boolean } = {}) => Number(database.prepare(
    'INSERT INTO items (user_id, name, url, is_purchased, deleted_at, current_price) VALUES (?, ?, ?, ?, ?, 100)',
  ).run(userId, name, url, flags.purchased ?? 0, flags.deleted ? '2026-01-01 00:00:00' : null).lastInsertRowid);
  const active = add(member.id, 'active', 'https://example.test/active');
  const manual = add(member.id, 'manual', 'manual://still-checked');
  add(member.id, 'bought', 'https://example.test/bought', { purchased: 1 });
  add(member.id, 'gone', 'https://example.test/gone', { deleted: true });
  add(guestId, 'guest', 'https://example.test/guest');

  const ids = (priceCheckItems(database) as { id: number }[]).map((row) => row.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [active, manual].sort((a, b) => a - b));
});

test('a repeated price is not stored again, and the newest row wins when the timestamp ties', () => {
  return db().then((database) => createMember('history').then((member) => {
    const itemId = Number(database.prepare(
      'INSERT INTO items (user_id, name, url) VALUES (?, ?, ?)',
    ).run(member.id, 'history', 'manual://history').lastInsertRowid);
    assert.equal(recordPriceIfChanged(database, itemId, 100), true);
    assert.equal(recordPriceIfChanged(database, itemId, 100), false);
    database.prepare("UPDATE price_history SET recorded_at = '2026-09-01 00:00:00' WHERE item_id = ?").run(itemId);
    database.prepare("INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, 80, '2026-10-01 00:00:00')").run(itemId);
    database.prepare("INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, 90, '2026-10-01 00:00:00')").run(itemId);
    const before = (database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(itemId) as { n: number }).n;
    assert.equal(recordPriceIfChanged(database, itemId, 90), false);
    assert.equal(recordPriceIfChanged(database, itemId, 80), true);
    const after = (database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(itemId) as { n: number }).n;
    assert.equal(after, before + 1);
  }));
});

test('a price that reaches the target keeps the target_reached type when only price-drop alerts are on', () => {
  const both = { notify_on_price_drop: 1, notify_on_target_price: 1 };
  const dropOnly = { notify_on_price_drop: 1, notify_on_target_price: 0 };
  const targetOnly = { notify_on_price_drop: 0, notify_on_target_price: 1 };
  const off = { notify_on_price_drop: 0, notify_on_target_price: 0 };
  assert.equal(priceDropNotification(1000, 700, 800, both), 'target_reached');
  assert.equal(priceDropNotification(1000, 900, 800, both), 'price_drop');
  // 目標に届いた payload の type は、目標通知がオフでも値下げ通知で送るとき target_reached のまま。
  assert.equal(priceDropNotification(1000, 700, 800, dropOnly), 'target_reached');
  assert.equal(priceDropNotification(1000, 700, 800, targetOnly), 'target_reached');
  assert.equal(priceDropNotification(1000, 900, 800, targetOnly), null);
  assert.equal(priceDropNotification(1000, 700, 800, off), null);
  assert.equal(priceDropNotification(1000, 1000, 800, both), null);
  assert.equal(priceDropNotification(1000, 1200, 800, both), null);
  assert.equal(priceDropNotification(null, 700, 800, both), null);
  assert.equal(priceDropNotification(0, 700, 800, both), null);
  assert.equal(priceDropNotification(1000, 700, null, both), 'price_drop');
  assert.equal(priceDropNotification(1000, 700, 0, both), 'price_drop');
  assert.equal(priceDropNotification(1000, 700, 800, undefined), null);
});

test('scrape outcome treats a missing or zero price as failure', () => {
  assert.deepEqual(deriveScrapeOutcome({ name: 'a', price: 100, imageUrl: null, source: 'other', sourceName: null }), { status: 'success', error: null });
  assert.deepEqual(deriveScrapeOutcome({ name: 'a', price: null, imageUrl: null, source: 'other', sourceName: null, note: '取れない' }), { status: 'failed', error: '取れない' });
  assert.deepEqual(deriveScrapeOutcome({ name: 'a', price: null, imageUrl: null, source: 'other', sourceName: null }), { status: 'failed', error: 'price not found' });
  assert.deepEqual(deriveScrapeOutcome({ name: 'a', price: 0, imageUrl: null, source: 'other', sourceName: null }), { status: 'failed', error: 'price not found' });
});

test('webhook and product url checks keep the current allow list', () => {
  assert.equal(isAllowedWebhookUrl('https://hooks.slack.com/services/T/B/X', 'slack'), true);
  assert.equal(isAllowedWebhookUrl('https://discord.com/api/webhooks/1/x', 'discord'), true);
  assert.equal(isAllowedWebhookUrl('https://discordapp.com/api/webhooks/1/x', 'discord'), true);
  assert.equal(isAllowedWebhookUrl('http://hooks.slack.com/services/T/B/X', 'slack'), false);
  assert.equal(isAllowedWebhookUrl('https://hooks.slack.com.evil.com/services/x', 'slack'), false);
  assert.equal(isAllowedWebhookUrl('https://example.com/hook', 'discord'), false);
  assert.equal(isAllowedWebhookUrl('not a url', 'slack'), false);

  assert.equal(validateAndSanitizeUrl('https://www.amazon.co.jp/dp/A').isValid, true);
  assert.equal(validateAndSanitizeUrl('https://www.amazon.co.jp/dp/A').source, 'amazon');
  assert.equal(validateAndSanitizeUrl('https://item.rakuten.co.jp/shop/item').source, 'rakuten');
  assert.equal(validateAndSanitizeUrl('http://www.amazon.co.jp/dp/A').isValid, false);
  assert.equal(validateAndSanitizeUrl('https://www.amazon.co.jp.evil.com/dp/A').isValid, false);

  assert.equal(sanitizeGenericUrl('https://example.com/item').isValid, true);
  for (const blocked of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.0.1/', 'http://172.16.0.1/', 'http://printer.local/', 'javascript:alert(1)']) {
    assert.equal(sanitizeGenericUrl(blocked).isValid, false, blocked);
  }
});

test('notification settings reject other hosts and do not call the network', async () => {
  await createMember('notify');
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('no', { status: 500 });
  }) as typeof fetch;
  try {
    const created = await call(notify, 'GET', '/api/notification-settings');
    assert.equal(created.status, 200);
    assert.equal((created.json as { notify_on_price_drop: number }).notify_on_price_drop, 1);

    assert.equal((await call(notify, 'PUT', '/api/notification-settings', { slack_webhook: 'http://127.0.0.1/hook' })).status, 400);
    assert.equal((await call(notify, 'PUT', '/api/notification-settings', { discord_webhook: 'https://hooks.slack.com/services/x' })).status, 400);
    const saved = await call(notify, 'PUT', '/api/notification-settings', {
      slack_webhook: 'https://hooks.slack.com/services/T/B/X',
      discord_webhook: 'https://discord.com/api/webhooks/1/token',
      notify_on_price_drop: false,
      notify_on_target_price: true,
    });
    assert.equal(saved.status, 200);
    const body = saved.json as { slack_webhook: string; discord_webhook: string; notify_on_price_drop: number; notify_on_target_price: number };
    assert.equal(body.slack_webhook, 'https://hooks.slack.com/services/T/B/X');
    assert.equal(body.notify_on_price_drop, 0);
    assert.equal(body.notify_on_target_price, 1);
    assert.equal(calls.length, 0);

    const cleared = await call(notify, 'PUT', '/api/notification-settings', { slack_webhook: '', discord_webhook: '' });
    assert.equal(cleared.status, 200);
    assert.equal((cleared.json as { slack_webhook: string | null }).slack_webhook, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('slack and discord sends skip guests and disallowed urls without fetching', async () => {
  const member = await createMember('sender');
  const database = await db();
  const guestId = Number(database.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('sender-guest@guest.invalid', 'ゲスト', 'guest')",
  ).run().lastInsertRowid);
  const memberItem = Number(database.prepare('INSERT INTO items (user_id, name, url) VALUES (?, ?, ?)').run(member.id, '会員品', 'https://example.test/member').lastInsertRowid);
  const guestItem = Number(database.prepare('INSERT INTO items (user_id, name, url) VALUES (?, ?, ?)').run(guestId, 'ゲスト品', 'https://example.test/guest').lastInsertRowid);
  const { sendDiscordNotification, sendSlackNotification } = await import('../src/lib/notifier');
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  const payload = (id: number) => ({
    item: { id, name: '品', url: 'https://example.test/p', image_url: null } as Item,
    oldPrice: 1000,
    newPrice: 800,
    type: 'price_drop' as const,
  });
  try {
    assert.equal(await sendSlackNotification('https://hooks.slack.com/services/T/B/X', payload(guestItem)), false);
    assert.equal(await sendSlackNotification('http://127.0.0.1/hook', payload(memberItem)), false);
    assert.equal(await sendDiscordNotification('https://example.com/hook', payload(memberItem)), false);
    assert.equal(calls.length, 0);
    assert.equal(await sendSlackNotification('https://hooks.slack.com/services/T/B/X', payload(memberItem)), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/hooks\.slack\.com\//);
    globalThis.fetch = (async () => new Response('no', { status: 500 })) as typeof fetch;
    assert.equal(await sendDiscordNotification('https://discord.com/api/webhooks/1/x', payload(memberItem)), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('extension add and import keep ownership, source, and an already active url', async () => {
  const member = await createMember('extension');
  const other = await createMember('extension-other');
  await useUser(other);
  const foreignCategory = await call('../src/app/api/categories/route.ts', 'POST', '/api/categories', { name: '他人の棚' });
  await useUser(member);
  const ownCategory = await call('../src/app/api/categories/route.ts', 'POST', '/api/categories', { name: '自分の棚' });
  const { generateToken } = await import('../src/lib/auth');
  const token = generateToken(member as never);
  const database = await db();

  assert.equal((await call(extensionAdd, 'POST', '/api/extension-add', { item: { name: 'x', url: 'https://example.test/x' } })).status, 401);
  assert.equal((await call(extensionAdd, 'POST', '/api/extension-add', { token: 'nope', item: { name: 'x', url: 'https://example.test/x' } })).status, 401);

  const amazon = await call(extensionAdd, 'POST', '/api/extension-add', {
    token,
    item: {
      name: '本', url: 'https://www.amazon.co.jp/dp/ABCDEFGHIJ', price: 1200, imageUrl: null, priority: 2,
      categoryId: String((ownCategory.json as { id: number }).id),
    },
  });
  assert.equal(amazon.status, 200);
  const amazonId = (amazon.json as { id: number }).id;
  const stored = database.prepare('SELECT source, source_name, current_price, category_id, priority FROM items WHERE id = ?').get(amazonId) as {
    source: string; source_name: string; current_price: number; category_id: number; priority: number;
  };
  assert.equal(stored.source, 'amazon');
  assert.equal(stored.source_name, 'Amazon');
  assert.equal(stored.current_price, 1200);
  assert.equal(stored.category_id, (ownCategory.json as { id: number }).id);
  assert.equal(stored.priority, 2);
  assert.equal((database.prepare('SELECT price FROM price_history WHERE item_id = ?').get(amazonId) as { price: number }).price, 1200);

  const again = await call(extensionAdd, 'POST', '/api/extension-add', {
    token, item: { name: '本', url: 'https://www.amazon.co.jp/dp/ABCDEFGHIJ', price: 1, imageUrl: null, priority: 3, categoryId: null },
  });
  assert.equal(again.status, 409);

  const crossed = await call(extensionAdd, 'POST', '/api/extension-add', {
    token,
    item: {
      name: '越境', url: 'https://item.rakuten.co.jp/shop/item', price: 10, imageUrl: null, priority: 3,
      categoryId: String((foreignCategory.json as { id: number }).id),
    },
  });
  assert.equal(crossed.status, 400);

  const rakuten = await call(extensionAdd, 'POST', '/api/extension-add', {
    token, item: { name: '楽天', url: 'https://item.rakuten.co.jp/shop/item', price: null, imageUrl: null, priority: 3, categoryId: null },
  });
  assert.equal(rakuten.status, 200);
  assert.equal((database.prepare('SELECT source_name FROM items WHERE id = ?').get((rakuten.json as { id: number }).id) as { source_name: string }).source_name, '楽天市場');

  database.prepare("UPDATE items SET deleted_at = datetime('now') WHERE id = ?").run(amazonId);
  const imported = await call(extensionImport, 'POST', '/api/extension-import', {
    token,
    source: 'amazon',
    items: [
      { name: '本', url: 'https://www.amazon.co.jp/dp/ABCDEFGHIJ', price: 1, imageUrl: null },
      { name: '新しい', url: 'https://example.test/new', price: 50, imageUrl: null },
    ],
  });
  assert.equal(imported.status, 200);
  const importedBody = imported.json as { imported: number; skipped: number };
  assert.equal(importedBody.imported, 1);
  assert.equal(importedBody.skipped, 1);
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM items WHERE url = ?').get('https://www.amazon.co.jp/dp/ABCDEFGHIJ') as { n: number }).n, 1);

  assert.equal((await call(extensionCategories, 'GET', '/api/extension-categories')).status, 401);
  const { NextRequest } = await import('next/server');
  const { GET } = await import('../src/app/api/extension-categories/route');
  const response = await GET(new NextRequest('http://127.0.0.1/api/extension-categories', { headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(response.status, 200);
  const names = (await response.json() as { name: string }[]).map((row) => row.name);
  assert.deepEqual(names, ['自分の棚']);
});
