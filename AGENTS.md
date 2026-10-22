# AGENTS.md

物欲王（butuyokuoh）のエージェント向けルール。正本はこのファイルだけで、他の指示ファイルはここを指す。本文を複製しない。

複数の EC のほしいものリストをまとめる Next.js アプリ。本番は https://butsuyokuoh.exe.xyz/ 。作業の起点は `develop`。`main` は昇格用で、ここへ直接作業しない。

仕様（写真から登録）: https://docs.google.com/document/d/1BIKZ_U2Sg0bM1Vh4TUsBoV25iCSdnSyTbYqtzOuJ6IQ/edit
ローカルの SPEC 下書きはコミットしない。

## 地図

- `src/app/` 画面。`src/app/api/` が Route Handler
- `src/components/` UI。`src/lib/` は DB・認証・商品取得。スキーマは `src/lib/db.ts`
- `src/types/` 型。`extension/` Chrome 拡張。`scripts/` は価格チェックとゲスト整理
- `tests/*.test.ts` 単体。`tests/e2e/` Playwright。`docs/` 利用と設計
- `looper/state.md` はループの状態。`data/` は SQLite（gitignore）。秘密は `.env*`（gitignore）

## コマンド

Node.js 20 以上（`docs/development.md`）。`package.json` に `engines` は無い。確認時は Node v22.23.4、npm 10.9.9。依存は lockfile どおり `npm ci`。

| コマンド | 役割 | 2026-10-22、develop `f11349a` |
| --- | --- | --- |
| `npm run dev -- --port 3000` | 開発サーバ。既定ポートは 3000 | `GET /` が 200 |
| `npm run start` | 本番起動。ポート未指定なら 3000。systemd は `PORT=8000` | 確認時は `--port 3001` で `GET /` が 200 |
| `npm test` | `node --import tsx --test tests/*.test.ts`。e2e は含まない | 24 件成功 |
| `npx tsc --noEmit` | 型検査。npm script ではない | 成功 |
| `npm run build` | `next build`（Next.js 16.1.2） | 成功 |
| `npm run lint` | `eslint` | 失敗（既存 error 4、warning 22）。新しい違反を足さない |
| `npm run test:e2e` | Playwright。既定は `tests/e2e/guest.spec.ts` | `--list` で 13 件。ブラウザ実行は未実施 |

`.github/workflows` は無い。PR の確認は上の手元コマンド。CI の整備は Issue #79。

`npm run check-prices` は外部サイトを取得し DB を更新する。`npm run cleanup-guests` はゲストを削除する。エージェントはどちらも実行しない。

## 開発の進め方

- 作業は GitHub Issue に載せる。1 Issue につき 1 ブランチ、意味のある単位で小さい PR。
- コミットは Conventional Commits（`feat` `fix` `perf` `docs` `test` `chore`。必要なら scope）。
- テストを先に書く。テストと、将来足される CI を壊したままにしない。
- リファクタの機会を見つけたら Issue を先に開く。頼まれていない書き換えはしない。
- 使い方は `docs/` に書く。判断は `docs/WORKLOG.md` に日付付きで残す。
- `CHANGELOG.md` は Keep a Changelog。マージ前の変更は `[Unreleased]` に足す。

## マージ

CI が通り、作者とは別のエージェントかレビュアーがレビューした PR は自動マージしてよい。次に触る PR は人間の承認が必要。

- AI / API キーや秘密情報の扱い
- 利用量・費用の上限
- `.github/workflows/`
- `package.json` または lockfile
- DB スキーマ（`src/lib/db.ts` の表・列・インデックス）

エージェントはデプロイしない。`develop` と `main` へ直接 push しない。リポジトリ設定を変えない。データを削除しない。

## セキュリティ

- 秘密をコミットしない。ログ、PR、チャットに出さない。キーはサーバの環境変数だけ。`NEXT_PUBLIC_` に置かない。
- ローカルは `.env.local`。本番で必須なのは `JWT_SECRET`。認証は `AUTH_SECRET` または `NEXTAUTH_SECRET`。Google は `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET`。
- Amazon はリンクだけ。スクレイプを新しく足さない。既存の URL 登録と価格チェックは、その作業を頼まれたとき以外、取得範囲を広げない。
- 外部入力（利用者、取得した HTML、LLM の出力）は信用しない。ログに個人情報を出さない。

## スキーマ

`getDb()` は `BUTUYOKUOH_DB_PATH`、無ければ `data/butuyokuoh.db` を開く。`initDb` のあと `migrateDb` が走る。`data/` は `getDb()` が作る。

- 新規 DB の定義は `initDb` の `CREATE TABLE IF NOT EXISTS`。これは既存の表を変えない。
- 足した列は `migrateDb` の `addColumnIfNotExists`、足した表は `migrateDb` の `CREATE TABLE IF NOT EXISTS` にも書く。
- 列の削除と改名はしない。`addColumnIfNotExists` に渡す名前はコード内の定数だけ。
- スキーマを変える PR は人間の承認が必要。

## 作業の前後

始める前に、このファイルと `docs/WORKLOG.md` を読み、`git log`、開いている PR、`npm test` で今の状態を確認する。

終えるとき、同じ PR で `docs/WORKLOG.md` に日付のエントリを足す。決めたこと、結果、残件を書く。
