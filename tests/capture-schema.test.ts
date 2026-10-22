import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  CAPTURE_CANDIDATE_TTL_MS,
  captureCandidateExpiresAt,
  deleteExpiredCaptureCandidates,
  openDatabase,
} from '../src/lib/db';
import { cleanupGuests, deleteGuestUser } from '../src/lib/guest';

// feature/photo-capture でこの変更の前にアプリが作るスキーマ。
// quantity / sort_order は PR #122 の対象で、このブランチには既にある。ここには足さない。
const OLD_SCHEMA = `
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
`;

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null };

function columnInfo(db: Database.Database, table: string): ColumnInfo[] {
  return (db.pragma(`table_info(${table})`) as ColumnInfo[])
    .map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function names(db: Database.Database, table: string): string[] {
  return columnInfo(db, table).map((column) => column.name);
}

function tempFile(): { directory: string; filename: string } {
  const directory = mkdtempSync(join(tmpdir(), 'capture-schema-'));
  return { directory, filename: join(directory, 'butuyokuoh.db') };
}

function openOldDatabase(filename: string): Database.Database {
  const created = new Database(filename);
  created.exec(OLD_SCHEMA);
  created.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('keep@example.com', '残す人', 'member')"
  ).run();
  created.prepare(
    "INSERT INTO comparison_groups (user_id, name, priority) VALUES (1, '手動グループ', 2)"
  ).run();
  created.prepare(
    `INSERT INTO items (user_id, name, url, current_price, quantity, sort_order, comparison_group_id, source)
     VALUES (1, '残る商品', 'https://example.com/kept', 4200, 2, 7, 1, 'rakuten')`
  ).run();
  created.prepare('INSERT INTO price_history (item_id, price) VALUES (1, 4200)').run();
  created.prepare("INSERT INTO guest_rate_limits (bucket, count, resets_at) VALUES ('create', 3, 123456)").run();
  created.close();
  return openDatabase(filename);
}

function assertNoStoredPhoto(db: Database.Database, table: string) {
  const columns = db.pragma(`table_info(${table})`) as { name: string; type: string }[];
  for (const column of columns) {
    assert.notEqual(column.type.toUpperCase(), 'BLOB', `${table}.${column.name}`);
    assert.doesNotMatch(column.name, /photo|blob|bytes|image_data/i, `${table}.${column.name}`);
  }
}

test('candidate rows expire 30 minutes after they are stored', () => {
  assert.equal(CAPTURE_CANDIDATE_TTL_MS, 30 * 60 * 1000);
  assert.equal(captureCandidateExpiresAt(1_000), 1_000 + 30 * 60 * 1000);
});

test('fresh database has photo-capture columns and tables and does not store photos', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(names(db, 'comparison_groups').includes('origin'), true);
    assert.equal(names(db, 'comparison_groups').includes('capture_id'), true);
    assert.equal(names(db, 'comparison_groups').includes('budget_item_id'), true);
    assert.equal(names(db, 'items').includes('source_item_code'), true);
    assert.equal(names(db, 'items').includes('price_fetched_at'), true);
    for (const table of ['captures', 'capture_candidates']) {
      assert.equal(names(db, table).length > 0, true, table);
      assertNoStoredPhoto(db, table);
    }
    assert.equal(names(db, 'captures').includes('image_url'), false);
    assert.equal(names(db, 'captures').includes('estimated_name'), true);
    assert.equal(names(db, 'captures').includes('jan'), true);
    assert.equal(names(db, 'captures').includes('status'), true);
    assert.equal(names(db, 'captures').includes('comparison_group_id'), true);
    assert.equal(names(db, 'capture_candidates').includes('expires_at'), true);

    const userId = Number(
      db.prepare("INSERT INTO users (email, name) VALUES ('fresh@example.com', 'fresh')").run().lastInsertRowid
    );
    const captureId = Number(
      db.prepare(
        "INSERT INTO captures (user_id, estimated_name, jan, status) VALUES (?, '牛乳', '4901234567894', 'ready')"
      ).run(userId).lastInsertRowid
    );
    const before = Date.now();
    const candidateId = Number(
      db.prepare(
        `INSERT INTO capture_candidates (user_id, capture_id, source, source_name, name, url, price, source_item_code, price_fetched_at)
         VALUES (?, ?, 'yahoo', 'Yahoo!ショッピング', '牛乳', 'https://store.shopping.yahoo.co.jp/shop/milk', 198, 'yahoo:milk', '2026-10-22 12:00:00')`
      ).run(userId, captureId).lastInsertRowid
    );
    const after = Date.now();
    const candidate = db.prepare('SELECT expires_at FROM capture_candidates WHERE id = ?').get(candidateId) as {
      expires_at: number;
    };
    assert.ok(candidate.expires_at >= before + CAPTURE_CANDIDATE_TTL_MS - 2000);
    assert.ok(candidate.expires_at <= after + CAPTURE_CANDIDATE_TTL_MS + 2000);

    const itemId = Number(
      db.prepare(
        `INSERT INTO items (user_id, name, url, current_price, source, source_item_code, price_fetched_at, comparison_group_id)
         VALUES (?, '牛乳', 'https://store.shopping.yahoo.co.jp/shop/milk', 198, 'yahoo', 'yahoo:milk', '2026-10-22 12:00:00', NULL)`
      ).run(userId).lastInsertRowid
    );
    const groupId = Number(
      db.prepare(
        `INSERT INTO comparison_groups (user_id, name, origin, capture_id, budget_item_id)
         VALUES (?, '牛乳', 'photo', ?, NULL)`
      ).run(userId, captureId).lastInsertRowid
    );
    const group = db.prepare(
      'SELECT origin, capture_id, budget_item_id FROM comparison_groups WHERE id = ?'
    ).get(groupId) as { origin: string; capture_id: number; budget_item_id: number | null };
    assert.equal(group.origin, 'photo');
    assert.equal(group.capture_id, captureId);
    assert.equal(group.budget_item_id, null);
    db.prepare('UPDATE comparison_groups SET budget_item_id = ? WHERE id = ?').run(itemId, groupId);
    const picked = db.prepare('SELECT budget_item_id FROM comparison_groups WHERE id = ?').get(groupId) as {
      budget_item_id: number;
    };
    assert.equal(picked.budget_item_id, itemId);

    db.prepare(
      `INSERT INTO capture_candidates (user_id, capture_id, source, source_name, name, url, source_item_code)
       VALUES (?, ?, 'rakuten', '楽天', '牛乳 楽天', 'https://item.rakuten.co.jp/shop/milk', 'rakuten:shop:milk')`
    ).run(userId, captureId);
  } finally {
    db.close();
  }
});

test('migrating a production-like database adds columns and tables without dropping data', () => {
  const { directory, filename } = tempFile();
  try {
    const db = openOldDatabase(filename);
    try {
      const kept = db.prepare(
        `SELECT u.email, u.name, g.name AS group_name, g.priority, g.origin, g.capture_id, g.budget_item_id,
                i.name AS item_name, i.current_price, i.quantity, i.sort_order, i.source,
                i.source_item_code, i.price_fetched_at, i.is_demo_sample,
                h.price AS history_price, r.count AS rate_count
         FROM items i
         JOIN users u ON u.id = i.user_id
         JOIN comparison_groups g ON g.id = i.comparison_group_id
         JOIN price_history h ON h.item_id = i.id
         JOIN guest_rate_limits r ON r.bucket = 'create'`
      ).get() as {
        email: string;
        name: string;
        group_name: string;
        priority: number;
        origin: string | null;
        capture_id: number | null;
        budget_item_id: number | null;
        item_name: string;
        current_price: number;
        quantity: number;
        sort_order: number;
        source: string;
        source_item_code: string | null;
        price_fetched_at: string | null;
        is_demo_sample: number;
        history_price: number;
        rate_count: number;
      };
      assert.equal(kept.email, 'keep@example.com');
      assert.equal(kept.name, '残す人');
      assert.equal(kept.group_name, '手動グループ');
      assert.equal(kept.priority, 2);
      assert.equal(kept.origin, null);
      assert.equal(kept.capture_id, null);
      assert.equal(kept.budget_item_id, null);
      assert.equal(kept.item_name, '残る商品');
      assert.equal(kept.current_price, 4200);
      assert.equal(kept.quantity, 2);
      assert.equal(kept.sort_order, 7);
      assert.equal(kept.source, 'rakuten');
      assert.equal(kept.source_item_code, null);
      assert.equal(kept.price_fetched_at, null);
      assert.equal(kept.is_demo_sample, 0);
      assert.equal(kept.history_price, 4200);
      assert.equal(kept.rate_count, 3);
      assert.equal(names(db, 'captures').includes('estimated_name'), true);
      assertNoStoredPhoto(db, 'captures');
      assertNoStoredPhoto(db, 'capture_candidates');

      const fresh = openDatabase(':memory:');
      try {
        for (const table of ['users', 'items', 'comparison_groups', 'captures', 'capture_candidates']) {
          assert.deepEqual(columnInfo(db, table), columnInfo(fresh, table), table);
        }
      } finally {
        fresh.close();
      }

      db.prepare("UPDATE comparison_groups SET origin = 'photo', budget_item_id = 1 WHERE id = 1").run();
      db.prepare("UPDATE items SET source_item_code = 'rakuten:kept', price_fetched_at = '2026-10-22 01:00:00' WHERE id = 1").run();
      const captureId = Number(
        db.prepare("INSERT INTO captures (user_id, estimated_name, status) VALUES (1, '残る商品', 'registered')").run()
          .lastInsertRowid
      );
      db.prepare('UPDATE comparison_groups SET capture_id = ? WHERE id = 1').run(captureId);
    } finally {
      db.close();
    }

    const again = openDatabase(filename);
    try {
      const row = again.prepare(
        `SELECT g.origin, g.capture_id, g.budget_item_id, i.source_item_code, i.price_fetched_at, i.name
         FROM comparison_groups g JOIN items i ON i.comparison_group_id = g.id`
      ).get() as {
        origin: string;
        capture_id: number;
        budget_item_id: number;
        source_item_code: string;
        price_fetched_at: string;
        name: string;
      };
      assert.equal(row.name, '残る商品');
      assert.equal(row.origin, 'photo');
      assert.equal(row.capture_id, 1);
      assert.equal(row.budget_item_id, 1);
      assert.equal(row.source_item_code, 'rakuten:kept');
      assert.equal(row.price_fetched_at, '2026-10-22 01:00:00');
      assert.deepEqual(again.prepare('SELECT COUNT(*) AS n FROM captures').get(), { n: 1 });
      assert.deepEqual(again.prepare('SELECT COUNT(*) AS n FROM items').get(), { n: 1 });
    } finally {
      again.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('hourly cleanup deletes expired candidates, and guest removal deletes the new tables', () => {
  const db = openDatabase(':memory:');
  try {
    const now = Date.now();
    const memberId = Number(
      db.prepare("INSERT INTO users (email, account_type) VALUES ('member@example.com', 'member')").run()
        .lastInsertRowid
    );
    const guestId = Number(
      db.prepare("INSERT INTO users (email, account_type) VALUES ('guest-a@guest.invalid', 'guest')").run()
        .lastInsertRowid
    );
    db.prepare('INSERT INTO guest_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      'a'.repeat(64),
      guestId,
      now,
      now + 60_000
    );
    const memberCapture = Number(
      db.prepare("INSERT INTO captures (user_id, estimated_name, status) VALUES (?, '会員の商品', 'ready')").run(memberId)
        .lastInsertRowid
    );
    const guestCapture = Number(
      db.prepare("INSERT INTO captures (user_id, estimated_name, status) VALUES (?, 'ゲストの商品', 'ready')").run(guestId)
        .lastInsertRowid
    );
    const insertCandidate = db.prepare(
      `INSERT INTO capture_candidates (user_id, capture_id, source, name, url, expires_at)
       VALUES (?, ?, 'yahoo', '候補', 'https://store.shopping.yahoo.co.jp/shop/item', ?)`
    );
    insertCandidate.run(memberId, memberCapture, now - 1);
    insertCandidate.run(memberId, memberCapture, now);
    const memberLive = Number(insertCandidate.run(memberId, memberCapture, captureCandidateExpiresAt(now)).lastInsertRowid);
    const guestLive = Number(insertCandidate.run(guestId, guestCapture, captureCandidateExpiresAt(now)).lastInsertRowid);
    insertCandidate.run(guestId, guestCapture, now - 30_000);

    assert.equal(cleanupGuests(db, now).deleted, 0);
    assert.deepEqual(
      (db.prepare('SELECT id FROM capture_candidates ORDER BY id').all() as { id: number }[]).map((row) => row.id),
      [memberLive, guestLive]
    );
    assert.equal(deleteExpiredCaptureCandidates(db, now), 0);
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM captures').get(), { n: 2 });

    const expiredGuest = Number(
      db.prepare(
        "INSERT INTO users (email, account_type, created_at) VALUES ('guest-old@guest.invalid', 'guest', datetime('now', '-3 days'))"
      ).run().lastInsertRowid
    );
    const expiredCapture = Number(
      db.prepare("INSERT INTO captures (user_id, estimated_name, status) VALUES (?, '期限切れゲスト', 'ready')").run(
        expiredGuest
      ).lastInsertRowid
    );
    insertCandidate.run(expiredGuest, expiredCapture, captureCandidateExpiresAt(now));
    db.prepare("INSERT INTO items (user_id, name, url) VALUES (?, '会員の商品', 'https://example.com/member')").run(memberId);

    assert.equal(cleanupGuests(db, now).deleted, 1);
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM captures WHERE user_id = ?').get(expiredGuest), { n: 0 });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM capture_candidates WHERE user_id = ?').get(expiredGuest), { n: 0 });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM captures WHERE user_id = ?').get(guestId), { n: 1 });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM items').get(), { n: 1 });

    assert.equal(deleteGuestUser(guestId, db), true);
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM captures WHERE user_id = ?').get(guestId), { n: 0 });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM capture_candidates WHERE user_id = ?').get(guestId), { n: 0 });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM captures WHERE user_id = ?').get(memberId), { n: 1 });
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM capture_candidates WHERE user_id = ?').get(memberId), { n: 1 });
    assert.equal(deleteGuestUser(memberId, db), false);
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM items').get(), { n: 1 });
  } finally {
    db.close();
  }
});

test('schema migration does not drop or rename tables', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/db.ts'), 'utf8');
  assert.doesNotMatch(source, /\bDROP\b/i);
  assert.doesNotMatch(source, /\bRENAME\b/i);
});
