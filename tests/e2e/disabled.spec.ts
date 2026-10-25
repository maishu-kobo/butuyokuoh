import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
const origin = 'http://localhost:3107';

test('feature off rejects creation and existing guests but keeps member auth and cleanup', async ({page,context}) => {
  const db = new Database(process.env.E2E_DB_PATH!);
  // The first authenticated read runs the schema migration.
  await context.request.get('/api/auth/me');
  const id = Number(db.prepare("INSERT INTO users(email,account_type) VALUES ('disabled@guest.invalid','guest')").run().lastInsertRowid);
  const token = 'a'.repeat(64);
  db.prepare('INSERT INTO guest_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now(),Date.now()+3600_000);
  await context.addCookies([{name:'butuyokuoh_guest',value:token,url:origin,httpOnly:true,sameSite:'Lax',secure:Boolean(process.env.E2E_PRODUCTION)}]);
  expect((await context.request.get('/api/items')).status()).toBe(401);
  expect((await context.request.post('/api/auth/guest',{headers:{Origin:origin}})).status()).toBe(503);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Googleでログイン',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ゲストで試す',exact:true})).toHaveCount(0);
  expect((await context.request.delete('/api/auth/guest',{headers:{Origin:origin}})).status()).toBe(204);
  expect(db.prepare('SELECT id FROM users WHERE id = ?').get(id)).toBeUndefined();
  const registered = await context.request.post('/api/auth/register',{data:{email:'disabled-member@example.test',password:'test-password'}});
  expect(registered.ok()).toBe(true);
  expect((await context.request.get('/api/items')).status()).toBe(200);
  db.close();
});
