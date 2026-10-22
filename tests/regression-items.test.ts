import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db, setTestUser } from './regression-harness';

const items = '../src/app/api/items/route.ts';
const item = '../src/app/api/items/[id]/route.ts';
const categories = '../src/app/api/categories/route.ts';
const category = '../src/app/api/categories/[id]/route.ts';
const groups = '../src/app/api/comparison-groups/route.ts';
const group = '../src/app/api/comparison-groups/[id]/route.ts';
const trash = '../src/app/api/trash/route.ts';
const trashItem = '../src/app/api/trash/[id]/route.ts';
const purchased = '../src/app/api/purchased/route.ts';

type Item = {
  id: number;
  name: string;
  url: string;
  current_price: number | null;
  priority: number;
  quantity: number;
  sort_order: number;
  source: string;
  is_purchased: number;
  purchased_at: string | null;
  previous_price: number | null;
  category_id: number | null;
  comparison_group_id: number | null;
  deleted_at: string | null;
};

test('manual add, edit, reorder, purchase, and previous price stay inside one account', async () => {
  const owner = await createMember('owner');
  const other = await createMember('other');
  await setTestUser(owner);

  const missingName = await call(items, 'POST', '/api/items', { manual: true });
  assert.equal(missingName.status, 400);

  const free = await call(items, 'POST', '/api/items', { manual: true, name: '無料', price: 0 });
  assert.equal(free.status, 201);
  assert.equal((free.json as Item).current_price, null);

  const first = await call(items, 'POST', '/api/items', {
    manual: true, name: 'キーボード', url: 'manual://keyboard', price: 1000, priority: 1, quantity: 2,
    planned_purchase_date: '2026-10-01', notes: '赤軸',
  });
  assert.equal(first.status, 201);
  const created = first.json as Item;
  assert.equal(created.name, 'キーボード');
  assert.equal(created.current_price, 1000);
  assert.equal(created.priority, 1);
  assert.equal(created.quantity, 2);
  assert.equal(created.source, 'other');
  assert.equal(created.url, 'manual://keyboard');

  const duplicate = await call(items, 'POST', '/api/items', { manual: true, name: 'もう一個', url: 'manual://keyboard', price: 1 });
  assert.equal(duplicate.status, 409);

  const urlDuplicate = await call(items, 'POST', '/api/items', { url: 'manual://keyboard' });
  assert.equal(urlDuplicate.status, 400);
  assert.match(urlDuplicate.text, /既に登録/);

  const noUrl = await call(items, 'POST', '/api/items', {});
  assert.equal(noUrl.status, 400);

  const second = await call(items, 'POST', '/api/items', {
    manual: true, name: 'マウス', price: 500, priority: 3, sort_order: 0,
  });
  const mouse = second.json as Item;
  assert.equal(second.status, 201);
  assert.match(mouse.url, /^manual:\/\//);
  assert.equal(mouse.priority, 3);
  assert.equal(mouse.quantity, 1);
  const freeItem = free.json as Item;
  assert.equal((await call(item, 'PATCH', `/api/items/${freeItem.id}`, { sort_order: 8 }, { id: String(freeItem.id) })).status, 200);

  const renamed = await call(item, 'PATCH', `/api/items/${created.id}`, { name: 'キーボード改', quantity: 3, sort_order: 5 }, { id: String(created.id) });
  assert.equal(renamed.status, 200);
  assert.equal((renamed.json as Item).name, 'キーボード改');
  assert.equal((renamed.json as Item).quantity, 3);
  assert.equal((renamed.json as Item).sort_order, 5);

  const samePrice = await call(item, 'PATCH', `/api/items/${created.id}`, { current_price: 1000 }, { id: String(created.id) });
  assert.equal(samePrice.status, 200);
  const cheaper = await call(item, 'PATCH', `/api/items/${created.id}`, { current_price: 800 }, { id: String(created.id) });
  assert.equal(cheaper.status, 200);
  const rebound = await call(item, 'PATCH', `/api/items/${created.id}`, { current_price: 900 }, { id: String(created.id) });
  assert.equal(rebound.status, 200);

  const database = await db();
  const history = database.prepare('SELECT price FROM price_history WHERE item_id = ? ORDER BY id').all(created.id) as { price: number }[];
  assert.deepEqual(history.map((row) => row.price), [1000, 800, 900]);

  const listed = await call(items, 'GET', '/api/items');
  assert.equal(listed.status, 200);
  const rows = listed.json as Item[];
  assert.deepEqual(rows.map((row) => row.name), ['キーボード改', 'マウス', '無料']);
  const keyboard = rows.find((row) => row.id === created.id);
  assert.equal(keyboard?.previous_price, 800);
  assert.equal(keyboard?.current_price, 900);

  await setTestUser(other);
  assert.equal((await call(item, 'PATCH', `/api/items/${created.id}`, { name: '盗む' }, { id: String(created.id) })).status, 404);
  assert.equal((await call(item, 'DELETE', `/api/items/${created.id}`, undefined, { id: String(created.id) })).status, 404);
  assert.equal((await call(item, 'GET', `/api/items/${created.id}`, undefined, { id: String(created.id) })).status, 404);
  assert.deepEqual(await (await call(items, 'GET', '/api/items')).json, []);

  await setTestUser(owner);
  const bought = await call(item, 'PATCH', `/api/items/${mouse.id}`, {
    is_purchased: true, purchased_at: '2026-10-22',
  }, { id: String(mouse.id) });
  assert.equal(bought.status, 200);
  assert.equal((bought.json as Item).is_purchased, 1);
  assert.equal((bought.json as Item).purchased_at, '2026-10-22');

  const wishlist = await call(items, 'GET', '/api/items');
  assert.deepEqual((wishlist.json as Item[]).map((row) => row.id).includes(mouse.id), false);

  const historyView = await call(purchased, 'GET', '/api/purchased');
  assert.equal(historyView.status, 200);
  const purchasedBody = historyView.json as { items: Item[]; totalStats: { count: number; total: number } };
  assert.equal(purchasedBody.items.length, 1);
  assert.equal(purchasedBody.items[0].name, 'マウス');
  assert.equal(purchasedBody.totalStats.count, 1);
  assert.equal(purchasedBody.totalStats.total, 500);

  const removed = await call(item, 'DELETE', `/api/items/${created.id}`, undefined, { id: String(created.id) });
  assert.equal(removed.status, 200);
  assert.equal(((await call(items, 'GET', '/api/items')).json as Item[]).some((row) => row.id === created.id), false);

  const trashed = await call(trash, 'GET', '/api/trash');
  const trashedRows = trashed.json as Item[];
  assert.equal(trashedRows.length, 1);
  assert.equal(trashedRows[0].id, created.id);
  assert.ok(trashedRows[0].deleted_at);

  await setTestUser(other);
  assert.equal((await call(trashItem, 'POST', `/api/trash/${created.id}`, undefined, { id: String(created.id) })).status, 404);
  await setTestUser(owner);
  assert.equal((await call(trashItem, 'POST', `/api/trash/${created.id}`, undefined, { id: String(created.id) })).status, 200);
  assert.equal(((await call(items, 'GET', '/api/items')).json as Item[]).some((row) => row.id === created.id), true);
  assert.equal((await call(trash, 'GET', '/api/trash')).text, '[]');

  assert.equal((await call(item, 'DELETE', `/api/items/${created.id}`, undefined, { id: String(created.id) })).status, 200);
  database.prepare('INSERT INTO notification_settings (item_id, enabled) VALUES (?, 1)').run(created.id);
  assert.equal((await call(trashItem, 'DELETE', `/api/trash/${created.id}`, undefined, { id: String(created.id) })).status, 200);
  assert.equal(database.prepare('SELECT id FROM items WHERE id = ?').get(created.id), undefined);
  const historyCount = database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(created.id) as { n: number };
  const settingCount = database.prepare('SELECT COUNT(*) AS n FROM notification_settings WHERE item_id = ?').get(created.id) as { n: number };
  assert.equal(historyCount.n, 0);
  assert.equal(settingCount.n, 0);
  assert.equal(database.prepare('SELECT id FROM items WHERE id = ?').get(mouse.id) === undefined, false);
});

test('trash keeps a recent item, purges after 7 days, and empty deletes only that user', async () => {
  const owner = await createMember('trash-owner');
  const other = await createMember('trash-other');
  const database = await db();
  const insert = (userId: number, name: string, deletedAt: string | null) => Number(database.prepare(
    'INSERT INTO items (user_id, name, url, deleted_at) VALUES (?, ?, ?, ?)',
  ).run(userId, name, `manual://${name}`, deletedAt).lastInsertRowid);
  const recent = insert(owner.id, 'recent', null);
  const stale = insert(owner.id, 'stale', null);
  const foreign = insert(other.id, 'foreign', null);
  database.prepare("UPDATE items SET deleted_at = datetime('now', '-3 days') WHERE id = ?").run(recent);
  database.prepare("UPDATE items SET deleted_at = datetime('now', '-8 days') WHERE id = ?").run(stale);
  database.prepare("UPDATE items SET deleted_at = datetime('now', '-8 days') WHERE id = ?").run(foreign);
  database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 10)').run(stale);

  await setTestUser(owner);
  const listed = await call(trash, 'GET', '/api/trash');
  const ids = (listed.json as { id: number }[]).map((row) => row.id);
  assert.deepEqual(ids, [recent]);
  assert.equal(database.prepare('SELECT id FROM items WHERE id = ?').get(stale), undefined);
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(stale) as { n: number }).n, 0);
  assert.ok(database.prepare('SELECT id FROM items WHERE id = ?').get(foreign));

  const active = insert(owner.id, 'active', null);
  const emptied = await call(trash, 'DELETE', '/api/trash');
  assert.equal(emptied.status, 200);
  assert.equal((emptied.json as { deleted: number }).deleted, 1);
  assert.ok(database.prepare('SELECT id FROM items WHERE id = ?').get(active));
  assert.ok(database.prepare('SELECT id FROM items WHERE id = ?').get(foreign));
});

test('categories and comparison groups count only active wishlist items and stay owned', async () => {
  const owner = await createMember('catalog');
  const other = await createMember('catalog-other');
  await setTestUser(owner);

  assert.equal((await call(categories, 'POST', '/api/categories', { name: '   ' })).status, 400);
  const books = await call(categories, 'POST', '/api/categories', { name: '  本  ', color: '#112233' });
  assert.equal(books.status, 201);
  const book = books.json as { id: number; name: string; color: string; sort_order: number };
  assert.equal(book.name, '本');
  assert.equal(book.color, '#112233');
  assert.equal((await call(categories, 'POST', '/api/categories', { name: '本' })).status, 400);

  const games = await call(categories, 'POST', '/api/categories', { name: 'ゲーム' });
  const game = games.json as { id: number };
  assert.equal((games.json as { sort_order: number }).sort_order, book.sort_order + 1);

  const wish = await call(groups, 'POST', '/api/comparison-groups', { name: ' ヘッドホン ', priority: 1 });
  assert.equal(wish.status, 201);
  const headphones = wish.json as { id: number; name: string; priority: number };
  assert.equal(headphones.name, ' ヘッドホン ');
  assert.equal((await call(groups, 'POST', '/api/comparison-groups', { name: ' ヘッドホン ' })).status, 201);
  assert.equal((await call(groups, 'POST', '/api/comparison-groups', {})).status, 400);

  const database = await db();
  const add = (name: string, fields: { category_id?: number; comparison_group_id?: number; purchased?: number; deleted?: boolean; priority?: number; sort_order?: number }) => {
    database.prepare(`
      INSERT INTO items (user_id, name, url, category_id, comparison_group_id, is_purchased, deleted_at, priority, sort_order, current_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 100)
    `).run(
      owner.id, name, `manual://${name}`, fields.category_id ?? null, fields.comparison_group_id ?? null,
      fields.purchased ?? 0, fields.deleted ? '2026-01-01 00:00:00' : null, fields.priority ?? 3, fields.sort_order ?? 0,
    );
  };
  add('reading', { category_id: book.id, comparison_group_id: headphones.id, priority: 5, sort_order: 2 });
  add('bought-book', { category_id: book.id, purchased: 1 });
  add('trashed-book', { category_id: book.id, deleted: true });
  add('loose', { priority: 1, sort_order: 9 });

  const categoryRows = await call(categories, 'GET', '/api/categories');
  const bookRow = (categoryRows.json as { id: number; item_count: number }[]).find((row) => row.id === book.id);
  assert.equal(bookRow?.item_count, 1);

  const groupRows = await call(groups, 'GET', '/api/comparison-groups');
  const headphoneRow = (groupRows.json as { id: number; item_count: number }[]).find((row) => row.id === headphones.id);
  assert.equal(headphoneRow?.item_count, 1);

  const ordered = (await call(items, 'GET', '/api/items')).json as Item[];
  assert.deepEqual(ordered.map((row) => row.name), ['reading', 'loose']);

  await setTestUser(other);
  assert.equal((await call(items, 'POST', '/api/items', { manual: true, name: '借りる', category_id: book.id })).status, 400);
  assert.equal((await call(items, 'POST', '/api/items', { manual: true, name: '借りる', comparison_group_id: headphones.id })).status, 400);
  assert.equal((await call(category, 'PUT', `/api/categories/${book.id}`, { name: '盗む' }, { id: String(book.id) })).status, 404);
  assert.equal((await call(group, 'DELETE', `/api/comparison-groups/${headphones.id}`, undefined, { id: String(headphones.id) })).status, 404);

  await setTestUser(owner);
  const renamed = await call(category, 'PUT', `/api/categories/${book.id}`, { name: '書籍' }, { id: String(book.id) });
  assert.equal(renamed.status, 200);
  assert.equal((renamed.json as { name: string }).name, '書籍');
  const reprioritized = await call(group, 'PUT', `/api/comparison-groups/${headphones.id}`, { priority: 4 }, { id: String(headphones.id) });
  assert.equal(reprioritized.status, 200);
  assert.equal((reprioritized.json as { priority: number }).priority, 4);

  assert.equal((await call(category, 'DELETE', `/api/categories/${book.id}`, undefined, { id: String(book.id) })).status, 200);
  assert.deepEqual(database.prepare('SELECT category_id FROM items WHERE name = ?').get('reading'), { category_id: null });
  assert.equal(database.prepare('SELECT id FROM categories WHERE id = ?').get(book.id), undefined);
  assert.ok(database.prepare('SELECT id FROM items WHERE name = ?').get('reading'));

  assert.equal((await call(group, 'DELETE', `/api/comparison-groups/${headphones.id}`, undefined, { id: String(headphones.id) })).status, 200);
  assert.deepEqual(database.prepare('SELECT comparison_group_id FROM items WHERE name = ?').get('reading'), { comparison_group_id: null });
  assert.equal((await call(categories, 'GET', '/api/categories')).status, 200);
  assert.equal((game.id > 0), true);
});
