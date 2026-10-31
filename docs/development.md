# 開発ガイド

ローカル開発環境のセットアップ手順。

## 前提条件

| ツール | バージョン | 備考 |
|--------|----------|------|
| Node.js | 22.12 以上 | puppeteer 25 の engines。本番へ入れる前の手順は docs/deployment.md |
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

CI の速いレーンと重いレーン、フレークしたテストの隔離は [docs/ci.md](ci.md)。

## テストの置き場

単体テストは `tests/*.test.ts` だけ。`npm test` と CI の必須レーンは、この直下のファイルだけを実行する。サブディレクトリに置くと両方から漏れる。

e2e は `tests/e2e/*.spec.ts`。既定の `npm run test:e2e` は、別レーンに名前が書いていない spec をすべて実行する。別レーンは `scripts/e2e-lanes.mjs` の `OTHER_LANE_FILES`。

| ファイル | レーン | 実行 |
| --- | --- | --- |
| それ以外の `*.spec.ts` | 既定 | `npm run test:e2e`。店の代わりに固定ページ |
| `disabled.spec.ts` | ゲスト無効 | `E2E_GUEST_DISABLED=1 npx playwright test` |
| `production-smoke.spec.ts` | 本番スモーク | `npm run build` のあと `E2E_PRODUCTION=1 npx playwright test` |
| `live-shops.spec.ts` | 実店舗 | `npm run test:e2e:live`。三つの環境変数が揃わないと失敗する |

固定ページを足すときは `src/lib/product-regression-fixtures.ts` に URL と応答を足す。期待する商品名・価格・画像は fixture に書き、パーサの戻り値から作らない。本番の `NODE_ENV` ではこの差し替えは動かない。公開IP・DNS・転送先の検査は外さない。

## URL取得の回帰

| 事象 | 固定データで見るテスト |
| --- | --- |
| ゲストの PITAKA 風ページ（#76） | `tests/url-regression.test.ts`、`tests/e2e/url-regression.spec.ts` |
| Amazon の大きさ、価格の取り違え（#77） | `tests/product-fetch.test.ts`。API の価格なし・失敗は `tests/url-regression.test.ts` |
| 取得失敗と手入力の保持（#77） | `tests/e2e/url-regression.spec.ts`。ブラウザで API を差し替えるテストは `tests/e2e/guest.spec.ts` に残す |
| 楽天の文字コード（#78） | `tests/html-encoding.test.ts`、`tests/url-regression.test.ts`、会員の画面は `tests/e2e/url-regression.spec.ts` |
| 失敗で既存商品を壊さない | `tests/url-regression.test.ts` |
| 実店舗 | `tests/e2e/live-shops.spec.ts`。通常の CI では走らない |

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

1. 物欲王の設定ページで拡張用トークン（byoagt_ / extension）を作成してコピー
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

## 任意のコミット前チェック

`npm ci` の後、希望する開発者だけが `npm run hooks:install` を実行する。`core.hooksPath` をこのリポジトリのローカル設定で `.githooks` に設定する。他のリポジトリやグローバル設定は変更しない。同じリポジトリのworktreeではローカル設定を共有する。`.git/hooks` は呼ばれなくなる。別のフック設定がある場合は上書きしない。worktree固有のフック設定がある場合も自動変更せず停止する。

pre-commitはステージ済み差分の空白エラー・競合と、ステージ済みJS/TSのESLintエラーを検出する。部分ステージの未追加部分はLint対象にせず、自動修正、git add、stashを行わない。ESLint設定・tsconfig・package.json・lockfileがステージと作業ツリーで内容や存在が異なる場合は、別設定で検査しないよう停止する。設定が読み込むローカルファイルを今後増やす場合は、チェック対象にも追加する。依存を変更した場合は手元の依存も更新する。

解除は `npm run hooks:uninstall`。自分たちの設定だけを解除し、以前からあるグローバル設定等があればそちらが有効になる。インストール・解除は自動実行されない。

型検査と単体テストは、push前に `npm run verify:fast` で明示的に実行する。このコマンドは作業ツリーを検査するため、push対象のコミットと一致するクリーンな状態で使う。pre-pushフックは導入せず、コミットごとのビルドやブラウザ試験も行わない。ローカルフックは回避できるので、必須チェックによる強制はCIで行う（#79）。
