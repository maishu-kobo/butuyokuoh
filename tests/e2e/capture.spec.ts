import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CaptureMessages } from '../../src/lib/capture/contract';

const origin = 'http://localhost:3107';
const pixel = { create: { width: 8, height: 8, channels: 3 as const, background: { r: 20, g: 40, b: 60 } } };
let jpeg: Buffer;
let png: Buffer;
let webp: Buffer;
const heic = Buffer.concat([Buffer.of(0, 0, 0, 0x18), Buffer.from('ftypheic'), Buffer.alloc(4)]);

test.beforeAll(async () => {
  jpeg = await sharp(pixel).jpeg().toBuffer();
  png = await sharp(pixel).png().toBuffer();
  webp = await sharp(pixel).webp().toBuffer();
});

function context() {
  return playwrightRequest.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
}

function photo(name: string, mimeType: string, buffer: Buffer) {
  return { name, mimeType, buffer };
}

async function member(c: APIRequestContext) {
  const response = await c.post('/api/auth/register', {
    data: { email: `capture-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  expect((await (await c.get('/api/auth/me')).json()).user.account_type).toBe('member');
}

test('logged-in capture APIs use fakes and reject guests, bad photos, and other origins', async () => {
  const user = await context();
  const guest = await context();
  const anon = await context();
  try {
    expect((await anon.post('/api/capture/identify', { multipart: { photo: photo('a.jpg', 'image/jpeg', jpeg) } })).status()).toBe(401);
    expect((await anon.post('/api/capture/search', { data: { name: 'ペン' } })).status()).toBe(401);
    expect((await anon.post('/api/capture/register', { data: { candidateIds: [1] } })).status()).toBe(401);

    expect((await guest.post('/api/auth/guest')).status()).toBe(201);
    expect((await guest.post('/api/capture/identify', { multipart: { photo: photo('a.jpg', 'image/jpeg', jpeg) } })).status()).toBe(403);
    expect((await guest.post('/api/capture/search', { data: { name: 'ペン' } })).status()).toBe(403);
    expect((await guest.post('/api/capture/register', { data: { candidateIds: [1] } })).status()).toBe(403);

    await member(user);
    const foreign = await user.post('/api/capture/identify', {
      headers: { Origin: 'https://attacker.test' },
      multipart: { photo: photo('a.jpg', 'image/jpeg', jpeg) },
    });
    expect(foreign.status()).toBe(403);

    const identified = await user.post('/api/capture/identify', { multipart: { photo: photo('a.jpg', 'image/jpeg', jpeg) } });
    expect(identified.status()).toBe(200);
    const product = await identified.json();
    expect(product.confidence).toBe('sure');
    expect(product.products).toHaveLength(1);
    expect(product.products[0].name).toBe('テスト用ゲルボールペン 0.5');
    expect(product.products[0].jan).toBe('4900000000009');
    expect(product.score).toBeUndefined();

    for (const [name, mimeType, buffer] of [
      ['a.png', 'image/png', png],
      ['a.webp', 'image/webp', webp],
    ] as const) {
      const accepted = await user.post('/api/capture/identify', { multipart: { photo: photo(name, mimeType, buffer) } });
      expect(accepted.status(), mimeType).toBe(200);
    }

    const realHeic = readFileSync(join(process.cwd(), 'tests/fixtures/tiny-hevc.heic'));
    const converted = await user.post('/api/capture/identify', { multipart: { photo: photo('pixel.heic', 'image/heic', realHeic) } });
    expect(converted.status()).toBe(200);

    const unreadable = await user.post('/api/capture/identify', { multipart: { photo: photo('a.heic', 'image/heic', heic) } });
    expect(unreadable.status()).toBe(400);
    expect(await unreadable.json()).toMatchObject({ code: 'PHOTO_UNREADABLE', error: CaptureMessages.photoUnreadable });

    const two = new FormData();
    two.append('photo', new File([Uint8Array.from(jpeg)], 'a.jpg', { type: 'image/jpeg' }));
    two.append('photo', new File([Uint8Array.from(png)], 'b.png', { type: 'image/png' }));
    const rejected = await user.post('/api/capture/identify', { multipart: two });
    expect(rejected.status()).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: 'INVALID_INPUT', error: CaptureMessages.onePhoto });

    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    huge.set(jpeg);
    const tooBig = await user.post('/api/capture/identify', { multipart: { photo: photo('big.jpg', 'image/jpeg', huge) } });
    expect(tooBig.status()).toBe(413);
    expect(await tooBig.json()).toMatchObject({ code: 'PHOTO_TOO_LARGE', error: CaptureMessages.photoTooLarge });
  } finally {
    await user.dispose();
    await guest.dispose();
    await anon.dispose();
  }
});

test('search scenarios swap to fakes without leaving the allowed hosts', async () => {
  const user = await context();
  try {
    await member(user);
    const found = await user.post('/api/capture/search', { data: { name: 'テスト用ゲルボールペン 0.5', jan: '4900000000009' } });
    expect(found.status()).toBe(200);
    const body = await found.json();
    expect(body.candidates.map((item: { site: string }) => item.site)).toEqual(['yahoo', 'rakuten']);
    for (const item of body.candidates) {
      expect(item.price).toEqual(expect.any(Number));
      expect(item.title).toEqual(expect.any(String));
      expect(item.fetchedAt).toEqual(expect.any(String));
      expect(item.url).toMatch(/^https:\/\/(store\.shopping\.yahoo\.co\.jp|item\.rakuten\.co\.jp)\//);
      expect(item.jan).toBe('4900000000009');
    }
    const amazon = new URL(body.amazonUrl);
    expect(amazon.hostname).toBe('www.amazon.co.jp');
    expect(amazon.searchParams.get('k')).toBe('4900000000009');
    expect(amazon.searchParams.get('tag')).toBe('test-tag-22');
    expect(body.failures).toEqual([]);

    const yahooDown = await user.post('/api/capture/search', {
      headers: { 'x-capture-fake-scenario': 'yahoo-down' },
      data: { name: 'ペン' },
    });
    expect(yahooDown.status()).toBe(200);
    const partial = await yahooDown.json();
    expect(partial.candidates.map((item: { site: string }) => item.site)).toEqual(['rakuten']);
    expect(partial.failures.map((failure: { site: string }) => failure.site)).toEqual(['yahoo']);

    const both = await user.post('/api/capture/search', {
      headers: { 'x-capture-fake-scenario': 'both-down' },
      data: { name: 'ペン' },
    });
    expect(both.status()).toBe(502);
    const failed = await both.json();
    expect(failed.code).toBe('SEARCH_FAILED');
    expect(failed.error).toBe(CaptureMessages.searchFailed);
    expect(failed.candidates).toBeUndefined();

    const unsure = await user.post('/api/capture/identify', {
      headers: { 'x-capture-fake-scenario': 'unsure' },
      multipart: { photo: photo('a.jpg', 'image/jpeg', jpeg) },
    });
    expect(unsure.status()).toBe(200);
    expect((await unsure.json()).products).toHaveLength(3);

    const again = await user.post('/api/capture/search', { data: { name: 'ペン' } });
    expect((await again.json()).candidates).toHaveLength(2);
  } finally {
    await user.dispose();
  }
});

test('chosen candidates register once, and another member cannot use them', async () => {
  const owner = await context();
  const stranger = await context();
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    await member(owner);
    await member(stranger);
    const ownerId = (await (await owner.get('/api/auth/me')).json()).user.id as number;
    const strangerId = (await (await stranger.get('/api/auth/me')).json()).user.id as number;
    const captureId = Number(db.prepare(
      "INSERT INTO captures (user_id, estimated_name, status) VALUES (?, 'e2e牛乳', 'ready')",
    ).run(ownerId).lastInsertRowid);
    const expires = Date.now() + 60_000;
    const insert = db.prepare(
      `INSERT INTO capture_candidates (user_id, capture_id, source, name, url, price, source_item_code, expires_at)
       VALUES (?, ?, 'yahoo', ?, ?, 100, ?, ?)`,
    );
    const first = Number(insert.run(ownerId, captureId, '牛乳A', 'https://store.shopping.yahoo.co.jp/shop/e2e-a', 'yahoo:e2e-a', expires).lastInsertRowid);
    const second = Number(insert.run(ownerId, captureId, '牛乳B', 'https://store.shopping.yahoo.co.jp/shop/e2e-b', 'yahoo:e2e-b', expires).lastInsertRowid);
    db.prepare(
      'INSERT INTO items (user_id, name, url, is_purchased) VALUES (?, ?, ?, 1)',
    ).run(ownerId, '購入済み', 'https://store.shopping.yahoo.co.jp/shop/e2e-bought');
    const bought = Number(insert.run(
      ownerId,
      captureId,
      '購入済み候補',
      'https://store.shopping.yahoo.co.jp/shop/e2e-bought',
      'yahoo:e2e-bought',
      expires,
    ).lastInsertRowid);

    const created = await owner.post('/api/capture/register', { data: { candidateIds: [first, second, bought] } });
    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.itemIds).toHaveLength(2);
    expect(body.skipped).toEqual([{ candidateId: bought, code: 'ALREADY_REGISTERED', error: '登録済み' }]);

    const replay = await owner.post('/api/capture/register', { data: { candidateIds: [first, second, bought] } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ comparisonGroupId: body.comparisonGroupId, itemIds: body.itemIds });
    expect(db.prepare('SELECT COUNT(*) AS n FROM comparison_groups WHERE user_id = ? AND origin = ?').get(ownerId, 'photo')).toEqual({ n: 1 });

    const stolen = await stranger.post('/api/capture/register', { data: { candidateIds: [first] } });
    expect(stolen.status()).toBe(404);
    expect(await stolen.json()).toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(strangerId)).toEqual({ n: 0 });
  } finally {
    db.close();
    await owner.dispose();
    await stranger.dispose();
  }
});

test('one chosen candidate is stored as a plain item and replay does not make a group', async () => {
  const owner = await context();
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    await member(owner);
    const ownerId = (await (await owner.get('/api/auth/me')).json()).user.id as number;
    const captureId = Number(db.prepare(
      "INSERT INTO captures (user_id, estimated_name, status) VALUES (?, '単品の牛乳', 'ready')",
    ).run(ownerId).lastInsertRowid);
    const expires = Date.now() + 60_000;
    const insert = db.prepare(
      `INSERT INTO capture_candidates (user_id, capture_id, source, name, url, price, source_item_code, expires_at)
       VALUES (?, ?, 'rakuten', ?, ?, 300, ?, ?)`,
    );
    const only = Number(insert.run(ownerId, captureId, '単品ショップ', 'https://item.rakuten.co.jp/shop/e2e-one', 'rakuten:e2e-one', expires).lastInsertRowid);
    const extra = Number(insert.run(ownerId, captureId, '足さない候補', 'https://item.rakuten.co.jp/shop/e2e-extra', 'rakuten:e2e-extra', expires).lastInsertRowid);

    const created = await owner.post('/api/capture/register', { data: { candidateIds: [only] } });
    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.comparisonGroupId).toBeNull();
    expect(body.itemIds).toHaveLength(1);
    expect(db.prepare('SELECT name, comparison_group_id FROM items WHERE id = ?').get(body.itemIds[0])).toEqual({
      name: '単品ショップ',
      comparison_group_id: null,
    });
    expect(db.prepare('SELECT status, comparison_group_id FROM captures WHERE id = ?').get(captureId)).toEqual({
      status: 'registered',
      comparison_group_id: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM comparison_groups WHERE user_id = ?').get(ownerId)).toEqual({ n: 0 });

    const replay = await owner.post('/api/capture/register', { data: { candidateIds: [only, extra] } });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ comparisonGroupId: null, itemIds: body.itemIds });
    expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(ownerId)).toEqual({ n: 1 });
  } finally {
    db.close();
    await owner.dispose();
  }
});

test('a Rakuten item code shows the fetched time and price note, and Yahoo does not', async ({ page }) => {
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    const registered = await page.request.post('/api/auth/register', {
      headers: { Origin: origin },
      data: { email: `rakuten-price-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
    });
    expect(registered.ok()).toBeTruthy();
    const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;
    db.prepare(`
      INSERT INTO items (user_id, name, url, current_price, source, source_name, source_item_code, price_fetched_at, priority)
      VALUES (?, '楽天の牛乳', ?, 248, 'rakuten', '楽天', 'rakuten:shop:milk', '2026-10-22T00:00:00.000Z', 3)
    `).run(userId, `manual://${userId}-rakuten`);
    db.prepare(`
      INSERT INTO items (user_id, name, url, current_price, source, source_name, source_item_code, price_fetched_at, priority)
      VALUES (?, 'ヤフーの牛乳', ?, 111, 'yahoo', 'Yahoo!ショッピング', 'yahoo:milk', '2026-10-22T00:00:00.000Z', 3)
    `).run(userId, `manual://${userId}-yahoo`);

    await page.goto('/');
    const note = '価格は楽天市場の商品価格です。価格は変動する場合があります。';
    const rakutenCard = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: '楽天の牛乳', exact: true }) });
    await expect(rakutenCard).toContainText(note);
    await expect(rakutenCard).toContainText('2026');
    const yahooCard = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: 'ヤフーの牛乳', exact: true }) });
    await expect(yahooCard).toBeVisible();
    await expect(yahooCard).not.toContainText(note);

    await page.getByRole('button', { name: '出費予定' }).click();
    await expect(page.getByText(note)).toHaveCount(1);
  } finally {
    db.close();
  }
});

test('photo group spending counts one candidate on the list and budget screens', async ({ page }) => {
  const db = new Database(process.env.E2E_DB_PATH!);
  db.pragma('busy_timeout = 5000');
  try {
    const registered = await page.request.post('/api/auth/register', {
      headers: { Origin: origin },
      data: { email: `spend-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
    });
    expect(registered.ok()).toBeTruthy();
    const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as number;
    const groupId = Number(db.prepare(
      `INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '牛乳', 'photo')`,
    ).run(userId).lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO items (user_id, name, url, current_price, source, source_name, planned_purchase_date, comparison_group_id, priority)
      VALUES (?, ?, ?, ?, ?, ?, '2026-10-02', ?, 3)
    `);
    insert.run(userId, '高い牛乳', `manual://${userId}-dear`, 900, 'rakuten', '楽天', groupId);
    insert.run(userId, '安い牛乳', `manual://${userId}-cheap`, 100, 'yahoo', 'Yahoo!ショッピング', groupId);
    db.prepare(`
      INSERT INTO items (user_id, name, url, current_price, planned_purchase_date, priority)
      VALUES (?, '鉛筆', ?, 50, '2026-10-01', 3)
    `).run(userId, `manual://${userId}-pencil`);

    await page.goto('/');
    await expect(page.locator('.text-orange-500')).toHaveText('¥150');
    await expect(page.getByTestId('photo-group-card')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '牛乳' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '鉛筆' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '高い牛乳' })).toHaveCount(0);

    await page.getByRole('button', { name: '出費予定' }).click();
    await expect(page.locator('.text-3xl').first()).toHaveText('¥150');
    await expect(page.getByText('高い牛乳', { exact: true })).toBeVisible();
    await expect(page.getByText('安い牛乳', { exact: true })).toBeVisible();
    await expect(page.getByText('鉛筆', { exact: true })).toBeVisible();
    await expect(page.getByText('牛乳', { exact: true })).toHaveCount(0);
    await expect(page.getByText('楽天', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '全て選択' }).click();
    await expect(page.getByText('2件選択中')).toBeVisible();

    const dear = page.locator('div').filter({ hasText: '高い牛乳' }).last();
    await dear.getByRole('button', { name: '合計に数える' }).click();
    await expect(page.locator('.text-3xl').first()).toHaveText('¥950');
    await expect(page.getByText('合計に含まない')).toBeVisible();
  } finally {
    db.close();
  }
});
