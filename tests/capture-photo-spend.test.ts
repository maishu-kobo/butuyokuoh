import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, createMember, db, setTestUser } from './regression-harness';
import {
  EXCLUDED_FROM_TOTAL_LABEL,
  idsForSelectAll,
  moneyTotals,
  photoSpendDecisions,
  sumCountedPrices,
  type SpendGroup,
  type SpendItem,
} from '../src/lib/photo-spend';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const budgetRoute = '../src/app/api/budget/route.ts';
const statsRoute = '../src/app/api/stats/route.ts';
const itemsRoute = '../src/app/api/items/route.ts';
const groupRoute = '../src/app/api/comparison-groups/[id]/route.ts';

function item(partial: Partial<SpendItem> & Pick<SpendItem, 'id'>): SpendItem {
  return {
    userId: 1,
    price: 0,
    quantity: 1,
    purchased: false,
    deleted: false,
    groupId: null,
    ...partial,
  };
}

function group(partial: Partial<SpendGroup> & Pick<SpendGroup, 'id'>): SpendGroup {
  return { userId: 1, origin: 'photo', budgetItemId: null, ...partial };
}

function amounts(rows: SpendItem[], groups: SpendGroup[]) {
  const decisions = photoSpendDecisions(rows, groups);
  return rows.map((row) => {
    const decision = decisions.get(row.id);
    return { id: row.id, counts: decision?.countsInTotal, label: decision?.totalLabel, amount: decision?.amount };
  });
}

test('manual groups and ungrouped items all count, with no excluded label', () => {
  assert.equal(EXCLUDED_FROM_TOTAL_LABEL, '合計に含まない');
  const rows = [
    item({ id: 1, price: 400, quantity: 2, groupId: 7 }),
    item({ id: 2, price: 50, groupId: 7 }),
    item({ id: 3, price: null }),
    item({ id: 4, price: 10, quantity: 0 }),
  ];
  assert.deepEqual(amounts(rows, [group({ id: 7, origin: null, budgetItemId: 2 })]), [
    { id: 1, counts: true, label: null, amount: 800 },
    { id: 2, counts: true, label: null, amount: 50 },
    { id: 3, counts: true, label: null, amount: 0 },
    { id: 4, counts: true, label: null, amount: 10 },
  ]);
  assert.deepEqual(moneyTotals(rows, photoSpendDecisions(rows, [])), { wishlistTotal: 860, purchasedTotal: 0 });
});

test('a photo group counts the cheapest unpurchased item, and the same price keeps the smaller id', () => {
  const rows = [
    item({ id: 11, price: 300, groupId: 1 }),
    item({ id: 12, price: 100, quantity: 3, groupId: 1 }),
    item({ id: 13, price: 100, groupId: 1 }),
  ];
  assert.deepEqual(amounts(rows, [group({ id: 1 })]), [
    { id: 11, counts: false, label: '合計に含まない', amount: 0 },
    { id: 12, counts: true, label: null, amount: 300 },
    { id: 13, counts: false, label: '合計に含まない', amount: 0 },
  ]);
});

test('a null price does not beat a known price, and all-null keeps the smaller id at zero', () => {
  const known = [
    item({ id: 1, price: null, groupId: 1 }),
    item({ id: 2, price: 200, groupId: 1 }),
  ];
  assert.equal(amounts(known, [group({ id: 1 })]).find((row) => row.counts)?.id, 2);

  const unknown = [
    item({ id: 5, price: null, groupId: 1 }),
    item({ id: 4, price: null, groupId: 1 }),
  ];
  assert.deepEqual(amounts(unknown, [group({ id: 1 })]), [
    { id: 5, counts: false, label: '合計に含まない', amount: 0 },
    { id: 4, counts: true, label: null, amount: 0 },
  ]);
});

test('the saved budget candidate counts when nobody in the photo group is purchased', () => {
  const rows = [
    item({ id: 1, price: 300, groupId: 1 }),
    item({ id: 2, price: 100, groupId: 1 }),
  ];
  assert.deepEqual(amounts(rows, [group({ id: 1, budgetItemId: 1 })]), [
    { id: 1, counts: true, label: null, amount: 300 },
    { id: 2, counts: false, label: '合計に含まない', amount: 0 },
  ]);
});

test('purchased photo items all count and the saved candidate does not bring the others back', () => {
  const rows = [
    item({ id: 1, price: 500, purchased: true, groupId: 1 }),
    item({ id: 2, price: 200, purchased: true, groupId: 1 }),
    item({ id: 3, price: 9000, groupId: 1 }),
  ];
  const decisions = photoSpendDecisions(rows, [group({ id: 1, budgetItemId: 3 })]);
  assert.deepEqual(amounts(rows, [group({ id: 1, budgetItemId: 3 })]), [
    { id: 1, counts: true, label: null, amount: 500 },
    { id: 2, counts: true, label: null, amount: 200 },
    { id: 3, counts: false, label: '合計に含まない', amount: 0 },
  ]);
  assert.deepEqual(moneyTotals(rows, decisions), { wishlistTotal: 0, purchasedTotal: 700 });
});

test('trashed rows do not count and do not decide the photo group', () => {
  const rows = [
    item({ id: 1, price: 10, deleted: true, groupId: 1 }),
    item({ id: 2, price: 10, purchased: true, deleted: true, groupId: 1 }),
    item({ id: 3, price: 200, groupId: 1 }),
    item({ id: 4, price: 400, groupId: 1 }),
  ];
  assert.deepEqual(amounts(rows, [group({ id: 1, budgetItemId: 1 })]), [
    { id: 1, counts: false, label: null, amount: 0 },
    { id: 2, counts: false, label: null, amount: 0 },
    { id: 3, counts: true, label: null, amount: 200 },
    { id: 4, counts: false, label: '合計に含まない', amount: 0 },
  ]);
});

test('another user photo group does not change this user item', () => {
  const rows = [item({ id: 1, userId: 2, price: 80, groupId: 9 })];
  assert.deepEqual(amounts(rows, [group({ id: 9, userId: 1, budgetItemId: 1 })]), [
    { id: 1, counts: true, label: null, amount: 80 },
  ]);
});

test('select-all keeps every manual id and only the counted photo id', () => {
  assert.deepEqual(idsForSelectAll([
    { id: 1 },
    { id: 2, countsInTotal: true },
    { id: 3, countsInTotal: false },
    { id: 4, countsInTotal: true },
  ]), [1, 2, 4]);
  assert.equal(sumCountedPrices([
    { current_price: 100, quantity: 2 },
    { current_price: 900, quantity: 1, countsInTotal: false },
    { current_price: null, quantity: 1, countsInTotal: true },
  ]), 200);
});

test('the counted photo item month is the only month that receives its price', async () => {
  const owner = await createMember('spend-month');
  const other = await createMember('spend-month-other');
  const database = await db();
  const photo = Number(database.prepare(
    `INSERT INTO comparison_groups (user_id, name, origin, budget_item_id) VALUES (?, '牛乳', 'photo', NULL)`,
  ).run(owner.id).lastInsertRowid);
  const manualGroup = Number(database.prepare(
    `INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '手入力', NULL)`,
  ).run(owner.id).lastInsertRowid);
  const theirs = Number(database.prepare(
    `INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '他人', 'photo')`,
  ).run(other.id).lastInsertRowid);
  const add = (
    userId: number,
    name: string,
    price: number | null,
    date: string | null,
    fields: { groupId?: number; quantity?: number; source?: string; sourceName?: string; purchased?: number; deleted?: boolean } = {},
  ) => Number(database.prepare(`
    INSERT INTO items (
      user_id, name, url, current_price, quantity, planned_purchase_date, comparison_group_id,
      source, source_name, is_purchased, deleted_at, priority
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3)
  `).run(
    userId, name, `manual://${userId}-${name}`, price, fields.quantity ?? 1, date, fields.groupId ?? null,
    fields.source ?? 'other', fields.sourceName ?? null, fields.purchased ?? 0, fields.deleted ? '2026-01-01 00:00:00' : null,
  ).lastInsertRowid);

  const cheapId = add(owner.id, '安い牛乳', 100, '2026-10-02', { groupId: photo, source: 'yahoo', sourceName: 'Yahoo!ショッピング' });
  const dearId = add(owner.id, '高い牛乳', 900, '2026-11-03', { groupId: photo, source: 'rakuten', sourceName: '楽天' });
  add(owner.id, '鉛筆', 50, '2026-10-01');
  add(owner.id, '手帳', 40, '2026-11-01', { groupId: manualGroup });
  add(owner.id, 'いつか', 2000, null, { groupId: photo, source: 'rakuten', sourceName: '楽天' });
  add(owner.id, '捨てた安い', 1, '2026-10-04', { groupId: photo, deleted: true });
  add(other.id, '他人の牛乳', 1, '2026-10-01', { groupId: theirs });

  await setTestUser(owner);
  const previous = process.env.CAPTURE_ENABLED;
  try {
    for (const flag of [undefined, 'false', 'true'] as const) {
      if (flag === undefined) delete process.env.CAPTURE_ENABLED;
      else process.env.CAPTURE_ENABLED = flag;
      const response = await call(budgetRoute, 'GET', '/api/budget');
      assert.equal(response.status, 200);
      const body = response.json as Record<string, { total: number; items: { id: number; name: string; totalLabel: string | null; countsInTotal: boolean; group_origin: string | null }[] }>;
      assert.equal(body['2026-10'].total, 150);
      assert.deepEqual(body['2026-10'].items.map((row) => row.name), ['鉛筆', '安い牛乳']);
      assert.equal(body['2026-10'].items.find((row) => row.id === cheapId)?.totalLabel, null);
      assert.equal(body['2026-10'].items.find((row) => row.id === cheapId)?.countsInTotal, true);
      assert.equal(body['2026-11'].total, 40);
      const dear = body['2026-11'].items.find((row) => row.id === dearId);
      assert.equal(dear?.totalLabel, '合計に含まない');
      assert.equal(dear?.countsInTotal, false);
      assert.equal(dear?.group_origin, 'photo');
      assert.equal(body.undated.total, 0);
      assert.equal(body.undated.items.find((row) => row.name === 'いつか')?.totalLabel, '合計に含まない');
      assert.equal(body['2026-10'].items.some((row) => row.name === '捨てた安い' || row.name === '他人の牛乳'), false);
    }
  } finally {
    if (previous === undefined) delete process.env.CAPTURE_ENABLED;
    else process.env.CAPTURE_ENABLED = previous;
  }

  const saved = await call(groupRoute, 'PUT', `/api/comparison-groups/${photo}`, { budgetItemId: dearId }, { id: String(photo) });
  assert.equal(saved.status, 200);
  assert.equal((saved.json as { budget_item_id: number; name: string }).budget_item_id, dearId);
  const chosen = await call(budgetRoute, 'GET', '/api/budget');
  const chosenBody = chosen.json as Record<string, { total: number; items: { id: number; totalLabel: string | null }[] }>;
  assert.equal(chosenBody['2026-10'].total, 50);
  assert.equal(chosenBody['2026-10'].items.find((row) => row.id === cheapId)?.totalLabel, '合計に含まない');
  assert.equal(chosenBody['2026-11'].total, 940);
  assert.equal(chosenBody['2026-11'].items.find((row) => row.id === dearId)?.totalLabel, null);

  const renamed = await call(groupRoute, 'PUT', `/api/comparison-groups/${photo}`, { name: '牛乳パック', priority: 1 }, { id: String(photo) });
  assert.equal(renamed.status, 200);
  assert.equal((renamed.json as { name: string; priority: number; budget_item_id: number }).name, '牛乳パック');
  assert.equal((renamed.json as { priority: number }).priority, 1);
  assert.equal((renamed.json as { budget_item_id: number }).budget_item_id, dearId);

  const cleared = await call(groupRoute, 'PUT', `/api/comparison-groups/${photo}`, { budgetItemId: null }, { id: String(photo) });
  assert.equal(cleared.status, 200);
  assert.equal((cleared.json as { budget_item_id: number | null }).budget_item_id, null);
  assert.equal((await call(budgetRoute, 'GET', '/api/budget')).json['2026-10'].total, 150);

  await setTestUser(other);
  assert.equal((await call(groupRoute, 'PUT', `/api/comparison-groups/${photo}`, { budgetItemId: dearId }, { id: String(photo) })).status, 404);
  await setTestUser(owner);
  const outsider = add(owner.id, '別の商品', 20, '2026-12-01');
  assert.equal((await call(groupRoute, 'PUT', `/api/comparison-groups/${photo}`, { budgetItemId: outsider }, { id: String(photo) })).status, 400);
  assert.equal((await call(groupRoute, 'PUT', `/api/comparison-groups/${manualGroup}`, { budgetItemId: outsider }, { id: String(manualGroup) })).status, 400);
  assert.equal((await call(groupRoute, 'PUT', '/api/comparison-groups/999999', { budgetItemId: cheapId }, { id: '999999' })).status, 404);
  assert.equal(database.prepare('SELECT budget_item_id FROM comparison_groups WHERE id = ?').get(photo), { budget_item_id: null });
  assert.equal(database.prepare('SELECT budget_item_id FROM comparison_groups WHERE id = ?').get(manualGroup), { budget_item_id: null });
});

test('stats money totals follow the photo rule and the breakdowns stay on the old sums', async () => {
  const owner = await createMember('spend-stats');
  const database = await db();
  database.prepare(`INSERT INTO categories (user_id, name, color) VALUES (?, '本', '#112233')`).run(owner.id);
  const categoryId = (database.prepare('SELECT id FROM categories WHERE user_id = ?').get(owner.id) as { id: number }).id;
  const photo = Number(database.prepare(
    `INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '写真の本', 'photo')`,
  ).run(owner.id).lastInsertRowid);
  const boughtGroup = Number(database.prepare(
    `INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, '買った写真', 'photo')`,
  ).run(owner.id).lastInsertRowid);
  const add = (name: string, price: number | null, fields: { purchased?: number; groupId?: number; category?: boolean; source?: string } = {}) => {
    database.prepare(`
      INSERT INTO items (user_id, name, url, current_price, quantity, is_purchased, source, priority, category_id, comparison_group_id, purchased_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, 3, ?, ?, ?)
    `).run(
      owner.id, name, `manual://${name}`, price, fields.purchased ?? 0, fields.source ?? 'other',
      fields.category ? categoryId : null, fields.groupId ?? null, fields.purchased ? '2026-09-02' : null,
    );
  };
  add('wish-book', 1200, { category: true, source: 'amazon' });
  add('photo-dear', 900, { groupId: photo, category: true, source: 'rakuten' });
  add('photo-cheap', 100, { groupId: photo, source: 'yahoo' });
  add('photo-left', 8000, { groupId: boughtGroup, source: 'yahoo' });
  add('photo-bought', 500, { groupId: boughtGroup, purchased: 1 });
  add('bought', 3000, { purchased: 1, source: 'other' });

  await setTestUser(owner);
  const response = await call(statsRoute, 'GET', '/api/stats');
  assert.equal(response.status, 200);
  const body = response.json as {
    overview: { wishlistCount: number; purchasedCount: number; wishlistTotal: number; purchasedTotal: number };
    byCategory: { category_name: string; count: number; total: number }[];
    bySource: { source: string; count: number; total: number }[];
    monthlyPurchased: { month: string; count: number; total: number }[];
  };
  assert.equal(body.overview.wishlistCount, 4);
  assert.equal(body.overview.purchasedCount, 2);
  assert.equal(body.overview.wishlistTotal, 1300);
  assert.equal(body.overview.purchasedTotal, 3500);
  assert.equal(body.byCategory.find((row) => row.category_name === '本')?.count, 2);
  assert.equal(body.byCategory.find((row) => row.category_name === '本')?.total, 2100);
  assert.equal(body.bySource.find((row) => row.source === 'rakuten')?.total, 900);
  assert.deepEqual(body.monthlyPurchased, [{ month: '2026-09', count: 2, total: 3500 }]);

  const listed = await call(itemsRoute, 'GET', '/api/items');
  const rows = listed.json as { name: string; countsInTotal: boolean; totalLabel: string | null }[];
  assert.equal(rows.find((row) => row.name === 'photo-cheap')?.countsInTotal, true);
  assert.equal(rows.find((row) => row.name === 'photo-cheap')?.totalLabel, null);
  assert.equal(rows.find((row) => row.name === 'photo-dear')?.countsInTotal, false);
  assert.equal(rows.find((row) => row.name === 'photo-dear')?.totalLabel, '合計に含まない');
  assert.equal(rows.find((row) => row.name === 'wish-book')?.countsInTotal, true);
  assert.equal(rows.find((row) => row.name === 'wish-book')?.totalLabel, null);
  assert.equal(rows.find((row) => row.name === 'photo-left')?.countsInTotal, false);
  assert.equal(rows.find((row) => row.name === 'photo-left')?.totalLabel, '合計に含まない');
});

test('the three screens use the server decision and the budget screen saves one candidate', () => {
  const budget = readFileSync(join(root, 'src/app/api/budget/route.ts'), 'utf8');
  const stats = readFileSync(join(root, 'src/app/api/stats/route.ts'), 'utf8');
  const items = readFileSync(join(root, 'src/app/api/items/route.ts'), 'utf8');
  const page = readFileSync(join(root, 'src/app/page.tsx'), 'utf8');
  const card = readFileSync(join(root, 'src/components/ItemCard.tsx'), 'utf8');
  const view = readFileSync(join(root, 'src/components/BudgetView.tsx'), 'utf8');
  for (const source of [budget, stats, items]) {
    assert.match(source, /photoSpendDecisions\(/);
  }
  assert.match(page, /sumCountedPrices\(/);
  assert.match(card, /totalLabel/);
  assert.match(view, /idsForSelectAll\(/);
  assert.match(view, /budgetItemId/);
  assert.match(view, /合計に含まない/);
});
