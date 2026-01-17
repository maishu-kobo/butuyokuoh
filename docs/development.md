# 開発ガイド

ローカル開発環境のセットアップ手順。

## 前提条件

| ツール | バージョン | 備考 |
|--------|----------|------|
| Node.js | 20.x 以上 | |
| npm | 10.x 以上 | |
| Git | - | |
| Chromium/Chrome | - | Puppeteerで使用 |

## セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/maishu-kobo/butuyokuoh.git
cd butuyokuoh
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.local`を作成:

```bash
# NextAuth設定（必須）
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<ランダム文字列を生成>

# JWT（必須）
JWT_SECRET=<ランダム文字列を生成>

# Google OAuth（任意）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

シークレットの生成:

```bash
openssl rand -base64 32
```

### 4. 開発サーバー起動

```bash
npm run dev
```

http://localhost:3000 でアクセス。

初回起動時にSQLiteデータベース（`data/butuyokuoh.db`）が自動作成される。

---

## 開発コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（ホットリロード） |
| `npm run build` | 本番用ビルド |
| `npm run start` | 本番サーバー起動 |
| `npm run lint` | ESLintチェック |
| `npm run check-prices` | 価格チェックスクリプト実行 |

---

## Chrome拡張機能の開発

### 拡張機能のロード

1. Chromeで `chrome://extensions/` を開く
2. 「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `extension/` ディレクトリを選択

### 拡張機能の構成

```
extension/
├── manifest.json      # 拡張機能設定
├── popup.html         # ポップアップUI
├── popup.js           # ポップアップロジック
├── content-amazon.js  # Amazonページ用スクリプト
├── content-rakuten.js # 楽天ページ用スクリプト
└── icons/             # アイコン
```

### 拡張機能の設定

1. 物欲王の設定ページで認証トークンをコピー
2. 拡張機能のポップアップでサーバーURLとトークンを設定
   - URL: `http://localhost:3000`（開発時）

---

## データベース

### ファイル場所

```
data/butuyokuoh.db
```

### 直接操作

```bash
sqlite3 data/butuyokuoh.db
```

```sql
-- テーブル一覧
.tables

-- スキーマ確認
.schema items

-- データ確認
SELECT id, name, current_price FROM items LIMIT 10;
```

### リセット

```bash
rm data/butuyokuoh.db
npm run dev  # 再起動で再作成
```

---

## トラブルシューティング

### 「Puppeteerがクラッシュする」

Chromiumの依存関係が不足している可能性:

```bash
# Ubuntu/Debian
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2
```

### 「ポート3000が使用中」

```bash
# 使用中のプロセスを確認
lsof -i :3000

# 別ポートで起動
PORT=3001 npm run dev
```

### 「データベースロックエラー」

SQLiteは同時書き込みに制限あり。開発サーバーを再起動。

### 「Google OAuthが動かない」

- `NEXTAUTH_URL`がアクセスしているURLと一致しているか確認
- Google Cloud ConsoleのリダイレクトURIが正しいか確認
