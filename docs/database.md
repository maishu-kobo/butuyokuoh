# データベース設計

## 概要

- **DBMS**: SQLite 3
- **ドライバ**: better-sqlite3
- **ファイルパス**: `data/butuyokuoh.db`

## ER図

```
┌──────────────┐       ┌──────────────────┐
│    users     │       │   categories     │
├──────────────┤       ├──────────────────┤
│ id (PK)      │       │ id (PK)          │
│ email        │       │ user_id (FK)     │
│ password_hash│       │ name             │
│ name         │       │ color            │
│ auth_token   │       └─────────┬────────┘
└───────┬──────┘               │
        │                       │
        │ 1:N                   │ 1:N
        ▼                       ▼
┌─────────────────────────────────────┐
│              items                  │
├─────────────────────────────────────┤
│ id (PK)                             │
│ user_id (FK → users)               │
│ category_id (FK → categories)      │
│ comparison_group_id (FK)            │
│ name, url, image_url                │
│ current_price, original_price       │
│ quantity                            │
│ priority, planned_purchase_date     │
│ target_price, target_currency       │
│ is_purchased, purchased_at          │
│ deleted_at                          │
└──────────────────┬──────────────────┘
                   │
                   │ 1:N
                   ▼
        ┌──────────────────┐
        │  price_history   │
        ├──────────────────┤
        │ id (PK)          │
        │ item_id (FK)     │
        │ price            │
        │ recorded_at      │
        └──────────────────┘
```

## テーブル定義

### users

ユーザーアカウント情報。

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,              -- NULL = Google OAuthユーザー
  name TEXT,
  auth_token TEXT,                 -- Chrome拡張用トークン
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

| カラム | 型 | 説明 |
|--------|------|------|
| id | INTEGER | 主キー |
| email | TEXT | メールアドレス（ユニーク） |
| password_hash | TEXT | bcryptハッシュ。Google OAuthの場合はNULL |
| name | TEXT | 表示名 |
| auth_token | TEXT | Chrome拡張機能用の認証トークン |
| created_at | TEXT | 作成日時 |

### items

ほしいものリストのアイテム。

```sql
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  current_price INTEGER,
  original_price INTEGER,
  source TEXT NOT NULL DEFAULT 'other',  -- 'amazon', 'rakuten', 'other'
  source_name TEXT,
  priority INTEGER NOT NULL DEFAULT 3,   -- 1(最高)～5(最低)
  quantity INTEGER NOT NULL DEFAULT 1,
  planned_purchase_date TEXT,
  comparison_group_id INTEGER,
  category_id INTEGER,
  notes TEXT,
  target_price INTEGER,
  target_currency TEXT DEFAULT 'JPY',    -- 'JPY' or 'USD'
  is_purchased INTEGER NOT NULL DEFAULT 0,
  purchased_at TEXT,
  deleted_at TEXT,                       -- ソフトデリート
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (comparison_group_id) REFERENCES comparison_groups(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  UNIQUE(user_id, url)
);

CREATE INDEX idx_items_user ON items(user_id);
CREATE INDEX idx_items_priority ON items(priority);
CREATE INDEX idx_items_planned_date ON items(planned_purchase_date);
```

| カラム | 型 | 説明 |
|--------|------|------|
| id | INTEGER | 主キー |
| user_id | INTEGER | 所有ユーザー |
| name | TEXT | 商品名 |
| url | TEXT | 商品URL。手動追加は`manual://タイムスタンプ` |
| image_url | TEXT | 商品画像URL |
| current_price | INTEGER | 現在価格（円） |
| original_price | INTEGER | 登録時価格 |
| source | TEXT | ソースサイト |
| quantity | INTEGER | 購入予定個数 |
| priority | INTEGER | 優先度 (1-5) |
| planned_purchase_date | TEXT | 購入予定日 (YYYY-MM-DD) |
| target_price | INTEGER | 目標価格（通知用） |
| is_purchased | INTEGER | 購入済みフラグ (0/1) |
| deleted_at | TEXT | ソフトデリート日時 |

### categories

ユーザー定義のカテゴリ。

```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### comparison_groups

比較グループ。

```sql
CREATE TABLE comparison_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### price_history

価格履歴。

```sql
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
```

### user_notification_settings

ユーザーごとの通知設定。

```sql
CREATE TABLE user_notification_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  slack_webhook TEXT,
  discord_webhook TEXT,
  notify_on_price_drop INTEGER DEFAULT 1,
  notify_on_target_price INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## バックアップ

SQLiteファイルをコピーするだけでバックアップ可能。

```bash
# バックアップ
cp data/butuyokuoh.db data/butuyokuoh.db.backup

# リストア
cp data/butuyokuoh.db.backup data/butuyokuoh.db
```

## マイグレーション

現在、マイグレーションツールは未導入。
スキーマ変更は`src/lib/db.ts`の初期化処理で手動対応。

今後の改善としてPrismaやDrizzleの導入を推奨。
