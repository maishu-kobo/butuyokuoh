import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { call, createMember, db, setTestUser } from './regression-harness';
import { excludesPagePriceCheck, priceCheckItems } from '../src/lib/price-check-items';

const refresh = '../src/app/api/items/[id]/refresh/route.ts';
const columns = ['current_price', 'id', 'image_url', 'name', 'target_price', 'url', 'user_id'];

type PriceRow = {
  id: number;
  user_id: number;
  name: string;
  url: string;
  image_url: string | null;
  current_price: number | null;
  target_price: number | null;
  source_item_code?: string | null;
  comparison_group_id?: number | null;
};

function snapshot(database: Awaited<ReturnType<typeof db>>, id: number) {
  return database.prepare(
    'SELECT name, current_price, last_scraped_at, scrape_status, scrape_error, updated_at FROM items WHERE id = ?',
  ).get(id);
}

test('page price checks keep hand-added items and skip photo registrations', async () => {
  const previous = process.env.CAPTURE_ENABLED;
  try {
    const member = await createMember('photo-price');
    const other = await createMember('photo-price-other');
    const database = await db();
    const guestId = Number(database.prepare(
      "INSERT INTO users (email, name, account_type) VALUES ('photo-price-guest@guest.invalid', 'ゲスト', 'guest')",
    ).run().lastInsertRowid);
    const group = (userId: number, origin: string | null) => Number(database.prepare(
      'INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, ?, ?)',
    ).run(userId, origin === 'photo' ? '牛乳' : '手入力', origin).lastInsertRowid);
    const manualGroup = group(member.id, null);
    const photoGroup = group(member.id, 'photo');
    const otherPhoto = group(other.id, 'photo');
    const add = (
      userId: number,
      name: string,
      url: string,
      extra: { purchased?: number; deleted?: boolean; code?: string | null; groupId?: number | null; source?: string } = {},
    ) => Number(database.prepare(`
      INSERT INTO items (user_id, name, url, is_purchased, deleted_at, current_price, target_price, image_url, source, source_item_code, comparison_group_id)
      VALUES (?, ?, ?, ?, ?, 1200, 900, NULL, ?, ?, ?)
    `).run(
      userId,
      name,
      url,
      extra.purchased ?? 0,
      extra.deleted ? '2026-01-01 00:00:00' : null,
      extra.source ?? 'other',
      extra.code === undefined ? null : extra.code,
      extra.groupId === undefined ? null : extra.groupId,
    ).lastInsertRowid);

    const active = add(member.id, '手入力', 'https://example.test/hand');
    const manual = add(member.id, 'メモ', 'manual://still-checked');
    const rakuten = add(member.id, '楽天の手入力', 'https://item.rakuten.co.jp/shop/item', { source: 'rakuten', groupId: manualGroup });
    const emptyCode = add(member.id, '空のコード', 'https://example.test/empty', { code: '' });
    const foreignGroup = add(member.id, '他人のグループ番号', 'https://example.test/foreign-group', { groupId: otherPhoto });
    add(guestId, 'ゲスト', 'https://example.test/guest');
    add(member.id, '購入済み', 'https://example.test/bought', { purchased: 1 });
    add(member.id, 'ゴミ箱', 'https://example.test/gone', { deleted: true });
    const photo = add(member.id, '写真', 'manual://photo', { groupId: photoGroup });
    const coded = add(member.id, '商品コード', 'manual://coded', { code: 'yahoo:milk' });
    const both = add(member.id, '写真とコード', 'manual://both', { code: 'rakuten:shop:milk', groupId: photoGroup });
    const expected = [active, manual, rakuten, emptyCode, foreignGroup].sort((a, b) => a - b);

    for (const flag of [undefined, 'false', 'true', 'TRUE'] as const) {
      if (flag === undefined) delete process.env.CAPTURE_ENABLED;
      else process.env.CAPTURE_ENABLED = flag;
      const rows = priceCheckItems(database) as PriceRow[];
      assert.deepEqual(rows.map((row) => row.id).sort((a, b) => a - b), expected, `CAPTURE_ENABLED=${String(flag)}`);
      for (const row of rows) assert.deepEqual(Object.keys(row).sort(), columns);
      assert.equal(rows.some((row) => [photo, coded, both].includes(row.id)), false);
    }

    const stored = (id: number) => database.prepare(
      'SELECT user_id, source_item_code, comparison_group_id FROM items WHERE id = ?',
    ).get(id) as { user_id: number; source_item_code: string | null; comparison_group_id: number | null };
    assert.equal(excludesPagePriceCheck(database, stored(active)), false);
    assert.equal(excludesPagePriceCheck(database, stored(manual)), false);
    assert.equal(excludesPagePriceCheck(database, stored(rakuten)), false);
    assert.equal(excludesPagePriceCheck(database, stored(emptyCode)), false);
    assert.equal(excludesPagePriceCheck(database, stored(foreignGroup)), false);
    assert.equal(excludesPagePriceCheck(database, stored(add(member.id, '購入済み手入力', 'manual://bought-hand', { purchased: 1 }))), false);
    assert.equal(excludesPagePriceCheck(database, stored(add(member.id, 'ゴミ箱手入力', 'manual://gone-hand', { deleted: true }))), false);
    assert.equal(excludesPagePriceCheck(database, stored(add(guestId, 'ゲスト手入力', 'manual://guest-hand'))), false);
    assert.equal(excludesPagePriceCheck(database, stored(photo)), true);
    assert.equal(excludesPagePriceCheck(database, stored(coded)), false);
    assert.equal(excludesPagePriceCheck(database, stored(both)), true);
    assert.equal(excludesPagePriceCheck(database, stored(add(member.id, '購入済み写真', 'manual://bought-photo', { purchased: 1, groupId: photoGroup }))), true);
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_ENABLED;
    else process.env.CAPTURE_ENABLED = previous;
  }
});

test('refresh skips a multi-shop photo group and still refreshes a single photo code', async () => {
  const member = await createMember('photo-refresh');
  const other = await createMember('photo-refresh-other');
  const database = await db();
  const photoGroup = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '写真', 'photo')",
  ).run(member.id).lastInsertRowid);
  const add = (userId: number, name: string, url: string, extra: { purchased?: number; code?: string | null; groupId?: number | null } = {}) => Number(database.prepare(`
    INSERT INTO items (user_id, name, url, current_price, is_purchased, source_item_code, comparison_group_id)
    VALUES (?, ?, ?, 1500, ?, ?, ?)
  `).run(userId, name, url, extra.purchased ?? 0, extra.code === undefined ? null : extra.code, extra.groupId ?? null).lastInsertRowid);

  const hand = add(member.id, '手入力', 'manual://refresh-hand');
  const emptyCode = add(member.id, '空コード', 'manual://refresh-empty', { code: '' });
  const purchased = add(member.id, '購入済み', 'manual://refresh-bought', { purchased: 1 });
  const photo = add(member.id, '写真', 'manual://refresh-photo', { groupId: photoGroup });
  const photoMate = add(member.id, '写真の別店', 'manual://refresh-photo-b', { groupId: photoGroup });
  const coded = add(member.id, 'コード', 'manual://refresh-coded', { code: 'yahoo:milk' });
  const purchasedPhoto = add(member.id, '購入済み写真', 'manual://refresh-bought-photo', { purchased: 1, code: 'rakuten:shop:milk' });
  const foreign = add(other.id, '他人', 'manual://refresh-foreign');
  await setTestUser(member);

  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    throw new Error('price refresh must not fetch');
  }) as typeof fetch;
  try {
    const handBefore = snapshot(database, hand);
    const refreshed = await call(refresh, 'POST', `/api/items/${hand}/refresh`, undefined, { id: String(hand) });
    assert.equal(refreshed.status, 200);
    const handAfter = snapshot(database, hand) as { name: string; current_price: number; last_scraped_at: string | null; scrape_status: string };
    assert.equal(handAfter.name, '手入力');
    assert.equal(handAfter.current_price, 1500);
    assert.ok(handAfter.last_scraped_at);
    assert.equal(handAfter.scrape_status, 'failed');
    assert.notDeepEqual(handAfter, handBefore);

    const empty = await call(refresh, 'POST', `/api/items/${emptyCode}/refresh`, undefined, { id: String(emptyCode) });
    assert.equal(empty.status, 200);
    assert.equal((snapshot(database, emptyCode) as { scrape_status: string }).scrape_status, 'failed');

    const bought = await call(refresh, 'POST', `/api/items/${purchased}/refresh`, undefined, { id: String(purchased) });
    assert.equal(bought.status, 200);
    assert.ok((snapshot(database, purchased) as { last_scraped_at: string | null }).last_scraped_at);

    for (const id of [coded, purchasedPhoto]) {
      const response = await call(refresh, 'POST', `/api/items/${id}/refresh`, undefined, { id: String(id) });
      assert.equal(response.status, 200);
      const row = snapshot(database, id) as { current_price: number; last_scraped_at: string | null; scrape_status: string };
      assert.equal(row.current_price, 1500);
      assert.ok(row.last_scraped_at);
      assert.equal(row.scrape_status, 'failed');
    }

    for (const id of [photo, photoMate]) {
      const before = snapshot(database, id);
      const response = await call(refresh, 'POST', `/api/items/${id}/refresh`, undefined, { id: String(id) });
      assert.equal(response.status, 409);
      assert.deepEqual(response.json, {
        error: '写真から登録した商品は価格の再取得をしません',
        code: 'PHOTO_PRICE_EXCLUDED',
      });
      assert.deepEqual(snapshot(database, id), before);
    }

    const missingOwner = await call(refresh, 'POST', `/api/items/${foreign}/refresh`, undefined, { id: String(foreign) });
    assert.equal(missingOwner.status, 404);
    assert.equal((snapshot(database, foreign) as { last_scraped_at: string | null }).last_scraped_at, null);
    const missing = await call(refresh, 'POST', '/api/items/999999/refresh', undefined, { id: '999999' });
    assert.equal(missing.status, 404);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refresh checks the photo exclusion before scraping, and the price script keeps using priceCheckItems', () => {
  const route = readFileSync(new URL('../src/app/api/items/[id]/refresh/route.ts', import.meta.url), 'utf8');
  const exclusion = route.indexOf('excludesPagePriceCheck(');
  const scrape = route.indexOf('scrapeUrl(');
  const guestScrape = route.indexOf('scrapeGuestUrl(');
  assert.ok(exclusion >= 0);
  assert.ok(exclusion < scrape);
  assert.ok(exclusion < guestScrape);
  assert.equal(route.includes('withCapture'), false);

  const script = readFileSync(new URL('../scripts/check-prices.ts', import.meta.url), 'utf8');
  assert.match(script, /priceCheckItems\(db\)/);
  assert.doesNotMatch(script, /FROM\s+items/i);
});
