import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db, setTestUser } from './regression-harness';
import { filterHomeItems, type HomeSortBy } from '../src/lib/home-wishlist';
import { sumCountedPrices } from '../src/lib/photo-spend';
import type { Item } from '../src/types';

const route = '../src/app/api/items/page/route.ts';
type Page = {
  items: Item[]; revision: string; totalCount: number; matchedCount: number; rowCount: number;
  matchedIds: number[]; allIds: number[]; totalAmount: number; nextCursor: string | null;
};

test('bounded API covers 500 items and preserves complete-result filters, totals and ownership', async () => {
  const owner = await createMember('page-owner');
  const foreign = await createMember('page-foreign');
  await setTestUser(owner);
  const database = await db();
  const insert = database.prepare(`
    INSERT INTO items (user_id, name, url, image_url, notes, current_price, quantity, priority, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  database.transaction(() => {
    for (let i = 0; i < 500; i++) insert.run(owner.id, '商品' + String(i).padStart(4, '0'),
      'https://example.test/product/' + i, 'https://example.test/image/' + 'x'.repeat(500) + i,
      i === 499 ? '最後だけ見つかる' : null, i % 11 === 0 ? null : 100 + i, 2, (i % 5) + 1, i,
      '2026-10-' + String((i % 28) + 1).padStart(2, '0') + ' 00:00:00', '2026-10-01 00:00:00');
    insert.run(foreign.id, '他人の商品', 'https://example.test/private', null, null, 1, 1, 1, 0, '2026-10-01 00:00:00', '2026-10-01 00:00:00');
  })();

  const category = Number(database.prepare("INSERT INTO categories (user_id, name, created_at) VALUES (?, '末尾だけの分類', '2026-10-01 00:00:00')").run(owner.id).lastInsertRowid);
  database.prepare('UPDATE items SET category_id = ? WHERE user_id = ? AND name = ?').run(category, owner.id, '商品0499');
  const old = await call('../src/app/api/items/route.ts', 'GET', '/api/items');
  assert.equal(old.status, 200);
  const legacy = old.json as Item[];
  for (const sort of ['priority', 'price_asc', 'price_desc', 'date_new', 'date_old', 'name'] as HomeSortBy[]) {
    const expected = filterHomeItems(legacy, {
      selectedCategory: null, selectedPriority: null, selectedGroup: null, searchQuery: '', sortBy: sort,
    });
    let cursor: string | null = null;
    const collected: Item[] = [];
    let count = 0;
    do {
      const query = new URLSearchParams({ sort, limit: '37' });
      if (cursor) query.set('cursor', cursor);
      const response = await call(route, 'GET', '/api/items/page?' + query);
      assert.equal(response.status, 200);
      const page = response.json as Page;
      assert.ok(page.items.length <= 37);
      assert.equal(page.totalCount, 500);
      assert.equal(page.matchedCount, 500);
      assert.equal(page.totalAmount, sumCountedPrices(legacy));
      assert.equal(page.matchedIds.length, 500);
      assert.deepEqual(page.matchedIds, expected.map(item => item.id));
      assert.ok(!page.items.some(item => item.name === '他人の商品'));
      if (count === 0) assert.ok(response.bytes.length < old.bytes.length);
      collected.push(...page.items);
      cursor = page.nextCursor;
      count++;
      assert.ok(count <= 14);
    } while (cursor);
    assert.equal(new Set(collected.map(item => item.id)).size, 500);
    assert.deepEqual(collected.map(item => item.id), expected.map(item => item.id));
  }
  const searched = await call(route, 'GET', '/api/items/page?q=' + encodeURIComponent('最後だけ見つかる'));
  assert.equal(searched.status, 200);
  assert.equal((searched.json as Page).matchedCount, 1);
  assert.equal((searched.json as Page).items[0].name, '商品0499');
  for (const condition of ['category=' + category, 'priority=5&category=' + category]) {
    const result = await call(route, 'GET', '/api/items/page?' + condition);
    assert.equal(result.status, 200);
    assert.deepEqual((result.json as Page).items.map(item => item.name), ['商品0499']);
    assert.equal((result.json as Page).totalCount, 500);
    assert.equal((result.json as Page).matchedCount, 1);
  }
  const priority = await call(route, 'GET', '/api/items/page?priority=5&limit=1');
  assert.equal((priority.json as Page).matchedCount, 100);
  assert.equal((priority.json as Page).matchedIds.length, 100);
  const zero = await call(route, 'GET', '/api/items/page?q=does-not-exist');
  assert.deepEqual((zero.json as Page).items, []);
  assert.equal((zero.json as Page).nextCursor, null);
});

test('snapshot edits and condition changes require restart; bad cursors do not leak other users', async () => {
  const user = await createMember('page-snapshot');
  const database = await db();
  const insert = database.prepare("INSERT INTO items (user_id, name, url, current_price, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10-01 00:00:00', '2026-10-01 00:00:00')");
  for (let i = 0; i < 3; i++) insert.run(user.id, 'item' + i, 'manual://snapshot/' + i, 100);
  const initial = await call(route, 'GET', '/api/items/page?limit=1');
  const cursor = (initial.json as Page).nextCursor!;
  assert.ok(cursor);
  const query = '/api/items/page?limit=1&cursor=' + encodeURIComponent(cursor);
  assert.equal((await call(route, 'GET', query)).status, 200);
  assert.equal((await call(route, 'GET', query + '&sort=price_desc')).status, 409);
  // No clock advance: content changes must invalidate even with identical updated_at.
  database.prepare('UPDATE items SET name = ? WHERE id = ?').run('changed', (initial.json as Page).items[0].id);
  assert.equal((await call(route, 'GET', query)).status, 409);
  const refreshed = await call(route, 'GET', '/api/items/page?limit=1');
  const currentCursor = '/api/items/page?limit=1&cursor=' + encodeURIComponent((refreshed.json as Page).nextCursor!);
  assert.equal((await call(route, 'GET', currentCursor)).status, 200);
  await createMember('page-other-owner'); // createMember also switches the authenticated test user.
  assert.equal((await call(route, 'GET', currentCursor)).status, 409);
  for (const bad of ['limit=0', 'limit=101', 'priority=6', 'category=-1', 'sort=invalid', 'cursor=oops']) {
    assert.equal((await call(route, 'GET', '/api/items/page?' + bad)).status, 400);
  }
  await setTestUser(null);
  assert.equal((await call(route, 'GET', '/api/items/page')).status, 401);
});

test('photo comparison groups and prior prices stay intact across page boundaries', async () => {
  const user = await createMember('page-photo');
  const database = await db();
  const group = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name, priority, origin, created_at) VALUES (?, '写真比較', 3, 'photo', '2026-10-01 00:00:00')",
  ).run(user.id).lastInsertRowid);
  const insert = database.prepare(
    "INSERT INTO items (user_id, name, url, comparison_group_id, current_price, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10-01 00:00:00', '2026-10-01 00:00:00')",
  );
  const ids = [0, 1, 2].map(i => Number(insert.run(user.id, '候補' + i, 'manual://photo/' + i, group, 100 + i, i).lastInsertRowid));
  insert.run(user.id, '別商品', 'manual://separate', null, 500, 4);
  const history = database.prepare('INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, ?, ?)');
  history.run(ids[0], 300, '2026-10-01 00:00:00');
  history.run(ids[0], 200, '2026-10-02 00:00:00');
  history.run(ids[0], 100, '2026-10-02 00:00:00');
  const result = await call(route, 'GET', '/api/items/page?limit=1');
  assert.equal(result.status, 200);
  const first = result.json as Page;
  assert.deepEqual(first.items.map(item => item.id), ids);
  assert.equal(first.items[0].previous_price, 200);
  assert.equal(first.totalAmount, 600); // one photo choice + the separate item
  assert.equal(first.rowCount, 2);
  const selected = await call(route, 'GET', '/api/items/page?group=' + group);
  assert.deepEqual((selected.json as Page).matchedIds, ids);
  assert.equal((selected.json as { lowestPriceInGroup: number }).lowestPriceInGroup, 100);
  const second = await call(route, 'GET', '/api/items/page?limit=1&cursor=' + encodeURIComponent(first.nextCursor!));
  assert.equal((second.json as Page).items[0].name, '別商品');
  assert.equal((second.json as Page).nextCursor, null);
});
