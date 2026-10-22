import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';

test('a photo group is one list card, and hand-added items stay separate', async ({ page }) => {
  const registered = await page.request.post('/api/auth/register', {
    data: { email: `group-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;

  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    const photo = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '牛乳', 'photo')",
    ).run(userId).lastInsertRowid);
    const single = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '単品', 'photo')",
    ).run(userId).lastInsertRowid);
    const manualGroup = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name) VALUES (?, '手のグループ')",
    ).run(userId).lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO items (
        user_id, name, url, current_price, source, source_name, price_fetched_at,
        comparison_group_id, is_purchased, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3)`,
    );
    insert.run(userId, '手入力ペン', 'manual://pen', 400, 'other', null, null, null, 0);
    insert.run(userId, '左', 'manual://left', 1000, 'other', null, null, manualGroup, 0);
    insert.run(userId, '右', 'manual://right', 1500, 'other', null, null, manualGroup, 0);
    insert.run(userId, '牛乳A', 'https://store.shopping.yahoo.co.jp/shop/a', 800, 'yahoo', 'Yahoo!ショッピング', '2026-10-22 01:02:03', photo, 0);
    insert.run(userId, '牛乳B', 'https://item.rakuten.co.jp/shop/b', 1200, 'rakuten', '楽天', null, photo, 0);
    insert.run(userId, '牛乳C', 'https://item.rakuten.co.jp/shop/c', 500, 'rakuten', '楽天', '2026-10-22 01:02:03', photo, 1);
    insert.run(userId, '単品ショップ', 'https://item.rakuten.co.jp/shop/one', 300, 'rakuten', '楽天', '2026-10-22 01:02:03', single, 0);
  } finally {
    db.close();
  }

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '手入力ペン', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '左', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '右', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '牛乳', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '単品', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '牛乳A', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('photo-group-card')).toHaveCount(2);

  const milk = page.getByTestId('photo-group-card').filter({ has: page.getByRole('heading', { name: '牛乳', exact: true }) });
  await expect(milk.getByTestId('photo-group-low')).toHaveText('最安 ¥500');
  await expect(milk.getByTestId('photo-group-range')).toHaveText('¥500〜¥1,200');
  await expect(milk.getByText('3件')).toBeVisible();

  const one = page.getByTestId('photo-group-card').filter({ has: page.getByRole('heading', { name: '単品', exact: true }) });
  await expect(one.getByTestId('photo-group-range')).toHaveText('¥300〜¥300');
  await expect(one.getByText('1件')).toBeVisible();

  await page.getByRole('button', { name: '牛乳のショップを見る' }).click();
  await expect(milk.getByText('牛乳A')).toBeVisible();
  await expect(milk.getByText('牛乳B')).toBeVisible();
  await expect(milk.getByText('購入済み', { exact: true })).toBeVisible();
  await expect(milk.getByText('取得日時なし')).toBeVisible();
  await expect(milk.getByRole('link', { name: '商品ページ' })).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '左', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '右', exact: true })).toBeVisible();
});
