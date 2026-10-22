import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.BUTUYOKUOH_DB_PATH || path.join(process.cwd(), 'data', 'butuyokuoh.db');

// 検索で見つけた候補を残す時間。登録はこの期限の前の行だけを受け取る。
export const CAPTURE_CANDIDATE_TTL_MS = 30 * 60 * 1000;

export function captureCandidateExpiresAt(now = Date.now()): number {
  return now + CAPTURE_CANDIDATE_TTL_MS;
}

// 写真そのものは保存しない。候補の image_url は店舗の商品画像。
// origin = 'photo' のグループだけ出費の数え方を変える。budget_item_id は選んだ候補。NULL は未選択。
// capture_ai_usage は写真判定の回数とニューロン。user_key は会員 ID の文字列。写真は入れない。
const CAPTURE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    estimated_name TEXT,
    jan TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    comparison_group_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (comparison_group_id) REFERENCES comparison_groups(id)
  );

  CREATE TABLE IF NOT EXISTS capture_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    capture_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    source_name TEXT,
    shop_name TEXT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    image_url TEXT,
    price INTEGER,
    source_item_code TEXT,
    price_fetched_at TEXT,
    jan TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at INTEGER NOT NULL DEFAULT (unixepoch('now', '+30 minutes') * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_captures_user ON captures(user_id);
  CREATE INDEX IF NOT EXISTS idx_captures_group ON captures(comparison_group_id);
  CREATE INDEX IF NOT EXISTS idx_capture_candidates_user ON capture_candidates(user_id);
  CREATE INDEX IF NOT EXISTS idx_capture_candidates_capture ON capture_candidates(capture_id);
  CREATE INDEX IF NOT EXISTS idx_capture_candidates_expires ON capture_candidates(expires_at);

  CREATE TABLE IF NOT EXISTS capture_ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    day TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    neurons INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_capture_ai_usage_day ON capture_ai_usage(day);
  CREATE INDEX IF NOT EXISTS idx_capture_ai_usage_user ON capture_ai_usage(user_key, day, at_ms);
`;

export function deleteExpiredCaptureCandidates(db: Database.Database, now = Date.now()): number {
  const result = db.prepare('DELETE FROM capture_candidates WHERE expires_at <= ?').run(now);
  return result.changes;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = openDatabase(dbPath);
  }
  return db;
}

export function openDatabase(filename: string): Database.Database {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const connection = new Database(filename);
  connection.pragma('journal_mode = WAL');
  connection.pragma('busy_timeout = 5000');
  connection.transaction(() => initDb(connection)).immediate();
  return connection;
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
      source_item_code TEXT,
      price_fetched_at TEXT,
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
      origin TEXT,
      capture_id INTEGER,
      budget_item_id INTEGER,
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

  db.exec(CAPTURE_SCHEMA_SQL);
  migrateDb(db);
}

// 既存DBへのスキーマ変更を反映する簡易マイグレーション
// CREATE TABLE IF NOT EXISTS は既存テーブルを変更しないため、
// 後から追加されたカラムはここで ALTER TABLE により追従させる
function migrateDb(db: Database.Database) {
  addColumnIfNotExists(db, 'users', 'account_type', "TEXT NOT NULL DEFAULT 'member'");
  addColumnIfNotExists(db, 'items', 'is_demo_sample', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires ON guest_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS guest_rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      resets_at INTEGER NOT NULL
    );
  `);
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

  // 写真から登録。足すだけで、既存の列や表は消さない。
  // budget_item_id は出費予定で選んだ候補の items.id。NULL は未選択。
  addColumnIfNotExists(db, 'comparison_groups', 'origin', 'TEXT');
  addColumnIfNotExists(db, 'comparison_groups', 'capture_id', 'INTEGER');
  addColumnIfNotExists(db, 'comparison_groups', 'budget_item_id', 'INTEGER');
  addColumnIfNotExists(db, 'items', 'source_item_code', 'TEXT');
  addColumnIfNotExists(db, 'items', 'price_fetched_at', 'TEXT');
  db.exec(CAPTURE_SCHEMA_SQL);
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
