import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db, useUser } from './regression-harness';

const budget = '../src/app/api/budget/route.ts';
const stats = '../src/app/api/stats/route.ts';
const exportRoute = '../src/app/api/export/route.ts';

test('budget totals use price times quantity and split dated and undated items', async () => {
  const owner = await createMember('budget');
  const other = await createMember('budget-other');
  const database = await db();
  const add = (userId: number, name: string, price: number | null, quantity: number, date: string | null, flags: { purchased?: number; deleted?: boolean } = {}) => {
    database.prepare(`
      INSERT INTO items (user_id, name, url, current_price, quantity, planned_purchase_date, is_purchased, deleted_at, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3)
    `).run(userId, name, `manual://${userId}-${name}`, price, quantity, date, flags.purchased ?? 0, flags.deleted ? '2026-01-01 00:00:00' : null);
  };
  add(owner.id, 'keyboard', 1000, 2, '2026-10-01');
  add(owner.id, 'unknown', null, 1, '2026-10-20');
  add(owner.id, 'mouse', 500, 1, '2026-11-15');
  add(owner.id, 'someday', 300, 4, null);
  add(owner.id, 'blank-date', 50, 1, '');
  add(owner.id, 'bought', 9000, 2, '2026-10-02', { purchased: 1 });
  add(owner.id, 'trashed', 8000, 2, '2026-10-03', { deleted: true });
  add(other.id, 'theirs', 7000, 2, '2026-10-04');

  await useUser(owner);
  const response = await call(budget, 'GET', '/api/budget');
  assert.equal(response.status, 200);
  const body = response.json as Record<string, { total: number; items: { name: string }[] }>;
  assert.equal(body['2026-10'].total, 2000);
  assert.deepEqual(body['2026-10'].items.map((item) => item.name), ['keyboard', 'unknown']);
  assert.equal(body['2026-11'].total, 500);
  assert.equal(body.undated.total, 1250);
  assert.deepEqual(body.undated.items.map((item) => item.name).sort(), ['blank-date', 'someday']);
  assert.equal(body['2026-10'].items.some((item) => item.name === 'bought' || item.name === 'trashed' || item.name === 'theirs'), false);
});

test('stats counts exclude trash and keep a quantity of one in the money total', async () => {
  const owner = await createMember('stats');
  const database = await db();
  database.prepare(`
    INSERT INTO categories (user_id, name, color) VALUES (?, '本', '#112233')
  `).run(owner.id);
  const categoryId = (database.prepare('SELECT id FROM categories WHERE user_id = ?').get(owner.id) as { id: number }).id;
  const add = (name: string, price: number | null, flags: { purchased?: number; deleted?: boolean; source?: string; priority?: number; purchasedAt?: string; category?: boolean }) => {
    database.prepare(`
      INSERT INTO items (user_id, name, url, current_price, quantity, is_purchased, deleted_at, source, priority, purchased_at, category_id)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      owner.id, name, `manual://${name}`, price, flags.purchased ?? 0, flags.deleted ? '2026-01-01 00:00:00' : null,
      flags.source ?? 'other', flags.priority ?? 3, flags.purchasedAt ?? null, flags.category ? categoryId : null,
    );
  };
  add('wish-book', 1200, { category: true, priority: 1, source: 'amazon' });
  add('wish-other', 400, { source: 'rakuten', priority: 3 });
  add('no-price', null, {});
  add('bought', 3000, { purchased: 1, purchasedAt: '2026-09-02' });
  add('trashed', 9999, { deleted: true });

  await useUser(owner);
  const response = await call(stats, 'GET', '/api/stats');
  assert.equal(response.status, 200);
  const body = response.json as {
    overview: { wishlistCount: number; purchasedCount: number; wishlistTotal: number; purchasedTotal: number };
    byCategory: { category_name: string; count: number; total: number }[];
    byPriority: { priority: number; count: number; total: number }[];
    bySource: { source: string; count: number; total: number }[];
    monthlyPurchased: { month: string; count: number; total: number }[];
    priceRanges: { range: string; count: number }[];
  };
  assert.equal(body.overview.wishlistCount, 3);
  assert.equal(body.overview.purchasedCount, 1);
  assert.equal(body.overview.wishlistTotal, 1600);
  assert.equal(body.overview.purchasedTotal, 3000);
  assert.equal(body.byCategory.find((row) => row.category_name === '本')?.count, 1);
  assert.equal(body.byCategory.find((row) => row.category_name === '本')?.total, 1200);
  assert.equal(body.byPriority.find((row) => row.priority === 1)?.total, 1200);
  assert.equal(body.bySource.find((row) => row.source === 'amazon')?.count, 1);
  assert.deepEqual(body.monthlyPurchased, [{ month: '2026-09', count: 1, total: 3000 }]);
  assert.equal(body.priceRanges.find((row) => row.range === '¥1,000~¥5,000')?.count, 1);
  assert.equal(JSON.stringify(body).includes('9999'), false);
});

test('export writes a BOM csv for the requested set and escapes commas, quotes, and newlines', async () => {
  const owner = await createMember('export');
  const other = await createMember('export-other');
  const database = await db();
  database.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(owner.id, '本');
  const categoryId = (database.prepare('SELECT id FROM categories WHERE user_id = ?').get(owner.id) as { id: number }).id;
  database.prepare(`
    INSERT INTO items (
      user_id, name, url, current_price, target_price, target_currency, category_id, priority,
      planned_purchase_date, notes, is_purchased, purchased_at, deleted_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    owner.id, '本, "限定"', 'https://example.test/book', 1500, 1000, 'JPY', categoryId, 1,
    '2026-12-01', '一行目\n二行目', 0, null, null, '2026-10-02 00:00:00',
  );
  database.prepare(`
    INSERT INTO items (user_id, name, url, current_price, is_purchased, purchased_at, created_at)
    VALUES (?, '買った', 'manual://bought', 200, 1, '2026-08-01', '2026-10-03 00:00:00')
  `).run(owner.id);
  database.prepare(`
    INSERT INTO items (user_id, name, url, current_price, deleted_at) VALUES (?, 'ゴミ箱', 'manual://gone', 9, '2026-01-01 00:00:00')
  `).run(owner.id);
  database.prepare(`
    INSERT INTO items (user_id, name, url, current_price) VALUES (?, '他人', 'manual://other', 8)
  `).run(other.id);

  await useUser(owner);
  const wishlist = await call(exportRoute, 'GET', '/api/export?filter=wishlist');
  assert.equal(wishlist.status, 200);
  assert.match(wishlist.headers.get('content-type') || '', /text\/csv/);
  assert.match(wishlist.headers.get('content-disposition') || '', /butuyokuoh_wishlist_/);
  assert.deepEqual(Array.from(wishlist.bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(wishlist.bytes).replace(/^\uFEFF/, '');
  assert.match(csv.split('\n')[0], /^商品名,URL,現在価格/);
  assert.match(csv, /"本, ""限定"""/);
  assert.match(csv, /"一行目\n二行目"/);
  assert.match(csv, /,最高,/);
  assert.match(csv, /本/);
  assert.equal(csv.includes('買った'), false);
  assert.equal(csv.includes('ゴミ箱'), false);
  assert.equal(csv.includes('他人'), false);

  const purchasedOnly = await call(exportRoute, 'GET', '/api/export?filter=purchased');
  assert.match(purchasedOnly.text, /買った/);
  assert.equal(purchasedOnly.text.includes('本, '), false);
  assert.match(purchasedOnly.text, /購入済み/);

  const all = await call(exportRoute, 'GET', '/api/export?filter=all');
  assert.match(all.text, /未購入/);
  assert.match(all.text, /購入済み/);
  assert.equal(all.text.includes('ゴミ箱'), false);
});
