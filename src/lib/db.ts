import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'butuyokuoh.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // data/ ディレクトリが存在しない新規環境でも DB を初期化できるように自動作成する
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initDb(db);
  }
  return db;
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
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
      FOREIGN KEY (comparison_group_id) REFERENCES comparison_groups(id),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, url)
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      price INTEGER NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comparison_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL UNIQUE,
      target_price INTEGER,
      notify_on_any_drop INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_notification_settings (
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

    CREATE TABLE IF NOT EXISTS categories (
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

    CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_priority ON items(priority);
    CREATE INDEX IF NOT EXISTS idx_items_planned_date ON items(planned_purchase_date);
    CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(item_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_comparison_groups_user ON comparison_groups(user_id);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_user_status ON items(user_id, is_purchased, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category_id);
    CREATE INDEX IF NOT EXISTS idx_items_user_group ON items(user_id, comparison_group_id);
  `);

  migrateDb(db);
}

// 既存DBへのスキーマ変更を反映する簡易マイグレーション
// CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため、
// 後から追加されたカラムはここで ALTER TABLE により追従させる
function migrateDb(db: Database.Database) {
  addColumnIfNotExists(db, 'items', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfNotExists(db, 'items', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  // スクレイプ結果の記録用カラム
  addColumnIfNotExists(db, 'items', 'last_scraped_at', 'TEXT');
  addColumnIfNotExists(db, 'items', 'scrape_status', 'TEXT');
  addColumnIfNotExists(db, 'items', 'scrape_error', 'TEXT');
  // メールアドレスを LOWER(TRIM()) で正規化（LOWER(email) 照合が決定的になるよう既存データを揃える）
  normalizeUserEmails(db);
  // LOWER(email) 照合の全表走査を解消する関数インデックス
  db.prepare('CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email))').run();
}

// 既存ユーザーのメールアドレスを LOWER(TRIM()) に正規化する
// 正規化後の値が他の行と衝突する場合はそのままにして警告のみ出す（既存アカウントを壊さない）
// 正規化済みの行は WHERE 条件にかからないため、何度実行しても安全（冪等）
function normalizeUserEmails(db: Database.Database) {
  const rows = db.prepare(
    'SELECT id, email FROM users WHERE email != LOWER(TRIM(email))'
  ).all() as { id: number; email: string }[];
  if (rows.length === 0) return;

  const findCollision = db.prepare(
    'SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND id != ? ORDER BY id LIMIT 1'
  );
  const update = db.prepare('UPDATE users SET email = LOWER(TRIM(email)) WHERE id = ?');

  const migrate = db.transaction(() => {
    for (const row of rows) {
      const collision = findCollision.get(row.email, row.id) as { id: number } | undefined;
      if (collision) {
        console.warn(
          `[db migrate] users.id=${row.id} のメール正規化をスキップ: 正規化後の値が users.id=${collision.id} と衝突するため変更しません`
        );
        continue;
      }
      update.run(row.id);
    }
  });
  migrate();
}

// テーブルに指定カラムが存在しない場合のみ ALTER TABLE で追加する
// table / column / definition はコード内で定義した定数のみを渡すこと（ユーザー入力は不可）
function addColumnIfNotExists(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
