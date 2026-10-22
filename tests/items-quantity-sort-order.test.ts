import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/lib/db';

// 一覧は sort_order、追加は quantity を使う。列が無いとこの2つが失敗する。
const LIST_ITEMS_SQL = `
  SELECT i.id, i.quantity, i.sort_order
  FROM items i
  WHERE i.is_purchased = 0 AND i.user_id = ? AND i.deleted_at IS NULL
  ORDER BY i.sort_order ASC, i.created_at DESC
`;

// GET /api/items と同じ並び。quantity が SELECT に無いので、欠けると sort_order で落ちる。
const LIST_ORDER_SQL = `
  SELECT i.id
  FROM items i
  WHERE i.is_purchased = 0 AND i.user_id = ? AND i.deleted_at IS NULL
  ORDER BY i.sort_order ASC, i.created_at DESC
`;

// quantity と sort_order を足す前に作られた items。他の表は起動時に作られる。
const PRE_QUANTITY_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT
  );
  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    image_url TEXT,
    current_price INTEGER,
    original_price INTEGER,
    source TEXT NOT NULL DEFAULT 'other',
    source_name TEXT,
    priority INTEGER NOT NULL DEFAULT 3,
    planned_purchase_date TEXT,
    comparison_group_id INTEGER,
    category_id INTEGER,
    notes TEXT,
    is_purchased INTEGER NOT NULL DEFAULT 0,
    purchased_at TEXT,
    target_price INTEGER,
    target_currency TEXT DEFAULT 'JPY',
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, url)
  );
`;

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
}

test('fresh database can list and insert items with quantity and sort_order', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare(`INSERT INTO users (email, name) VALUES ('user@example.com', 'user')`).run();
    db.prepare(
      `INSERT INTO items (user_id, name, url, current_price, original_price, source, priority, quantity, sort_order)
       VALUES (1, 'item', 'https://example.com/a', 1200, 1200, 'other', 3, 2, 4)`
    ).run();

    const row = db.prepare(LIST_ITEMS_SQL).get(1) as { quantity: number; sort_order: number };
    assert.equal(row.quantity, 2);
    assert.equal(row.sort_order, 4);
  } finally {
    db.close();
  }
});

test('existing databases gain quantity and sort_order without losing rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'items-schema-'));
  const filename = join(directory, 'butuyokuoh.db');
  try {
    const created = new Database(filename);
    created.exec(PRE_QUANTITY_SCHEMA);
    assert.equal(columnNames(created, 'items').includes('quantity'), false);
    assert.equal(columnNames(created, 'items').includes('sort_order'), false);
    created.prepare(`INSERT INTO users (email, name) VALUES ('user@example.com', 'user')`).run();
    created.prepare(
      `INSERT INTO items (user_id, name, url, current_price) VALUES (1, 'kept', 'https://example.com/old', 5000)`
    ).run();
    assert.throws(() => created.prepare(LIST_ORDER_SQL).get(1), /no such column: i\.sort_order/);
    assert.throws(
      () => created.prepare(
        `INSERT INTO items (user_id, name, url, quantity) VALUES (1, 'blocked', 'https://example.com/blocked', 1)`
      ).run(),
      /no column named quantity/
    );
    created.close();

    const first = openDatabase(filename);
    first.close();
    const db = openDatabase(filename);
    try {
      const stored = db.prepare(
        'SELECT name, current_price, quantity, sort_order FROM items WHERE user_id = ?'
      ).get(1) as {
        name: string;
        current_price: number;
        quantity: number;
        sort_order: number;
      };
      const row = db.prepare(LIST_ITEMS_SQL).get(1) as { quantity: number; sort_order: number };

      assert.equal(stored.name, 'kept');
      assert.equal(stored.current_price, 5000);
      assert.equal(stored.quantity, 1);
      assert.equal(stored.sort_order, 0);
      assert.equal(row.quantity, 1);
      assert.equal(row.sort_order, 0);

      db.prepare('UPDATE items SET sort_order = ? WHERE user_id = ?').run(3, 1);
      db.prepare(
        `INSERT INTO items (user_id, name, url, quantity) VALUES (1, 'new', 'https://example.com/new', 5)`
      ).run();

      const rows = db.prepare(
        'SELECT name, quantity, sort_order FROM items WHERE user_id = ? ORDER BY name'
      ).all(1) as { name: string; quantity: number; sort_order: number }[];
      assert.deepEqual(rows, [
        { name: 'kept', quantity: 1, sort_order: 3 },
        { name: 'new', quantity: 5, sort_order: 0 },
      ]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
