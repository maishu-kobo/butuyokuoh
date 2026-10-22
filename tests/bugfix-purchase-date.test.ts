import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db } from './bugfix-harness';

const itemRoute = '../src/app/api/items/[id]/route.ts';

test('purchasing at 00:30 Japan time stores that calendar day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T15:30:00.000Z') });
  const owner = await createMember('purchase-day');
  const database = await db();
  const insert = database.prepare('INSERT INTO items (user_id, name, url) VALUES (?, ?, ?)');
  const purchasedId = Number(insert.run(owner.id, '深夜の本', 'https://example.com/midnight').lastInsertRowid);
  const explicitId = Number(insert.run(owner.id, '日付指定', 'https://example.com/explicit').lastInsertRowid);

  const purchased = await call(itemRoute, 'PATCH', `/api/items/${purchasedId}`, {
    is_purchased: true,
  }, { id: String(purchasedId) });
  assert.equal(purchased.status, 200);
  const body = purchased.json as { purchased_at: string | null; is_purchased: number };
  assert.equal(body.is_purchased, 1);
  assert.equal(body.purchased_at, '2026-10-22');
  const stored = database.prepare('SELECT is_purchased, purchased_at FROM items WHERE id = ?').get(purchasedId) as {
    is_purchased: number;
    purchased_at: string | null;
  };
  assert.equal(stored.is_purchased, 1);
  assert.equal(stored.purchased_at, '2026-10-22');

  const explicit = await call(itemRoute, 'PATCH', `/api/items/${explicitId}`, {
    is_purchased: true,
    purchased_at: '2026-01-15',
  }, { id: String(explicitId) });
  assert.equal(explicit.status, 200);
  assert.equal((explicit.json as { purchased_at: string }).purchased_at, '2026-01-15');
});
