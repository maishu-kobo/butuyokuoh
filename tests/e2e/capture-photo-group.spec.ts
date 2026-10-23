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
  await expect(milk.getByText('2026-10-22 01:02:03')).toHaveCount(0);
  await expect(milk.getByText('2026/10/22 10:02')).toHaveCount(2);
  await expect(milk).not.toContainText('Yahoo!ショッピング Yahoo!ショッピング');
  await expect(milk.getByRole('link', { name: '商品ページ' })).toHaveCount(3);
  await expect(milk.getByRole('button', { name: '価格推移' })).toBeVisible();
  await expect(milk.getByRole('button', { name: '編集' })).toBeVisible();
  await expect(milk.getByRole('button', { name: '購入済みにする' }).first()).toBeVisible();
  await expect(milk.getByRole('button', { name: '削除' })).toBeVisible();
  await expect(milk.getByRole('button', { name: 'ドラッグして並び替え' })).toBeVisible();
  await expect(milk.getByText('普通', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '左', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '右', exact: true })).toBeVisible();
});

test('a photo group uses the same card as a url item on a phone and a desktop', async ({ page }) => {
  const hydration: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|did not match/i.test(message.text())) hydration.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (/hydration|did not match/i.test(error.message)) hydration.push(error.message);
  });
  await page.setViewportSize({ width: 390, height: 844 });

  const registered = await page.request.post('/api/auth/register', {
    data: { email: `card-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    const groupId = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, 'Belkin 電源アダプタ', 'photo')",
    ).run(userId).lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO items (
        user_id, name, url, image_url, current_price, source, source_name, price_fetched_at, comparison_group_id, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3)`,
    );
    insert.run(
      userId, 'Anker 充電器', `https://www.amazon.co.jp/dp/card-${userId}`,
      'https://m.media-amazon.com/images/I/demo.jpg', 2480, 'amazon', 'Amazon', null, null,
    );
    insert.run(
      userId, 'Belkin 電源アダプタ', `https://store.shopping.yahoo.co.jp/shop/belkin-${userId}`,
      'https://item-shopping.c.yimg.jp/i/g/belkin', 1338, 'yahoo', 'Yahoo!ショッピング',
      '2026-10-23T00:33:53.164Z', groupId,
    );
    insert.run(
      userId, '高いケース', `https://item.rakuten.co.jp/shop/case-${userId}`,
      'https://evil.example/case.jpg', 2000, 'rakuten', '楽天',
      '2026-10-23T00:33:53.164Z', groupId,
    );
  } finally {
    db.close();
  }

  await page.goto('/');
  await expect(page.locator('.text-orange-500')).toHaveText('¥3,818');
  const photo = page.getByTestId('photo-group-card');
  const urlCard = page.locator('.space-y-3 > div').filter({ has: page.getByRole('heading', { name: 'Anker 充電器', exact: true }) });
  await expect(photo.getByRole('heading', { name: 'Belkin 電源アダプタ', exact: true })).toBeVisible();
  await expect(photo.getByRole('img', { name: 'Belkin 電源アダプタ' })).toHaveAttribute('src', 'https://item-shopping.c.yimg.jp/i/g/belkin');
  await expect(photo.locator('img[src*="evil.example"]')).toHaveCount(0);
  await expect(photo.getByText('Yahoo!ショッピング', { exact: true })).toBeVisible();
  await expect(photo.getByText('普通', { exact: true })).toBeVisible();
  await expect(photo.getByText('¥1,338', { exact: true }).first()).toBeVisible();
  await expect(photo.getByTestId('photo-group-low')).toHaveText('最安 ¥1,338');
  await expect(photo.getByTestId('photo-group-range')).toHaveText('¥1,338〜¥2,000');
  await expect(photo.getByText('2件')).toBeVisible();
  for (const name of ['価格推移', '編集', '購入済みにする', '削除', 'ドラッグして並び替え']) {
    await expect(photo.getByRole('button', { name })).toBeVisible();
    await expect(urlCard.getByRole('button', { name })).toBeVisible();
  }
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrow).toBeLessThanOrEqual(1);

  await photo.getByRole('button', { name: 'Belkin 電源アダプタのショップを見る' }).click();
  await expect(photo).not.toContainText('Yahoo!ショッピング Yahoo!ショッピング');
  await expect(photo).not.toContainText('楽天 楽天');
  await expect(photo.getByText('2026/10/23 09:33')).toHaveCount(2);
  await expect(photo.getByText(/T\d{2}:\d{2}:\d{2}/)).toHaveCount(0);
  await expect(photo.locator('img[src*="evil.example"]')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(photo.getByRole('img', { name: 'Belkin 電源アダプタ' })).toBeVisible();
  await expect(photo.getByRole('button', { name: '価格推移' })).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(1);
  expect(hydration).toEqual([]);
});
