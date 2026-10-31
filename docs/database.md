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

## 写真から登録で足す列と表

列と表は足すだけ。消したり、名前を変えたりはしない。起動時の `migrateDb` が既存のDBへ同じ追加を行う。写真のファイルは保存しない。

### comparison_groups に足す列

| カラム | 型 | 説明 |
|--------|------|------|
| origin | TEXT | 写真から作ったグループは `photo`。手で作ったグループは NULL のまま |
| capture_id | INTEGER | どの撮影（`captures.id`）から作ったか。なければ NULL |
| budget_item_id | INTEGER | 出費予定で選んだ候補の `items.id`。NULL は未選択。写真グループの数え方（購入済みがあれば残りは数えない。未選択なら未購入の最安1件）は別作業 |

### items に足す列

| カラム | 型 | 説明 |
|--------|------|------|
| source_item_code | TEXT | 取得元と商品コード。例: `yahoo:<商品コード>`、`rakuten:<itemCode>` |
| price_fetched_at | TEXT | 価格を取った日時 |

### captures

撮影1回。推定した商品名、JAN、状態、作った比較グループ。1件だけ登録したときは `registered_item_id` にその商品を残す。比較グループのときは NULL。写真の列は無い。

### capture_candidates

検索で見つけた候補。`expires_at` は作成から30分。毎時の後片付けは期限切れの行を消す。ゲストを消すときは、その利用者の撮影と候補も消す。登録する側は、この表のIDだけを受け取る。

### capture_ai_usage

写真判定の1分・1日の回数と、全体のニューロン。`user_key` は会員 ID の文字列、`day` は UTC の日付（`YYYY-MM-DD`）、`at_ms` は要求の時刻、`neurons` はその1回分。写真そのものは入れない。日付が変わった行は数えず、行自体は消さない。利用者を消しても、その日の全体のニューロンは残る。

## エージェント用トークン（#268）

列と表は足すだけ。平文トークンは保存しない。

### agent_tokens

| カラム | 型 | 説明 |
|--------|------|------|
| token_prefix | TEXT | 識別用（例: `byoagt_xxxxxxxx`） |
| token_hash | TEXT | 平文の SHA-256（ユニーク） |
| scopes | TEXT | JSON 配列（`read` / `write`） |
| expires_at | TEXT | 有効期限 |
| revoked_at | TEXT | 失効時刻。NULL なら未失効 |

### agent_audit_log

トークンごとの操作ログ。90 日で刈り取る。`meta` にトークン値は入れない。

### agent_rate_limits

トークン単位のレート制限バケット（`agent:<tokenId>:<kind>`）。

### items に足す列

| カラム | 型 | 説明 |
|--------|------|------|
| added_by_agent_token_id | INTEGER | エージェントが追加した印。トークン失効後も残る |

## スキーマ変更の前のバックアップ

本番のスキーマを変えるコードを起動する前に、SQLite の `.backup` で一貫したコピーを取る。`data/butuyokuoh.db` を `cp` しただけでは、WAL の更新が別ファイルに残っていて、コピーが途中の状態になることがある。

アプリは起動時に列と表を足す。バックアップは、新しいコードでプロセスを上げる前に取る。

```bash
# 書き込みを止めてから取る
sudo systemctl stop butuyokuoh

sqlite3 data/butuyokuoh.db ".backup 'data/butuyokuoh.db.pre-migrate.backup'"
sqlite3 data/butuyokuoh.db.pre-migrate.backup "PRAGMA integrity_check;"

# 新しいコードを配置してから起動する。起動時に列と表が足される
sudo systemctl start butuyokuoh
```

戻すときもアプリを止める。`-wal` と `-shm` が残っていると、戻したファイルよりそちらが優先される。

```bash
sudo systemctl stop butuyokuoh
rm -f data/butuyokuoh.db-wal data/butuyokuoh.db-shm
sqlite3 data/butuyokuoh.db.pre-migrate.backup ".backup 'data/butuyokuoh.db'"
sudo systemctl start butuyokuoh
```

`BUTUYOKUOH_DB_PATH` を変えている場合は、そのファイルを対象にする。

## バックアップ

日常の写しも、スキーマを変える前も、SQLite の `.backup` を使う。`data/butuyokuoh.db` のファイルコピーは使わない。WAL の更新が `-wal` に残っていると、本体ファイルだけのコピーは途中の状態になる。

アプリを動かしたまま取れる。`.backup` はバックアップ API で、一貫した1つのファイルを作る。本番の更新で、動いているディレクトリの外に新しいコードを準備する手順は `docs/deployment.md` の「安全な更新」。

```bash
sqlite3 data/butuyokuoh.db ".backup 'data/butuyokuoh.db.backup'"
sqlite3 data/butuyokuoh.db.backup "PRAGMA integrity_check;"
```

`integrity_check` が `ok` でないファイルは、戻しに使わない。

戻すときはアプリを止める。`-wal` と `-shm` が残っていると、戻したファイルよりそちらが優先される。

```bash
sudo systemctl stop butuyokuoh
rm -f data/butuyokuoh.db-wal data/butuyokuoh.db-shm
sqlite3 data/butuyokuoh.db.backup ".backup 'data/butuyokuoh.db'"
sudo systemctl start butuyokuoh
```

`BUTUYOKUOH_DB_PATH` を変えている場合は、そのファイルを対象にする。

## マイグレーション

現在、マイグレーションツールは未導入。
スキーマ変更は`src/lib/db.ts`の初期化処理で手動対応。

今後の改善としてPrismaやDrizzleの導入を推奨。
