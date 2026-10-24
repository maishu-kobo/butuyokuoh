import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/lib/db';

// origin/develop @ f11349adccc6580b01e440391311f42ebcb350f4 の openDatabase が残す形。
// account_type と is_demo_sample は migrateDb の ALTER で末尾に足した列。
// captures はこのコミットに無い。存在しない comparison_group は items.comparison_group_id に入る。
// 外部キーの定義はスキーマに残るが、過去の書き込みは OFF だった。better-sqlite3 12 は
// コンパイル既定で foreign_keys=ON なので、壊れた行を入れる前に OFF にする。
const DEVELOP_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    account_type TEXT NOT NULL DEFAULT 'member'
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
    quantity INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    last_scraped_at TEXT,
    scrape_status TEXT,
    scrape_error TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_demo_sample INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (comparison_group_id) REFERENCES comparison_groups(id),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, url)
  );
  CREATE TABLE price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    price INTEGER NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );
  CREATE TABLE comparison_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE notification_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE,
    target_price INTEGER,
    notify_on_any_drop INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
  );
  CREATE TABLE user_notification_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    slack_webhook TEXT,
    discord_webhook TEXT,
    notify_on_price_drop INTEGER NOT NULL DEFAULT 1,
    notify_on_target_price INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, name)
  );
  CREATE TABLE guest_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE guest_rate_limits (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    resets_at INTEGER NOT NULL
  );
  CREATE INDEX idx_items_user ON items(user_id);
  CREATE INDEX idx_items_priority ON items(priority);
  CREATE INDEX idx_items_planned_date ON items(planned_purchase_date);
  CREATE INDEX idx_price_history_item ON price_history(item_id, recorded_at);
  CREATE INDEX idx_comparison_groups_user ON comparison_groups(user_id);
  CREATE INDEX idx_categories_user ON categories(user_id);
  CREATE INDEX idx_items_user_status ON items(user_id, is_purchased, deleted_at);
  CREATE INDEX idx_items_user_category ON items(user_id, category_id);
  CREATE INDEX idx_items_user_group ON items(user_id, comparison_group_id);
  CREATE INDEX idx_guest_sessions_expires ON guest_sessions(expires_at);
  CREATE INDEX idx_users_email_lower ON users(LOWER(email));
`;

const MISSING_ID = 9001;

type Row = Record<string, unknown>;

function userVersion(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function counts(db: Database.Database): Record<string, number> {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as { name: string }[];
  const out: Record<string, number> = {};
  for (const { name } of tables) {
    out[name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;
  }
  return out;
}

function snapshot(db: Database.Database): Record<string, Row[]> {
  const read = (sql: string) => db.prepare(sql).all() as Row[];
  return {
    users: read('SELECT id, email, name, account_type FROM users ORDER BY id'),
    items: read(
      `SELECT id, user_id, name, url, current_price, original_price, source, priority,
              comparison_group_id, category_id, quantity, sort_order, is_purchased, deleted_at, is_demo_sample
       FROM items ORDER BY id`
    ),
    price_history: read('SELECT id, item_id, price, recorded_at FROM price_history ORDER BY id'),
    comparison_groups: read('SELECT id, user_id, name, priority FROM comparison_groups ORDER BY id'),
    notification_settings: read(
      'SELECT id, item_id, target_price, notify_on_any_drop, enabled FROM notification_settings ORDER BY id'
    ),
    user_notification_settings: read(
      'SELECT id, user_id, slack_webhook, discord_webhook FROM user_notification_settings ORDER BY id'
    ),
    categories: read('SELECT id, user_id, name, color, sort_order FROM categories ORDER BY id'),
    guest_sessions: read('SELECT token_hash, user_id, created_at, expires_at FROM guest_sessions ORDER BY token_hash'),
    guest_rate_limits: read('SELECT bucket, count, resets_at FROM guest_rate_limits ORDER BY bucket'),
  };
}

function captureRows(db: Database.Database): Row[] | null {
  const exists = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'captures'"
  ).get();
  if (!exists) return null;
  return db.prepare(
    'SELECT id, user_id, estimated_name, status, comparison_group_id FROM captures ORDER BY id'
  ).all() as Row[];
}

function violations(db: Database.Database): { table: string }[] {
  return db.prepare('PRAGMA foreign_key_check').all() as { table: string }[];
}

function assertCountsKept(before: Record<string, number>, after: Record<string, number>) {
  for (const [name, count] of Object.entries(before)) {
    assert.equal(after[name], count, name);
  }
}

function insertDevelopRows(db: Database.Database) {
  db.prepare(
    `INSERT INTO users (id, email, name, account_type) VALUES
      (1, 'figure-fan@example.com', 'フィギュア担当', 'member'),
      (2, 'guest-keep@guest.invalid', 'ゲスト', 'guest')`
  ).run();
  db.prepare(
    `INSERT INTO comparison_groups (id, user_id, name, priority) VALUES
      (1, 1, 'ねんどろいど比較', 2),
      (2, ?, '親のいないグループ', 3)`
  ).run(MISSING_ID);
  db.prepare(
    `INSERT INTO categories (id, user_id, name, color, sort_order) VALUES
      (1, 1, 'フィギュア', '#ec4899', 1),
      (2, ?, '親のいないカテゴリ', '#6b7280', 0)`
  ).run(MISSING_ID);
  db.prepare(
    `INSERT INTO items (
       id, user_id, name, url, current_price, original_price, source, source_name,
       priority, comparison_group_id, category_id, quantity, sort_order, target_price, is_demo_sample
     ) VALUES
      (1, 1, 'ねんどろいど 初音ミク', 'https://item.rakuten.co.jp/shop/nendoroid-miku', 7800, 8200, 'rakuten', '楽天市場', 2, 1, 1, 1, 4, 7000, 0),
      (2, 1, 'グループが無い商品', 'https://item.rakuten.co.jp/shop/dangling-group', 5400, NULL, 'rakuten', '楽天市場', 3, ?, 1, 1, 5, NULL, 0),
      (3, 1, 'カテゴリが無い商品', 'https://example.com/dangling-category', 1200, NULL, 'other', NULL, 3, NULL, ?, 1, 6, NULL, 0),
      (4, ?, 'ユーザーが無い商品', 'https://example.com/dangling-user', 300, NULL, 'other', NULL, 3, NULL, NULL, 1, 0, NULL, 0),
      (5, 1, 'ゴミ箱の商品', 'https://example.com/trashed', 2000, NULL, 'amazon', 'Amazon', 4, 1, 1, 2, 8, NULL, 0),
      (6, 2, 'ゲストの商品', 'https://example.com/guest-item', 500, NULL, 'other', NULL, 3, NULL, NULL, 1, 0, NULL, 0)`
  ).run(MISSING_ID, MISSING_ID, MISSING_ID);
  db.prepare("UPDATE items SET deleted_at = '2026-10-01 00:00:00' WHERE id = 5").run();
  db.prepare(
    `INSERT INTO price_history (id, item_id, price, recorded_at) VALUES
      (1, 1, 8200, '2026-09-01 00:00:00'),
      (2, 1, 7800, '2026-10-01 00:00:00'),
      (3, 5, 2100, '2026-09-15 00:00:00'),
      (4, ?, 1500, '2026-08-01 00:00:00')`
  ).run(MISSING_ID);
  db.prepare(
    `INSERT INTO notification_settings (id, item_id, target_price, notify_on_any_drop, enabled) VALUES
      (1, 1, 7000, 1, 1),
      (2, ?, 1000, 0, 1)`
  ).run(MISSING_ID);
  db.prepare(
    `INSERT INTO user_notification_settings (id, user_id, slack_webhook) VALUES
      (1, 1, 'https://hooks.example/slack'),
      (2, ?, NULL)`
  ).run(MISSING_ID);
  db.prepare(
    `INSERT INTO guest_sessions (token_hash, user_id, created_at, expires_at) VALUES
      ('guest-session-keep', 2, 1700000000000, 1700003600000),
      ('guest-session-orphan', ?, 1700000000000, 1700003600000)`
  ).run(MISSING_ID);
  db.prepare(
    "INSERT INTO guest_rate_limits (bucket, count, resets_at) VALUES ('write:2', 1, 1700003600000)"
  ).run();
}

function insertDanglingCapture(db: Database.Database) {
  db.exec(`
    CREATE TABLE captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      estimated_name TEXT,
      jan TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      comparison_group_id INTEGER,
      registered_item_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (comparison_group_id) REFERENCES comparison_groups(id)
    );
  `);
  db.prepare(
    `INSERT INTO captures (id, user_id, estimated_name, status, comparison_group_id) VALUES
      (1, 1, '残るキャプチャ', 'open', 1),
      (2, 1, 'グループが無いキャプチャ', 'open', ?)`
  ).run(MISSING_ID);
}

function withDatabase(
  userVersionBefore: number,
  extra: ((db: Database.Database) => void) | undefined,
  run: (filename: string, before: Record<string, Row[]>, countsBefore: Record<string, number>, capturesBefore: Row[] | null) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'develop-open-'));
  const filename = join(directory, 'butuyokuoh.db');
  try {
    const created = new Database(filename);
    created.pragma('foreign_keys = OFF');
    created.exec(DEVELOP_SCHEMA);
    created.pragma(`user_version = ${userVersionBefore}`);
    insertDevelopRows(created);
    extra?.(created);
    const broken = violations(created);
    assert.equal(broken.some((row) => row.table === 'price_history'), true);
    assert.equal(broken.some((row) => row.table === 'items'), true);
    assert.equal(broken.some((row) => row.table === 'notification_settings'), true);
    const before = snapshot(created);
    const countsBefore = counts(created);
    const capturesBefore = captureRows(created);
    assert.equal(userVersion(created), userVersionBefore);
    created.close();
    run(filename, before, countsBefore, capturesBefore);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function openAndKeep(
  filename: string,
  before: Record<string, Row[]>,
  countsBefore: Record<string, number>,
  capturesBefore: Row[] | null,
  versionBefore: number,
) {
  const opened = openDatabase(filename);
  try {
    const versionAfter = userVersion(opened);
    if (versionBefore >= 1) {
      assert.equal(versionAfter, versionBefore);
    } else {
      assert.equal(versionAfter >= 1, true);
    }
    assert.equal(Number(opened.pragma('foreign_keys', { simple: true })), 1);
    assert.deepEqual(snapshot(opened), before);
    assertCountsKept(countsBefore, counts(opened));
    const broken = violations(opened);
    assert.equal(broken.some((row) => row.table === 'price_history'), true);
    assert.equal(broken.some((row) => row.table === 'items'), true);
    assert.equal(broken.some((row) => row.table === 'notification_settings'), true);
    if (capturesBefore) {
      assert.deepEqual(captureRows(opened), capturesBefore);
      assert.equal(broken.some((row) => row.table === 'captures'), true);
    }
    return versionAfter;
  } finally {
    opened.close();
  }
}

test('a develop database with foreign key violations opens without losing rows', () => {
  withDatabase(0, undefined, (filename, before, countsBefore, capturesBefore) => {
    assert.equal(capturesBefore, null);
    const versionAfter = openAndKeep(filename, before, countsBefore, capturesBefore, 0);
    const again = openDatabase(filename);
    try {
      assert.equal(userVersion(again), versionAfter);
      assert.deepEqual(snapshot(again), before);
      assertCountsKept(countsBefore, counts(again));
      assert.equal(violations(again).some((row) => row.table === 'price_history'), true);
    } finally {
      again.close();
    }
  });
});

test('a develop database does not lower user_version when it is already set', () => {
  for (const versionBefore of [1, 4]) {
    withDatabase(versionBefore, undefined, (filename, before, countsBefore, capturesBefore) => {
      const versionAfter = openAndKeep(filename, before, countsBefore, capturesBefore, versionBefore);
      assert.equal(versionAfter, versionBefore);
      const again = openDatabase(filename);
      try {
        assert.equal(userVersion(again), versionBefore);
        assert.deepEqual(snapshot(again), before);
        assertCountsKept(countsBefore, counts(again));
      } finally {
        again.close();
      }
    });
  }
});

test('an existing captures row that points at a missing comparison group is kept', () => {
  // develop のスキーマには captures が無い。写真ブランチの表が既にあるファイルで、
  // 存在しない comparison_group を指していても、開いたときにその行を捨てない。
  withDatabase(0, insertDanglingCapture, (filename, before, countsBefore, capturesBefore) => {
    assert.deepEqual(
      capturesBefore?.map((row) => row.comparison_group_id),
      [1, MISSING_ID],
    );
    openAndKeep(filename, before, countsBefore, capturesBefore, 0);
  });
});
