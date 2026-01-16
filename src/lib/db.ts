import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'butuyokuoh.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (comparison_group_id) REFERENCES comparison_groups(id),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON SET NULL,
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
      line_notify_token TEXT,
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
  `);
}
