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
  await expect(page.getByRole('heading', { name: '単品', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '単品ショップ', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '牛乳A', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('photo-group-card')).toHaveCount(1);

  const milk = page.getByTestId('photo-group-card').filter({ has: page.getByRole('heading', { name: '牛乳', exact: true }) });
  await expect(milk.getByTestId('photo-group-low')).toHaveText('最安 ¥500');
  await expect(milk.getByTestId('photo-group-range')).toHaveText('¥500〜¥1,200');
  await expect(milk.getByText('3件')).toBeVisible();

  const one = page.locator('.space-y-3 > div').filter({ has: page.getByRole('heading', { name: '単品ショップ', exact: true }) });
  await expect(one.getByTestId('photo-group-card')).toHaveCount(0);
  await expect(one.getByText('¥300', { exact: true }).first()).toBeVisible();
  await expect(one.getByText('楽天', { exact: true })).toBeVisible();
  for (const name of ['価格推移', '編集', '購入済みにする', '削除', 'ドラッグして並び替え']) {
    await expect(one.getByRole('button', { name })).toBeVisible();
  }

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
  await expect(milk.getByRole('button', { name: '削除', exact: true })).toBeVisible();
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

test('budget rows for photo shops are flat on a phone and a desktop', async ({ page }) => {
  const hydration: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|did not match/i.test(message.text())) hydration.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (/hydration|did not match/i.test(error.message)) hydration.push(error.message);
  });
  await page.setViewportSize({ width: 390, height: 844 });

  const registered = await page.request.post('/api/auth/register', {
    data: { email: `budget-flat-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    const groupId = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, 'Belkin 電源アダプタ', 'photo')",
    ).run(userId).lastInsertRowid);
    const singleId = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '単品グループ', 'photo')",
    ).run(userId).lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO items (
        user_id, name, url, current_price, source, source_name, planned_purchase_date, comparison_group_id, priority
      ) VALUES (?, ?, ?, ?, ?, ?, '2026-10-02', ?, 3)`,
    );
    insert.run(userId, '天幕のジャードゥーガル 3', `manual://${userId}-book`, 792, 'other', null, null);
    insert.run(userId, 'Belkin Yahoo', `manual://${userId}-yahoo`, 1338, 'yahoo', 'Yahoo!ショッピング', groupId);
    insert.run(userId, 'Belkin 楽天', `manual://${userId}-rakuten`, 2000, 'rakuten', '楽天', groupId);
    insert.run(userId, '単品ショップ', `manual://${userId}-one`, 300, 'rakuten', '楽天', singleId);
  } finally {
    db.close();
  }

  await page.goto('/');
  await page.getByRole('button', { name: '出費予定' }).click();
  await expect(page.getByText('天幕のジャードゥーガル 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Belkin Yahoo', { exact: true })).toBeVisible();
  await expect(page.getByText('Belkin 楽天', { exact: true })).toBeVisible();
  await expect(page.getByText('単品ショップ', { exact: true })).toBeVisible();
  await expect(page.getByText('Belkin 電源アダプタ', { exact: true })).toHaveCount(0);
  await expect(page.getByText('単品グループ', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Yahoo!ショッピング', { exact: true })).toHaveCount(0);
  await expect(page.locator('.text-3xl').first()).toHaveText('¥2,430');

  const month = page.locator('div.rounded-lg.shadow').filter({ hasText: '2026年10月' });
  const row = (name: string) => month.locator('div.cursor-pointer').filter({ hasText: name });
  await expect(row('単品ショップ').getByRole('button', { name: '合計に数える' })).toHaveCount(0);
  await expect(row('天幕のジャードゥーガル 3').getByRole('button', { name: '合計に数える' })).toHaveCount(0);
  await expect(row('Belkin Yahoo').getByRole('button', { name: '合計に数える' })).toBeVisible();
  await expect(row('Belkin 楽天').getByRole('button', { name: '合計に数える' })).toBeVisible();

  const leftEdges = () => month.locator('div.cursor-pointer').evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().x),
  );
  const narrowEdges = await leftEdges();
  expect(narrowEdges).toHaveLength(4);
  for (const x of narrowEdges) expect(Math.abs(x - narrowEdges[0])).toBeLessThanOrEqual(1);
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(narrow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  const wideEdges = await leftEdges();
  expect(wideEdges).toHaveLength(4);
  for (const x of wideEdges) expect(Math.abs(x - wideEdges[0])).toBeLessThanOrEqual(1);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(1);
  expect(hydration).toEqual([]);
});

test('a photo search keeps the provider thumbnail on a single item and on a multi-shop card', async ({ page }) => {
  const origin = 'http://localhost:3107';
  const registered = await page.request.post('/api/auth/register', {
    headers: { Origin: origin },
    data: { email: `thumb-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();

  const singleSearch = await page.request.post('/api/capture/search', {
    headers: { Origin: origin },
    data: { name: '写真のペン' },
  });
  expect(singleSearch.ok()).toBeTruthy();
  const singleBody = await singleSearch.json();
  const rakuten = singleBody.candidates.find((item: { site: string }) => item.site === 'rakuten');
  expect(rakuten.imageUrl).toBe('https://thumbnail.image.rakuten.co.jp/fake-pen.jpg');
  const created = await page.request.post('/api/capture/register', {
    headers: { Origin: origin },
    data: { candidateIds: [rakuten.candidateId] },
  });
  expect(created.status()).toBe(201);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const single = page.locator('.space-y-3 > div').filter({ has: page.getByRole('heading', { name: '写真のペン', exact: true }) });
  await expect(single.getByRole('img', { name: '写真のペン' })).toHaveAttribute('src', 'https://thumbnail.image.rakuten.co.jp/fake-pen.jpg');
  await expect(page.getByTestId('photo-group-card')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(single.getByRole('img', { name: '写真のペン' })).toHaveAttribute('src', 'https://thumbnail.image.rakuten.co.jp/fake-pen.jpg');

  // 偽物の商品URLは検索のたびに同じなので、別の会員で両方を登録しないと楽天側が既登録になる。
  const groupedUser = await page.request.post('/api/auth/register', {
    headers: { Origin: origin },
    data: { email: `thumb-group-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(groupedUser.ok()).toBeTruthy();
  const multiSearch = await page.request.post('/api/capture/search', {
    headers: { Origin: origin },
    data: { name: '比較のペン' },
  });
  expect(multiSearch.ok()).toBeTruthy();
  const multiBody = await multiSearch.json();
  const ids = multiBody.candidates.map((item: { candidateId: number }) => item.candidateId);
  expect(ids).toHaveLength(2);
  const grouped = await page.request.post('/api/capture/register', {
    headers: { Origin: origin },
    data: { candidateIds: ids },
  });
  expect(grouped.status()).toBe(201);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const photo = page.getByTestId('photo-group-card');
  await expect(photo.getByRole('heading', { name: '比較のペン', exact: true })).toBeVisible();
  await expect(photo.getByRole('img', { name: '比較のペン' })).toHaveAttribute('src', 'https://item-shopping.c.yimg.jp/i/g/fake-pen');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(photo.getByRole('img', { name: '比較のペン' })).toHaveAttribute('src', 'https://item-shopping.c.yimg.jp/i/g/fake-pen');
});

test('editing a photo card keeps a stored image that the card does not display', async ({ page }) => {
  const registered = await page.request.post('/api/auth/register', {
    data: { email: `keep-image-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  const upload = 'https://uploads.example.test/mine.jpg';
  let faceId = 0;
  try {
    const groupId = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '画像のグループ', 'photo')",
    ).run(userId).lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO items (user_id, name, url, image_url, current_price, source, source_name, comparison_group_id, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 3)`,
    );
    faceId = Number(insert.run(
      userId, '安い画像', `https://store.shopping.yahoo.co.jp/shop/img-${userId}`, upload, 100, 'yahoo', 'Yahoo!ショッピング', groupId,
    ).lastInsertRowid);
    insert.run(
      userId, '高い画像', `https://item.rakuten.co.jp/shop/img-${userId}`, 'https://evil.example/case.jpg', 900, 'rakuten', '楽天', groupId,
    );
  } finally {
    db.close();
  }

  await page.goto('/');
  const photo = page.getByTestId('photo-group-card');
  await expect(photo.getByRole('heading', { name: '画像のグループ', exact: true })).toBeVisible();
  await expect(photo.locator(`img[src="${upload}"]`)).toHaveCount(0);
  await photo.getByRole('button', { name: '編集' }).click();
  await photo.locator('summary').filter({ hasText: 'メモ・画像' }).click();
  await photo.getByPlaceholder('メモを入力...').fill('メモだけ');
  await photo.getByRole('button', { name: '保存', exact: true }).click();
  await expect(photo.getByPlaceholder('メモを入力...')).toHaveCount(0);

  const check = new Database(process.env.E2E_DB_PATH!);
  check.pragma('busy_timeout = 5000');
  try {
    expect(check.prepare('SELECT image_url, notes FROM items WHERE id = ?').get(faceId)).toEqual({
      image_url: upload,
      notes: 'メモだけ',
    });
  } finally {
    check.close();
  }
});

test('each open shop can be deleted to the trash, and two shops become one registration', async ({ page }) => {
  const registered = await page.request.post('/api/auth/register', {
    data: { email: `shop-delete-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;

  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    const photo = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '牛乳', 'photo')",
    ).run(userId).lastInsertRowid);
    const whole = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '全部', 'photo')",
    ).run(userId).lastInsertRowid);
    const single = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '単品', 'photo')",
    ).run(userId).lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO items (
        user_id, name, url, current_price, source, source_name, price_fetched_at, comparison_group_id, is_purchased, priority
      ) VALUES (?, ?, ?, ?, ?, ?, '2026-10-22 01:02:03', ?, 0, 3)`,
    );
    insert.run(userId, '手入力ペン', 'manual://pen', 400, 'other', null, null);
    insert.run(userId, '単品ショップ', 'https://item.rakuten.co.jp/shop/one', 300, 'rakuten', '楽天', single);
    insert.run(userId, '牛乳A', 'https://item.rakuten.co.jp/shop/a', 800, 'rakuten', '楽天', photo);
    insert.run(userId, '牛乳B', 'https://item.rakuten.co.jp/shop/b', 1200, 'rakuten', '楽天', photo);
    insert.run(userId, '牛乳C', 'https://store.shopping.yahoo.co.jp/shop/c', 500, 'yahoo', 'Yahoo!ショッピング', photo);
    insert.run(userId, '全部A', 'https://item.rakuten.co.jp/shop/all-a', 100, 'rakuten', '楽天', whole);
    insert.run(userId, '全部B', 'https://item.rakuten.co.jp/shop/all-b', 200, 'rakuten', '楽天', whole);
  } finally {
    db.close();
  }

  await page.goto('/');
  const milk = page.getByTestId('photo-group-card').filter({ has: page.getByRole('heading', { name: '牛乳', exact: true }) });
  const wholeCard = page.getByTestId('photo-group-card').filter({ has: page.getByRole('heading', { name: '全部', exact: true }) });
  const urlCard = page.locator('.space-y-3 > div').filter({ has: page.getByRole('heading', { name: '手入力ペン', exact: true }) });
  const one = page.locator('.space-y-3 > div').filter({ has: page.getByRole('heading', { name: '単品ショップ', exact: true }) });
  await expect(milk).toBeVisible();
  await expect(milk.getByRole('button', { name: '価格を更新' })).toHaveCount(0);
  await expect(urlCard.getByRole('button', { name: '価格を更新', exact: true })).toBeVisible();
  await expect(one.getByRole('button', { name: '価格を更新', exact: true })).toBeVisible();

  await milk.getByRole('button', { name: '牛乳のショップを見る' }).click();
  for (const name of ['牛乳A', '牛乳B', '牛乳C']) {
    await expect(milk.getByRole('button', { name: `${name}を削除`, exact: true })).toBeVisible();
  }
  await expect(milk.getByRole('button', { name: '削除', exact: true })).toHaveCount(1);
  await expect(milk.getByRole('button', { name: '価格を更新' })).toHaveCount(0);

  await milk.getByRole('button', { name: '牛乳Bを削除', exact: true }).click();
  await expect(milk.getByText('牛乳B', { exact: true })).toHaveCount(0);
  await expect(milk.getByText('牛乳A', { exact: true })).toBeVisible();
  await expect(milk.getByText('牛乳C', { exact: true })).toBeVisible();
  await expect(milk.getByText('2件')).toBeVisible();
  await expect(milk.getByRole('button', { name: '価格を更新' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '手入力ペン', exact: true })).toBeVisible();

  await milk.getByRole('button', { name: '牛乳Aを削除', exact: true }).click();
  await expect(page.getByTestId('photo-group-card').filter({ has: page.getByRole('heading', { name: '牛乳', exact: true }) })).toHaveCount(0);
  const left = page.locator('.space-y-3 > div').filter({ has: page.getByRole('heading', { name: '牛乳C', exact: true }) });
  await expect(left.getByTestId('photo-group-card')).toHaveCount(0);
  await expect(left.getByText('¥500', { exact: true }).first()).toBeVisible();
  await expect(left.getByText('Yahoo!ショッピング', { exact: true })).toBeVisible();
  for (const name of ['価格を更新', '価格推移', '編集', '購入済みにする', '削除', 'ドラッグして並び替え']) {
    await expect(left.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '牛乳', exact: true })).toHaveCount(0);

  await left.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByRole('heading', { name: '牛乳C', exact: true })).toHaveCount(0);

  await wholeCard.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.getByRole('heading', { name: '全部', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '全部A', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '全部B', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '手入力ペン', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '単品ショップ', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'ゴミ箱' }).click();
  for (const name of ['牛乳A', '牛乳B', '牛乳C', '全部A', '全部B']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '手入力ペン', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '単品ショップ', exact: true })).toHaveCount(0);
});
