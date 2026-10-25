import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/lib/db';
import { call, createMember, db, setTestUser } from './regression-harness';

const items = '../src/app/api/items/route.ts';

type Listed = {
  id: number;
  name: string;
  previous_price: number | null;
  comparison_group_name: string | null;
  comparison_group_origin: string | null;
  group_origin: string | null;
  group_priority: number | null;
  category_name: string | null;
  category_color: string | null;
};

test('wishlist previous price is the second newest visible history row', async () => {
  const owner = await createMember('history-owner');
  const other = await createMember('history-other');
  await setTestUser(owner);
  const database = await db();
  const groupId = Number(database.prepare(
    'INSERT INTO comparison_groups (user_id, name, priority, origin) VALUES (?, ?, ?, ?)',
  ).run(owner.id, '積む本', 1, null).lastInsertRowid);
  const categoryId = Number(database.prepare(
    'INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)',
  ).run(owner.id, '本', '#112233').lastInsertRowid);
  const bookId = insertItem(database, owner.id, '本', { comparison_group_id: groupId, category_id: categoryId, current_price: 900 });
  const onceId = insertItem(database, owner.id, '一度だけ', { current_price: 100 });
  const boughtId = insertItem(database, owner.id, '購入済み', { is_purchased: 1, current_price: 50 });
  const deletedId = insertItem(database, owner.id, '削除済み', { deleted_at: '2026-10-01 00:00:00', current_price: 70 });
  const foreignId = insertItem(database, other.id, '他人の本', { current_price: 5 });

  const history = database.prepare('INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, ?, ?)');
  history.run(bookId, 50, '2026-09-01 00:00:00');
  history.run(bookId, 100, '2026-10-01 00:00:00');
  history.run(bookId, 200, '2026-10-01 00:00:00');
  history.run(bookId, 900, '2026-11-01 00:00:00');
  history.run(onceId, 100, '2026-10-01 00:00:00');
  history.run(boughtId, 40, '2026-08-01 00:00:00');
  history.run(boughtId, 50, '2026-10-01 00:00:00');
  history.run(deletedId, 70, '2026-10-01 00:00:00');
  const filler = database.transaction(() => {
    for (let i = 0; i < 30; i += 1) history.run(foreignId, i + 1, '2026-10-01 00:00:00');
  });
  filler();

  const original = Database.prototype.prepare;
  let listedSql = '';
  Database.prototype.prepare = function (this: Database.Database, sql: string) {
    if (sql.includes('previous_price')) listedSql = sql;
    return original.call(this, sql);
  } as typeof Database.prototype.prepare;

  try {
    const listed = await call(items, 'GET', '/api/items');
    assert.equal(listed.status, 200);
    const rows = listed.json as Listed[];
    assert.deepEqual(rows.map((row) => row.name).sort(), ['一度だけ', '本']);
    const book = rows.find((row) => row.id === bookId);
    assert.equal(book?.previous_price, 200);
    assert.equal(book?.comparison_group_name, '積む本');
    assert.equal(book?.comparison_group_origin, null);
    assert.equal(book?.group_origin, null);
    assert.equal(book?.group_priority, 1);
    assert.equal(book?.category_name, '本');
    assert.equal(book?.category_color, '#112233');
    assert.equal(rows.find((row) => row.id === onceId)?.previous_price, null);

    assert.notEqual(listedSql, '');
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${listedSql}`).all(owner.id) as { detail: string }[];
    const details = plan.map((row) => row.detail);
    const historySteps = details.filter((line) => /idx_price_history/.test(line));
    assert.ok(historySteps.length > 0, details.join('\n'));
    for (const line of historySteps) {
      assert.match(line, /SEARCH \S+ USING INDEX idx_price_history\S* \(item_id=\?\)/);
    }
    assert.equal(details.some((line) => line.includes('LAST 2 TERMS')), false, details.join('\n'));
  } finally {
    Database.prototype.prepare = original;
  }
});

test('opening an older database adds the price history lookup index', () => {
  const directory = mkdtempSync(join(tmpdir(), 'price-history-index-'));
  const filename = join(directory, 'old.sqlite');
  try {
    const created = new Database(filename);
    created.exec(`
      CREATE TABLE price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        price INTEGER NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX idx_price_history_item ON price_history(item_id, recorded_at);
    `);
    created.prepare('INSERT INTO price_history (item_id, price, recorded_at) VALUES (1, 100, ?)').run('2026-10-01 00:00:00');
    created.close();

    const opened = openDatabase(filename);
    try {
      assert.deepEqual(indexColumns(opened), [
        { name: 'item_id', desc: 0 },
        { name: 'recorded_at', desc: 1 },
        { name: 'id', desc: 1 },
      ]);
      assert.equal((opened.prepare('SELECT price FROM price_history').get() as { price: number }).price, 100);
    } finally {
      opened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function insertItem(
  database: Database.Database,
  userId: number,
  name: string,
  fields: { comparison_group_id?: number; category_id?: number; current_price?: number; is_purchased?: number; deleted_at?: string },
) {
  return Number(database.prepare(`
    INSERT INTO items (user_id, name, url, priority, sort_order, current_price, comparison_group_id, category_id, is_purchased, deleted_at)
    VALUES (?, ?, ?, 3, 0, ?, ?, ?, ?, ?)
  `).run(
    userId,
    name,
    `manual://${name}`,
    fields.current_price ?? null,
    fields.comparison_group_id ?? null,
    fields.category_id ?? null,
    fields.is_purchased ?? 0,
    fields.deleted_at ?? null,
  ).lastInsertRowid);
}

function indexColumns(database: Database.Database) {
  return database.prepare('PRAGMA index_xinfo(idx_price_history_item_recorded_id)').all()
    .filter((column) => (column as { key: number }).key === 1)
    .map((column) => {
      const row = column as { name: string; desc: number };
      return { name: row.name, desc: row.desc };
    });
}
