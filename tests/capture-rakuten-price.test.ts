import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMember, db } from './regression-harness';
import { priceCheckItems } from '../src/lib/price-check-items';
import { RAKUTEN_PRICE_NOTE, rakutenPriceCaption } from '../src/lib/capture/rakuten-price-note';
import { refreshDueRakutenPrices } from '../src/lib/capture/rakuten-price';
import type { RakutenHttpRequest, RakutenHttpResponse, RakutenLimiter } from '../src/lib/capture/rakuten';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-22T00:00:00.000Z';
const SECRET = 'super-secret-access-key';
const APP_ID = 'app-123';

function allow(): RakutenLimiter {
  return { tryAcquire: () => ({ ok: true }) };
}

function priceBody(price: number, itemCode = 'shop:milk') {
  return JSON.stringify({
    items: [{ itemName: '牛乳', itemPrice: price, itemCode, shopName: '店' }],
  });
}

async function fixture() {
  const member = await createMember('rakuten-daily');
  const database = await db();
  const guestId = Number(database.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('rakuten-daily-guest@guest.invalid', 'ゲスト', 'guest')",
  ).run().lastInsertRowid);
  const add = (
    userId: number,
    name: string,
    fields: {
      price?: number | null;
      code?: string | null;
      fetchedAt?: string | null;
      purchased?: number;
      deleted?: boolean;
      source?: string;
    } = {},
  ) => Number(database.prepare(`
    INSERT INTO items (
      user_id, name, url, current_price, source, source_item_code, price_fetched_at, is_purchased, deleted_at, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3)
  `).run(
    userId,
    name,
    `manual://${userId}-${name}`,
    fields.price === undefined ? 198 : fields.price,
    fields.source ?? 'rakuten',
    fields.code === undefined ? null : fields.code,
    fields.fetchedAt === undefined ? null : fields.fetchedAt,
    fields.purchased ?? 0,
    fields.deleted ? '2026-01-01 00:00:00' : null,
  ).lastInsertRowid);
  return { member, guestId, database, add };
}

function row(database: Awaited<ReturnType<typeof db>>, id: number) {
  return database.prepare(
    'SELECT current_price, price_fetched_at FROM items WHERE id = ?',
  ).get(id) as { current_price: number | null; price_fetched_at: string | null };
}

function history(database: Awaited<ReturnType<typeof db>>, id: number) {
  return database.prepare('SELECT price FROM price_history WHERE item_id = ? ORDER BY id').all(id) as { price: number }[];
}

test('a due Rakuten item code is refreshed once, and Yahoo or hand-added rows are not', async () => {
  const { member, guestId, database, add } = await fixture();
  const due = add(member.id, '牛乳', { code: 'rakuten:shop:milk', price: 198 });
  const recent = add(member.id, '新しい', { code: 'rakuten:shop:new', price: 300, fetchedAt: '2026-10-21T23:00:00.000Z' });
  const recentSqlite = add(member.id, '新しい時刻', { code: 'rakuten:shop:sqlite', price: 310, fetchedAt: '2026-10-21 23:00:00' });
  const dayOld = add(member.id, '古い', { code: 'rakuten:shop:old', price: 320, fetchedAt: '2026-10-21T00:00:00.000Z' });
  const justUnder = add(member.id, '一日未満', { code: 'rakuten:shop:under', price: 330, fetchedAt: '2026-10-21T00:00:00.001Z' });
  const yahoo = add(member.id, 'ヤフー', { code: 'yahoo:milk', price: 111, source: 'yahoo' });
  const manual = add(member.id, '手入力楽天', { price: 50, source: 'rakuten' });
  const emptyCode = add(member.id, '空コード', { code: '', price: 40, source: 'rakuten' });
  const bought = add(member.id, '買った', { code: 'rakuten:shop:bought', purchased: 1, price: 10 });
  const trashed = add(member.id, '捨てた', { code: 'rakuten:shop:gone', deleted: true, price: 9 });
  const guest = add(guestId, 'ゲスト', { code: 'rakuten:shop:guest', price: 8 });
  database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 198)').run(due);
  database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 320)').run(dayOld);

  const calls: RakutenHttpRequest[] = [];
  await refreshDueRakutenPrices(database, {
    credentials: { applicationId: APP_ID, accessKey: SECRET },
    limiter: allow(),
    now: () => new Date(NOW),
    pause: async () => {},
    timeoutMs: 50,
    http: async (request) => {
      calls.push(request);
      const itemCode = new URL(request.url).searchParams.get('itemCode');
      const price = itemCode === 'shop:old' ? 280 : 248;
      return { status: 200, body: priceBody(price, itemCode ?? 'shop:milk') };
    },
  });

  assert.deepEqual(calls.map((request) => new URL(request.url).searchParams.get('itemCode')).sort(), ['shop:milk', 'shop:old']);
  for (const request of calls) {
    const url = new URL(request.url);
    assert.equal(url.hostname, 'openapi.rakuten.co.jp');
    assert.equal(url.searchParams.get('keyword'), null);
    assert.equal(url.searchParams.get('applicationId'), APP_ID);
    assert.equal(request.headers.accessKey, SECRET);
    assert.equal(request.url.includes(SECRET), false);
    assert.equal(request.method, 'GET');
  }
  assert.deepEqual(row(database, due), { current_price: 248, price_fetched_at: NOW });
  assert.deepEqual(history(database, due).map((entry) => entry.price), [198, 248]);
  assert.deepEqual(row(database, dayOld), { current_price: 280, price_fetched_at: NOW });
  assert.deepEqual(history(database, dayOld).map((entry) => entry.price), [320, 280]);
  assert.deepEqual(row(database, recent), { current_price: 300, price_fetched_at: '2026-10-21T23:00:00.000Z' });
  assert.deepEqual(row(database, recentSqlite), { current_price: 310, price_fetched_at: '2026-10-21 23:00:00' });
  assert.deepEqual(row(database, justUnder), { current_price: 330, price_fetched_at: '2026-10-21T00:00:00.001Z' });
  assert.deepEqual(row(database, yahoo), { current_price: 111, price_fetched_at: null });
  assert.deepEqual(row(database, manual), { current_price: 50, price_fetched_at: null });
  assert.deepEqual(row(database, emptyCode), { current_price: 40, price_fetched_at: null });
  assert.deepEqual(row(database, bought), { current_price: 10, price_fetched_at: null });
  assert.deepEqual(row(database, trashed), { current_price: 9, price_fetched_at: null });
  assert.deepEqual(row(database, guest), { current_price: 8, price_fetched_at: null });

  const checked = (priceCheckItems(database) as { id: number }[]).map((entry) => entry.id);
  assert.equal(checked.includes(manual), true);
  assert.equal(checked.includes(emptyCode), true);
  assert.equal(checked.includes(due), false);
  assert.equal(checked.includes(yahoo), false);
});

test('the same Rakuten price updates the timestamp without another history row', async () => {
  const { member, database, add } = await fixture();
  const same = add(member.id, '同じ', { code: 'rakuten:shop:milk', price: 248, fetchedAt: '2026-10-20T00:00:00.000Z' });
  database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 248)').run(same);
  const calls: RakutenHttpRequest[] = [];
  await refreshDueRakutenPrices(database, {
    credentials: { applicationId: APP_ID, accessKey: SECRET },
    limiter: allow(),
    now: () => new Date(NOW),
    pause: async () => {},
    http: async (request) => {
      calls.push(request);
      return { status: 200, body: priceBody(248) };
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(row(database, same), { current_price: 248, price_fetched_at: NOW });
  assert.deepEqual(history(database, same).map((entry) => entry.price), [248]);
});

test('a failed Rakuten response is not retried and does not change the price', async () => {
  const { member, database, add } = await fixture();
  const due = add(member.id, '失敗', { code: 'rakuten:shop:milk', price: 198 });
  const calls: RakutenHttpRequest[] = [];
  const http = async (request: RakutenHttpRequest): Promise<RakutenHttpResponse> => {
    calls.push(request);
    return { status: 500, body: '{"error":"no"}' };
  };
  await refreshDueRakutenPrices(database, {
    credentials: { applicationId: APP_ID, accessKey: SECRET },
    limiter: allow(),
    now: () => new Date(NOW),
    pause: async () => {},
    http,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(row(database, due), { current_price: 198, price_fetched_at: null });
  assert.deepEqual(history(database, due), []);

  calls.length = 0;
  await refreshDueRakutenPrices(database, {
    credentials: { applicationId: APP_ID, accessKey: SECRET },
    limiter: allow(),
    now: () => new Date(NOW),
    pause: async () => {},
    http: async (request) => {
      calls.push(request);
      throw new Error('network');
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(row(database, due), { current_price: 198, price_fetched_at: null });
});

test('a rate limit or missing key does not call Rakuten or change the row', async () => {
  const { member, database, add } = await fixture();
  const due = add(member.id, '制限', { code: 'rakuten:shop:milk', price: 198 });
  const calls: RakutenHttpRequest[] = [];
  const http = async (request: RakutenHttpRequest): Promise<RakutenHttpResponse> => {
    calls.push(request);
    return { status: 200, body: priceBody(1) };
  };
  await refreshDueRakutenPrices(database, {
    credentials: { applicationId: APP_ID, accessKey: SECRET },
    limiter: { tryAcquire: () => ({ ok: false, reason: 'wait' }) },
    now: () => new Date(NOW),
    pause: async () => {},
    http,
  });
  await refreshDueRakutenPrices(database, {
    credentials: null,
    limiter: allow(),
    now: () => new Date(NOW),
    pause: async () => {},
    http,
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(row(database, due), { current_price: 198, price_fetched_at: null });
});

test('one failure still lets the next due Rakuten item refresh', async () => {
  const { member, database, add } = await fixture();
  const first = add(member.id, '先', { code: 'rakuten:shop:first', price: 10 });
  const second = add(member.id, '後', { code: 'rakuten:shop:second', price: 20 });
  const calls: string[] = [];
  await refreshDueRakutenPrices(database, {
    credentials: { applicationId: APP_ID, accessKey: SECRET },
    limiter: allow(),
    now: () => new Date(NOW),
    pause: async () => {},
    http: async (request) => {
      const itemCode = new URL(request.url).searchParams.get('itemCode') ?? '';
      calls.push(itemCode);
      if (itemCode === 'shop:first') return { status: 429, body: '{}' };
      return { status: 200, body: JSON.stringify({ items: [{ itemPrice: 21, itemCode }] }) };
    },
  });
  assert.deepEqual(calls, ['shop:first', 'shop:second']);
  assert.deepEqual(row(database, first), { current_price: 10, price_fetched_at: null });
  assert.deepEqual(row(database, second), { current_price: 21, price_fetched_at: NOW });
});

test('the Rakuten price note and fetched time sit next to the price, and the daily job stays off HTML', () => {
  assert.equal(RAKUTEN_PRICE_NOTE, '価格は楽天市場の商品価格です。価格は変動する場合があります。');
  const shown = rakutenPriceCaption({ source_item_code: 'rakuten:shop:milk', price_fetched_at: NOW });
  assert.equal(shown?.note, RAKUTEN_PRICE_NOTE);
  assert.match(shown?.fetchedAt ?? '', /2026/);
  assert.equal(rakutenPriceCaption({ source_item_code: 'yahoo:milk', price_fetched_at: NOW }), null);
  assert.equal(rakutenPriceCaption({ source_item_code: 'rakuten:shop:milk', price_fetched_at: null }), null);
  assert.equal(rakutenPriceCaption({ source_item_code: null, price_fetched_at: NOW }), null);

  const card = readFileSync(join(root, 'src/components/ItemCard.tsx'), 'utf8');
  const budget = readFileSync(join(root, 'src/components/BudgetView.tsx'), 'utf8');
  assert.match(card, /rakutenPriceCaption\(/);
  assert.match(budget, /rakutenPriceCaption\(/);
  const script = readFileSync(join(root, 'scripts/check-prices.ts'), 'utf8');
  const library = readFileSync(join(root, 'src/lib/capture/rakuten-price.ts'), 'utf8');
  assert.match(script, /refreshDueRakutenPrices\(/);
  assert.match(script, /priceCheckItems\(db\)/);
  assert.doesNotMatch(script, /FROM\s+items/i);
  assert.doesNotMatch(library, /scrapeUrl/);
});
