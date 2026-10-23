import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { openDatabase } from '../src/lib/db';
import { CaptureMessages } from '../src/lib/capture/contract';
import {
  candidateRegistration,
  listCaptureCandidateChoices,
  registerCapturedCandidates,
} from '../src/lib/capture/register';
import { POST as registerPost } from '../src/app/api/capture/register/route';
import { priceCheckItems } from '../src/lib/price-check-items';
import type Database from 'better-sqlite3';

const NOW = 1_700_000_000_000;

function count(db: Database.Database, table: string) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function member(db: Database.Database, email: string) {
  return Number(db.prepare(
    "INSERT INTO users (email, name, account_type) VALUES (?, '会員', 'member')",
  ).run(email).lastInsertRowid);
}

function capture(db: Database.Database, userId: number, name = '牛乳') {
  return Number(db.prepare(
    "INSERT INTO captures (user_id, estimated_name, jan, status) VALUES (?, ?, '4901234567894', 'ready')",
  ).run(userId, name).lastInsertRowid);
}

function candidate(
  db: Database.Database,
  userId: number,
  captureId: number,
  overrides: Record<string, unknown> = {},
) {
  const row = {
    source: 'yahoo',
    source_name: 'Yahoo!ショッピング',
    shop_name: 'テストショップ',
    name: "牛乳 '限定'",
    url: 'https://store.shopping.yahoo.co.jp/shop/milk',
    image_url: 'https://store.shopping.yahoo.co.jp/shop/milk.jpg',
    price: 198,
    source_item_code: 'yahoo:milk',
    price_fetched_at: '2026-10-22 12:00:00',
    expires_at: NOW + 60_000,
    ...overrides,
  };
  return Number(db.prepare(
    `INSERT INTO capture_candidates (
      user_id, capture_id, source, source_name, shop_name, name, url, image_url, price, source_item_code, price_fetched_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    captureId,
    row.source,
    row.source_name,
    row.shop_name,
    row.name,
    row.url,
    row.image_url,
    row.price,
    row.source_item_code,
    row.price_fetched_at,
    row.expires_at,
  ).lastInsertRowid);
}

test('register request reads only stored candidate ids and keeps a hand-added item', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'owner@example.com');
    const manualGroup = Number(db.prepare(
      "INSERT INTO comparison_groups (user_id, name, priority) VALUES (?, '手のグループ', 2)",
    ).run(userId).lastInsertRowid);
    const manualId = Number(db.prepare(
      `INSERT INTO items (user_id, name, url, current_price, source, comparison_group_id, quantity, priority)
       VALUES (?, '手で登録', 'https://example.com/kept', 4200, 'rakuten', ?, 2, 4)`,
    ).run(userId, manualGroup).lastInsertRowid);
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 4200)').run(manualId);
    const before = db.prepare(
      'SELECT name, url, current_price, source, source_item_code, comparison_group_id, quantity, priority FROM items WHERE id = ?',
    ).get(manualId);

    const captureId = capture(db, userId);
    const yahooId = candidate(db, userId, captureId);
    const rakutenId = candidate(db, userId, captureId, {
      source: 'rakuten',
      source_name: '楽天',
      shop_name: 'テスト楽天店',
      name: '牛乳 楽天',
      url: 'https://item.rakuten.co.jp/shop/milk',
      image_url: 'https://example.com/not-a-store-image.jpg',
      price: 220,
      source_item_code: 'rakuten:shop:milk',
    });

    const saved = registerCapturedCandidates(db, userId, [rakutenId, yahooId], NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.created, true);
    assert.equal(saved.itemIds.length, 2);
    assert.deepEqual(saved.skipped, []);

    const group = db.prepare(
      'SELECT user_id, name, priority, origin, capture_id, budget_item_id FROM comparison_groups WHERE id = ?',
    ).get(saved.comparisonGroupId) as {
      user_id: number;
      name: string;
      priority: number;
      origin: string;
      capture_id: number;
      budget_item_id: number | null;
    };
    assert.equal(group.user_id, userId);
    assert.equal(group.name, '牛乳');
    assert.equal(group.priority, 3);
    assert.equal(group.origin, 'photo');
    assert.equal(group.capture_id, captureId);
    assert.equal(group.budget_item_id, null);

    const linked = db.prepare('SELECT status, comparison_group_id FROM captures WHERE id = ?').get(captureId) as {
      status: string;
      comparison_group_id: number;
    };
    assert.equal(linked.status, 'registered');
    assert.equal(linked.comparison_group_id, saved.comparisonGroupId);

    const items = db.prepare(
      `SELECT id, name, url, image_url, current_price, original_price, source, source_name, source_item_code,
              price_fetched_at, priority, quantity, comparison_group_id, category_id, planned_purchase_date, sort_order
       FROM items WHERE comparison_group_id = ? ORDER BY sort_order, id`,
    ).all(saved.comparisonGroupId) as {
      id: number;
      name: string;
      url: string;
      image_url: string | null;
      current_price: number;
      original_price: number;
      source: string;
      source_name: string;
      source_item_code: string;
      price_fetched_at: string;
      priority: number;
      quantity: number;
      comparison_group_id: number;
      category_id: number | null;
      planned_purchase_date: string | null;
      sort_order: number;
    }[];
    assert.deepEqual(items.map((item) => item.id), saved.itemIds);
    assert.equal(items[0].source, 'rakuten');
    assert.equal(items[0].source_name, '楽天');
    assert.equal(items[0].source_item_code, 'rakuten:shop:milk');
    assert.equal(items[0].url, 'https://item.rakuten.co.jp/shop/milk');
    assert.equal(items[0].name, '牛乳 楽天');
    assert.equal(items[0].image_url, null);
    assert.equal(items[0].current_price, 220);
    assert.equal(items[0].original_price, 220);
    assert.equal(items[1].source, 'yahoo');
    assert.equal(items[1].source_name, 'Yahoo!ショッピング');
    assert.equal(items[1].source_item_code, 'yahoo:milk');
    assert.equal(items[1].name, "牛乳 '限定'");
    assert.equal(items[1].image_url, null);
    assert.equal(items[1].current_price, 198);
    for (const item of items) {
      assert.equal(item.price_fetched_at, '2026-10-22 12:00:00');
      assert.equal(item.priority, 3);
      assert.equal(item.quantity, 1);
      assert.equal(item.comparison_group_id, saved.comparisonGroupId);
      assert.equal(item.category_id, null);
      assert.equal(item.planned_purchase_date, null);
    }
    assert.deepEqual(items.map((item) => item.sort_order), [0, 1]);
    assert.equal(count(db, 'price_history'), 3);

    const again = registerCapturedCandidates(db, userId, [rakutenId, yahooId], NOW);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.comparisonGroupId, saved.comparisonGroupId);
    assert.deepEqual(again.itemIds, saved.itemIds);
    assert.equal(count(db, 'comparison_groups'), 2);
    assert.equal(count(db, 'items'), 3);
    assert.equal(count(db, 'price_history'), 3);

    db.prepare('UPDATE capture_candidates SET expires_at = ? WHERE capture_id = ?').run(NOW - 1, captureId);
    const expiredReplay = registerCapturedCandidates(db, userId, [rakutenId, yahooId], NOW);
    assert.equal(expiredReplay.ok, true);
    if (!expiredReplay.ok) return;
    assert.equal(expiredReplay.created, false);
    assert.equal(expiredReplay.comparisonGroupId, saved.comparisonGroupId);

    const manualAfter = db.prepare(
      'SELECT name, url, current_price, source, source_item_code, comparison_group_id, quantity, priority FROM items WHERE id = ?',
    ).get(manualId);
    assert.deepEqual(manualAfter, before);
    const manualGroupRow = db.prepare('SELECT origin, capture_id, budget_item_id FROM comparison_groups WHERE id = ?').get(manualGroup) as {
      origin: string | null;
      capture_id: number | null;
      budget_item_id: number | null;
    };
    assert.equal(manualGroupRow.origin, null);
    assert.equal(manualGroupRow.capture_id, null);
    assert.equal(manualGroupRow.budget_item_id, null);
    const checked = (priceCheckItems(db) as { id: number }[]).map((row) => row.id);
    assert.equal(checked.includes(manualId), true);

    const secondCapture = capture(db, userId, '別の商品');
    const secondCandidate = candidate(db, userId, secondCapture, {
      url: 'https://store.shopping.yahoo.co.jp/shop/bread',
      source_item_code: 'yahoo:bread',
      name: 'パン',
    });
    const second = registerCapturedCandidates(db, userId, [secondCandidate], NOW);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.created, true);
    assert.notEqual(second.comparisonGroupId, saved.comparisonGroupId);
    assert.equal(count(db, 'comparison_groups'), 3);
  } finally {
    db.close();
  }
});

test('a second press does not add candidates that were left out of the first group', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'once@example.com');
    const captureId = capture(db, userId);
    const first = candidate(db, userId, captureId, { url: 'https://store.shopping.yahoo.co.jp/shop/a', source_item_code: 'yahoo:a' });
    const extra = candidate(db, userId, captureId, { url: 'https://store.shopping.yahoo.co.jp/shop/b', source_item_code: 'yahoo:b' });
    const saved = registerCapturedCandidates(db, userId, [first], NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const replay = registerCapturedCandidates(db, userId, [first, extra], NOW);
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.created, false);
    assert.deepEqual(replay.itemIds, saved.itemIds);
    assert.equal(count(db, 'comparison_groups'), 1);
    assert.equal(count(db, 'items'), 1);
  } finally {
    db.close();
  }
});

test("another user's candidates are not registered", () => {
  const db = openDatabase(':memory:');
  try {
    const owner = member(db, 'owner-secret@example.com');
    const stranger = member(db, 'stranger@example.com');
    const ownCapture = capture(db, owner, '自分の商品');
    const foreignCapture = capture(db, stranger, '他人の商品名');
    const ownId = candidate(db, owner, ownCapture, {
      url: 'https://store.shopping.yahoo.co.jp/shop/own',
      source_item_code: 'yahoo:own',
      name: '自分の候補',
    });
    const foreignId = candidate(db, stranger, foreignCapture, {
      url: 'https://store.shopping.yahoo.co.jp/shop/secret',
      source_item_code: 'yahoo:secret',
      name: '他人の候補',
    });

    const rejected = registerCapturedCandidates(db, owner, [foreignId], NOW);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.status, 404);
    assert.equal(rejected.error.code, 'CANDIDATE_NOT_FOUND');
    assert.equal(rejected.error.error, '候補が見つかりません');
    assert.equal(JSON.stringify(rejected).includes('他人の候補'), false);
    assert.equal(JSON.stringify(rejected).includes('owner-secret@example.com'), false);
    assert.equal(count(db, 'items'), 0);
    assert.equal(count(db, 'comparison_groups'), 0);

    const mixed = registerCapturedCandidates(db, owner, [ownId, foreignId], NOW);
    assert.equal(mixed.ok, false);
    if (!mixed.ok) assert.equal(mixed.status, 404);
    assert.equal(count(db, 'items'), 0);
    assert.equal(count(db, 'comparison_groups'), 0);

    const missing = registerCapturedCandidates(db, owner, [ownId, 999_999], NOW);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.status, 404);
      assert.equal(missing.error.code, 'CANDIDATE_NOT_FOUND');
    }
    assert.equal(count(db, 'items'), 0);
  } finally {
    db.close();
  }
});

test('expired, unsafe, and mixed-capture candidates are not registered', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'limits@example.com');
    const captureId = capture(db, userId);
    const expiredId = candidate(db, userId, captureId, { expires_at: NOW, url: 'https://store.shopping.yahoo.co.jp/shop/old' });
    const expired = registerCapturedCandidates(db, userId, [expiredId], NOW);
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.status, 404);
    assert.equal(count(db, 'items'), 0);

    const unsafeId = candidate(db, userId, captureId, {
      url: 'http://127.0.0.1/milk',
      source_item_code: 'yahoo:local',
    });
    const unsafe = registerCapturedCandidates(db, userId, [unsafeId], NOW);
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.status, 404);
    assert.equal(count(db, 'items'), 0);

    const otherCapture = capture(db, userId, '別撮影');
    const left = candidate(db, userId, captureId, { url: 'https://store.shopping.yahoo.co.jp/shop/left', source_item_code: 'yahoo:left' });
    const right = candidate(db, userId, otherCapture, { url: 'https://store.shopping.yahoo.co.jp/shop/right', source_item_code: 'yahoo:right' });
    const mixed = registerCapturedCandidates(db, userId, [left, right], NOW);
    assert.equal(mixed.ok, false);
    if (!mixed.ok) {
      assert.equal(mixed.status, 400);
      assert.equal(mixed.error.code, 'INVALID_INPUT');
      assert.equal(mixed.error.error, CaptureMessages.registerInput);
    }
    assert.equal(count(db, 'comparison_groups'), 0);
  } finally {
    db.close();
  }
});

for (const [label, flags] of [
  ['active item', { purchased: 0, deleted: null }],
  ['purchased item', { purchased: 1, deleted: null }],
  ['trashed item', { purchased: 0, deleted: '2026-10-01 00:00:00' }],
] as const) {
  test(`a candidate for an existing ${label} is marked 登録済み and cannot be selected`, () => {
    const db = openDatabase(':memory:');
    try {
      const userId = member(db, `${label}@example.com`);
      const url = 'https://store.shopping.yahoo.co.jp/shop/kept';
      db.prepare(
        'INSERT INTO items (user_id, name, url, is_purchased, deleted_at) VALUES (?, ?, ?, ?, ?)',
      ).run(userId, '既存', url, flags.purchased, flags.deleted);
      const captureId = capture(db, userId);
      const candidateId = candidate(db, userId, captureId, { url, source_item_code: 'yahoo:kept' });
      assert.deepEqual(candidateRegistration(db, userId, url), { selectable: false, label: '登録済み' });
      const listed = listCaptureCandidateChoices(db, userId, captureId, NOW);
      assert.deepEqual(listed, [{ id: candidateId, selectable: false, label: '登録済み' }]);
      const result = registerCapturedCandidates(db, userId, [candidateId], NOW);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 409);
      assert.equal(result.error.code, 'ALREADY_REGISTERED');
      assert.equal(result.error.error, '登録済み');
      assert.deepEqual(result.error.skipped, [{ candidateId, code: 'ALREADY_REGISTERED', error: '登録済み' }]);
      assert.equal(count(db, 'comparison_groups'), 0);
      assert.equal(count(db, 'items'), 1);
    } finally {
      db.close();
    }
  });
}

test('the same url on another account stays selectable', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'buyer@example.com');
    const other = member(db, 'other-buyer@example.com');
    const url = 'https://store.shopping.yahoo.co.jp/shop/shared';
    db.prepare('INSERT INTO items (user_id, name, url) VALUES (?, ?, ?)').run(other, '他人の商品', url);
    assert.deepEqual(candidateRegistration(db, userId, url), { selectable: true, label: null });
    const captureId = capture(db, userId);
    const candidateId = candidate(db, userId, captureId, { url, source_item_code: 'yahoo:shared' });
    const saved = registerCapturedCandidates(db, userId, [candidateId], NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.itemIds.length, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(other) as { n: number }).n, 1);
  } finally {
    db.close();
  }
});

test('two chosen candidates with one url create a single item', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'dup@example.com');
    const captureId = capture(db, userId);
    const url = 'https://store.shopping.yahoo.co.jp/shop/same';
    const first = candidate(db, userId, captureId, { url, source_item_code: 'yahoo:same-1', name: '同じ牛乳' });
    const second = candidate(db, userId, captureId, { url, source_item_code: 'yahoo:same-2', name: '同じ牛乳 2' });
    const saved = registerCapturedCandidates(db, userId, [first, second], NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.itemIds.length, 1);
    assert.deepEqual(saved.skipped, [{ candidateId: second, code: 'ALREADY_REGISTERED', error: '登録済み' }]);
    const after = listCaptureCandidateChoices(db, userId, captureId, NOW);
    assert.deepEqual(after, [
      { id: first, selectable: false, label: '登録済み' },
      { id: second, selectable: false, label: '登録済み' },
    ]);
    assert.equal(count(db, 'items'), 1);
    assert.equal(count(db, 'comparison_groups'), 1);
  } finally {
    db.close();
  }
});

test('candidate ids that are not table ids are rejected', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'shape@example.com');
    const captureId = capture(db, userId);
    candidate(db, userId, captureId);
    for (const input of [
      [],
      ['yahoo:milk'],
      [1, 1],
      [0],
      [-1],
      [1.5],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
    ]) {
      const result = registerCapturedCandidates(db, userId, input, NOW);
      assert.equal(result.ok, false, JSON.stringify(input));
      if (!result.ok) {
        assert.equal(result.status, 400);
        assert.equal(result.error.code, 'INVALID_INPUT');
        assert.equal(result.error.error, CaptureMessages.registerInput);
      }
    }
    assert.equal(count(db, 'items'), 0);
    const guest = Number(db.prepare(
      "INSERT INTO users (email, account_type) VALUES ('guest@guest.invalid', 'guest')",
    ).run().lastInsertRowid);
    const denied = registerCapturedCandidates(db, guest, [1], NOW);
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.status, 403);
      assert.equal(denied.error.error, 'この機能はログイン後に利用できます');
    }
  } finally {
    db.close();
  }
});

test('registration does not fetch store pages', () => {
  const source = readFileSync(new URL('../src/lib/capture/register.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/capture/register/route.ts', import.meta.url), 'utf8');
  for (const text of [source, route]) {
    assert.equal(text.includes('scrapeUrl'), false);
    assert.equal(text.includes('fetch('), false);
    assert.equal(text.includes('shopping.yahooapis'), false);
    assert.equal(text.includes('openapi.rakuten'), false);
  }
  assert.equal(route.includes('withCapture'), true);
});

function withFlags(value: string | undefined, fn: () => Promise<void>) {
  const previous = process.env.CAPTURE_ENABLED;
  if (value === undefined) delete process.env.CAPTURE_ENABLED;
  else process.env.CAPTURE_ENABLED = value;
  return fn().finally(() => {
    if (previous === undefined) delete process.env.CAPTURE_ENABLED;
    else process.env.CAPTURE_ENABLED = previous;
  });
}

test('the register route stays closed unless CAPTURE_ENABLED is exactly true', async () => {
  const request = new NextRequest('http://127.0.0.1/api/capture/register', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1', 'content-type': 'application/json' },
    body: JSON.stringify({ candidateIds: [1] }),
  });
  await withFlags(undefined, async () => {
    const response = await registerPost(request);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.code, 'CAPTURE_DISABLED');
    assert.equal(body.error, 'この機能は利用できません');
    assert.equal(JSON.stringify(body).includes('CAPTURE_ENABLED'), false);
  });
  await withFlags('false', async () => {
    const response = await registerPost(request);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'CAPTURE_DISABLED');
  });
  await withFlags('true', async () => {
    let status: number | undefined;
    try {
      status = (await registerPost(request)).status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes('CAPTURE_ENABLED'), false);
      assert.equal(message.includes('この機能は利用できません'), false);
      return;
    }
    assert.notEqual(status, 404);
  });
});

test('register keeps a provider image host and drops product-page and http images', () => {
  const db = openDatabase(':memory:');
  try {
    const userId = member(db, 'image@example.com');
    const captureId = capture(db, userId, 'Belkin 電源アダプタ');
    const yahooId = candidate(db, userId, captureId, {
      name: 'Belkin 電源アダプタ',
      url: 'https://store.shopping.yahoo.co.jp/shop/belkin',
      image_url: 'https://item-shopping.c.yimg.jp/i/g/belkin',
      source_item_code: 'yahoo:belkin',
    });
    const pageImageId = candidate(db, userId, captureId, {
      name: '商品ページの画像',
      url: 'https://store.shopping.yahoo.co.jp/shop/page',
      image_url: 'https://store.shopping.yahoo.co.jp/shop/belkin.jpg',
      source_item_code: 'yahoo:page',
    });
    const httpId = candidate(db, userId, captureId, {
      name: 'httpの画像',
      url: 'https://store.shopping.yahoo.co.jp/shop/http',
      image_url: 'http://item-shopping.c.yimg.jp/i/g/belkin',
      source_item_code: 'yahoo:http',
    });
    const saved = registerCapturedCandidates(db, userId, [yahooId, pageImageId, httpId], NOW);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const images = db.prepare(
      'SELECT source_item_code, image_url FROM items WHERE comparison_group_id = ? ORDER BY sort_order, id',
    ).all(saved.comparisonGroupId) as { source_item_code: string; image_url: string | null }[];
    assert.deepEqual(images, [
      { source_item_code: 'yahoo:belkin', image_url: 'https://item-shopping.c.yimg.jp/i/g/belkin' },
      { source_item_code: 'yahoo:page', image_url: null },
      { source_item_code: 'yahoo:http', image_url: null },
    ]);
  } finally {
    db.close();
  }
});
