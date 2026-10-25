import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db } from './bugfix-harness';

test('stats money totals multiply price by quantity', async () => {
  const owner = await createMember('stats');
  const database = await db();
  database.prepare("INSERT INTO categories (user_id, name) VALUES (?, '本')").run(owner.id);
  const categoryId = (database.prepare('SELECT id FROM categories WHERE user_id = ?').get(owner.id) as { id: number }).id;
  database.prepare(`
    INSERT INTO items (user_id, name, url, current_price, quantity, category_id, priority, source, is_purchased, purchased_at)
    VALUES (?, '本', 'manual://book', 1000, 2, ?, 1, 'amazon', 0, NULL)
  `).run(owner.id, categoryId);
  database.prepare(`
    INSERT INTO items (user_id, name, url, current_price, quantity, is_purchased, purchased_at, source)
    VALUES (?, '買った', 'manual://bought', 400, 3, 1, '2026-09-02', 'other')
  `).run(owner.id);
  database.prepare(`
    INSERT INTO items (user_id, name, url, current_price, quantity, deleted_at)
    VALUES (?, 'ゴミ箱', 'manual://gone', 999, 4, '2026-01-01 00:00:00')
  `).run(owner.id);

  const response = await call('../src/app/api/stats/route.ts', 'GET', '/api/stats');
  assert.equal(response.status, 200);
  const body = response.json as {
    overview: { wishlistCount: number; purchasedCount: number; wishlistTotal: number; purchasedTotal: number };
    byCategory: { category_name: string; total: number }[];
    byPriority: { priority: number; total: number }[];
    bySource: { source: string; total: number }[];
    monthlyPurchased: { month: string; total: number }[];
  };
  assert.equal(body.overview.wishlistCount, 1);
  assert.equal(body.overview.purchasedCount, 1);
  assert.equal(body.overview.wishlistTotal, 2000);
  assert.equal(body.overview.purchasedTotal, 1200);
  assert.equal(body.byCategory.find((row) => row.category_name === '本')?.total, 2000);
  assert.equal(body.byPriority.find((row) => row.priority === 1)?.total, 2000);
  assert.equal(body.bySource.find((row) => row.source === 'amazon')?.total, 2000);
  assert.equal(body.monthlyPurchased[0]?.total, 1200);
  assert.equal(JSON.stringify(body).includes('999'), false);
});

test('extension add treats a trashed url as a duplicate instead of failing', async () => {
  const member = await createMember('extension');
  const database = await db();
  database.prepare(`
    INSERT INTO items (user_id, name, url, deleted_at) VALUES (?, '古い本', 'https://www.amazon.co.jp/dp/B00TESTITEM', datetime('now'))
  `).run(member.id);
  const { generateToken } = await import('../src/lib/auth');
  const token = generateToken(member as never);
  const response = await call('../src/app/api/extension-add/route.ts', 'POST', '/api/extension-add', {
    token,
    item: { name: '古い本', url: 'https://www.amazon.co.jp/dp/B00TESTITEM', price: 100, imageUrl: null, priority: 3, categoryId: null },
  });
  assert.equal(response.status, 409);
  assert.match(response.text, /すでに登録/);
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(member.id) as { n: number }).n, 1);
});
