# feature/photo-capture を develop に入れる前の確認

`origin/feature/photo-capture`（`5c5c1805decd98ff909d7a378237caf34621a090`）と `origin/develop`（`f11349adccc6580b01e440391311f42ebcb350f4`）を読んで書いた。本番、本番のデータベース、秘密は見ていない。このファイルは確認メモで、アプリの挙動は変えない。

下の「develop との差分」は、その2つのブランチのあいだにあるものだけ。まだマージしていない PR は「未マージ」に分け、差分の中身には入れない。

## develop との差分

### 写真から登録

会員の「新しいアイテムを追加」に、写真から商品を探して登録する入口がある。初期状態はオフ。`CAPTURE_ENABLED` が `true` のときだけ入口と API が出る。推定は、それに加えて `CAPTURE_AI_ENABLED` も `true` のときだけ。ゲストには入口を出さない。

送る前に、ブラウザが長辺 1600px の JPEG へ縮小する。5MB を超える写真は送らない。デスクトップでブラウザが復号できない HEIC / HEIF は、サーバが JPEG にしてから判定する。画素の宣言が上限を超えるもの、画素サイズの書いていないものは復号しない。サーバは位置情報を落とす。判定へ渡すのは JPEG だけ。写真のファイルはデータベースに保存しない。

推定は Cloudflare Workers AI。キーが無い、判定できない、回数やニューロンの上限のときは、商品名の手入力に戻る。テスト用の商品名を返すのは、開発でテストフックがオンのときだけ。本番では返さない。確かなときは商品名を1つ、迷うときは3つまで。判定の一時的な失敗は1回送り直す。モデルが読めないと言ったときは送り直さない。

候補は Yahoo! ショッピングと楽天市場の API。キーが無い店は検索しない。両方無いときは候補を出さず、手入力へ戻す。Amazon の商品 API は使わない。検索結果へのリンクだけを出す。候補は30分で消える。候補が2件以上のときは1つの比較グループとして登録し、リストでは1枚のカードにする。1件のときは比較グループを作らず、URL から登録した商品と同じ1件にする。本体を付属品より前に出す。店の検索語に「-ケース」のような除外は足さない。開いた店ごとの削除、優先度、比較グループの変更は、そのグループの店に効く。

### 価格

写真から登録した商品は、ページを取りに行く価格チェックと再取得の対象から外す。楽天の商品コードがある未購入の商品は、`scripts/check-prices.ts` が24時間ごとに楽天の API で価格を取り直す。この取り直しは `CAPTURE_ENABLED` を見ない。`RAKUTEN_APP_ID` と `RAKUTEN_ACCESS_KEY` が両方あるときだけ動く。止めるには、その2つの鍵を外す。

`RAKUTEN_AFFILIATE_ID` があるとき、楽天の検索の商品 URL はアフィリエイトのリンクになり得る。無いときは付けない。`AMAZON_ASSOCIATE_TAG` があるときだけ、Amazon の検索リンクに `tag` が付く。

写真から作ったグループの出費は、候補を全部足さない。購入済みがあればそれ、なければ選んだ候補、それもなければ最安を1件だけ数える。出費予定の行は、複数店でも見出しやインデントを付けない。

### 会員、ログイン、退会

Google のクライアント ID かシークレットが無い、または空白だけのときは、「Googleでログイン」を出さない。両方あるときは今までどおり。メールとパスワードのログインは残る。Google で同じメールの会員に結ぶと、その会員のパスワードは消し、ログインの世代を進めて、それまでのトークンを使えなくする。

退会は、その会員の行（商品、価格履歴、撮影、候補、カテゴリ、比較グループ、通知設定、判定の回数）と、`public/uploads` のうち今の実装がその会員のファイルだと判定したものを消す。古い `会員id_時刻.拡張子` と、その会員の画像 URL が指し、他の会員が指していないファイル。ゲストの行は消さない。

本番（`NODE_ENV` が production）では、会員のクッキー `butuyokuoh_token` とゲストのクッキー `butuyokuoh_guest` の両方に Secure が付く。

### プライバシーと利用規約

`/privacy` と `/terms` を足した。どちらも下書きで、画面に「確定したプライバシーポリシーではありません」「確定した利用規約ではありません」と出る。下書きの日付は 2026-10-23。同意したとみなす文は無い。

### 取り込み済みの不具合と、開発側の検査

develop に入っている既存の修正を、このブランチへ取り込んである。購入日の暦日、統計の個数、拡張機能のゴミ箱の重複、比較グループを消したときに撮影の参照を外す、登録 API の本文サイズ、依存関係の high / critical を 0 にする、を含む。

CI は、単体テスト・型・ビルド・lint・audit の速いレーンと、Playwright・CodeQL・依存差分・秘密スキャンの重いレーンに分かれる。本番の起動には使わない。

実行環境は Node.js 22.12 以上。puppeteer は 25.15.0。詳細は次の節。

## 本番の環境変数

値は書かない。名前だけ。

起動だけなら、新たに必須の環境変数は無い。写真から登録は、未設定のままではオフのまま。

写真を本番でオンにするときに置く名前:

| 名前 | いつ要るか |
| --- | --- |
| `CAPTURE_ENABLED` | `true` のときだけ入口と API |
| `CAPTURE_AI_ENABLED` | 上も `true` のときだけ、写真から商品名を推定する |
| `CLOUDFLARE_ACCOUNT_ID` | 推定。無いときは手入力に戻る |
| `CLOUDFLARE_API_TOKEN` | 推定。無いときは手入力に戻る |
| `YAHOO_SHOPPING_APP_ID` | Yahoo! の商品検索。無い店は検索しない |
| `RAKUTEN_APP_ID` | 楽天の商品検索と、商品コードの価格更新 |
| `RAKUTEN_ACCESS_KEY` | 上と両方あるときだけ楽天を使う。URL には付けない |
| `RAKUTEN_AFFILIATE_ID` | 無くてよい。あるとき検索の商品 URL がアフィリエイトリンクになり得る |
| `AMAZON_ASSOCIATE_TAG` | 無くてよい。あるとき Amazon の検索リンクにタグが付く |
| `CAPTURE_SECRETS_FILE` | 上の鍵を、リポジトリの外のファイルに置くとき。プロセス環境にある同じ名前が勝つ |

`RAKUTEN_APP_ID` と `RAKUTEN_ACCESS_KEY` は、写真をオフにしていても、両方置くと価格チェックが楽天 API で取り直す。

本番に置かない名前: `CAPTURE_TEST_HOOKS`、`CAPTURE_FAKE_SCENARIO`、`DEV_ALLOWED_ORIGINS`。最後の1つは development のときだけ有効。

## 実行時の依存とシステムパッケージ

`package.json` の dependencies で、develop から増えた実行時のパッケージ:

- `heic-decode` 2.1.0。HEIC の復号。インストール手順に、別のシステムパッケージは書いていない。
- `sharp` 0.35.5。画像の縮小と回転。libvips は `@img/sharp-libvips-*` として同梱される。`docs/deployment.md` と `docs/development.md` に、apt で libvips を入れる手順は無い。

版を上げたもの（新規のパッケージではない）:

- `puppeteer` 25.15.0（develop は `^24.35.0`）。`engines.node` は `>=22.12.0`。
- `next` 16.4.2（develop は 16.1.2）。
- `next-auth` 5.0.0-beta.32（develop は `^5.0.0-beta.30`）。

開発専用で、本番の実行には入らない: `fast-check`、`@playwright/test`。Playwright の Chromium は CI 用。`docs/ci.md` は `npx playwright install chromium` で、`--with-deps` は使わない。

システム側:

- Node.js は 22.12 以上。`package.json` の engines、`docs/deployment.md`、`docs/development.md`、`docs/feature-branch-testing.md` が同じ。本番 VM が Node.js 20 のままだと、puppeteer 25 の価格チェック用ブラウザは起動しない。上げる作業はこのリポジトリの外。
- Chrome の取得に `unzip` が要る。`npm install`（手順は `docs/deployment.md`）と `npm ci`（`docs/development.md`、`docs/feature-branch-testing.md`）は、puppeteer 25.15.0 の postinstall（`install.mjs`）で Chrome for Testing の zip を取る。展開は `@puppeteer/browsers` 3.2.5。Linux では `unzip` コマンドを使う。`yauzl` は任意の peer で、`package-lock.json` には入っていない。`unzip` が PATH に無いと zip を展開できない。手順書には `unzip` とは書いていない。
- Chrome を動かす共有ライブラリは、`docs/development.md` の「Puppeteerがクラッシュする」。Ubuntu / Debian の例は `libnss3`、`libatk1.0-0`、`libatk-bridge2.0-0`、`libcups2`、`libdrm2`、`libxkbcommon0`、`libxcomposite1`、`libxdamage1`、`libxfixes3`、`libxrandr2`、`libgbm1`、`libasound2`。本番の OS に入っているかは未確認。

今の価格チェックは、Chrome をサンドボックス付きで起動する（`src/lib/page-browser.ts` は `headless: true` だけ）。`--no-sandbox` には落とさない。

## 既存の本番 DB

起動時に、列と表を足す。消したり、名前を変えたりはしない。手順の本体は `docs/database.md` の「スキーマ変更の前のバックアップ」。新しいコードでプロセスを上げる前に、アプリを止め、`sqlite3` の `.backup` で一貫したコピーを取る。`cp` だけだと WAL が別ファイルに残ることがある。

このブランチが既存の DB に足すもの:

- `users.session_generation`（既定 0）
- `comparison_groups` の `origin`、`capture_id`、`budget_item_id`
- `items` の `source_item_code`、`price_fetched_at`
- 表 `captures`、`capture_candidates`、`capture_ai_usage` と、その索引
- `PRAGMA user_version` を、今より小さいときだけ 1 にする。すでに 1 以上なら下げない
- 接続のたびに `foreign_keys = ON`。ファイルには残らない

`migrateDb` は、既存の会員や商品の行を `DELETE` しない。メールアドレスを `LOWER(TRIM())` に揃える処理は develop から引き継いでいる。正規化後が他の行とぶつかるときは、その行を変えず、行も消さない。期限切れの検索候補を消すのは、ゲストの後片付けのときだけ。DB を開いただけでは走らない。新しい表なので、写真を使う前の本番 DB にはその行は無い。

SQLite は、外部キーを有効にしても、すでに入っている違反行を走査して消さない。

戻すときはアプリを止める。`-wal` と `-shm` を消してから、取る前の `.backup` を `sqlite3` の `.backup` で `data/butuyokuoh.db` に戻し、止めていた方のコードで起動する。行を `DELETE` して戻さない。`BUTUYOKUOH_DB_PATH` を変えている場合は、そのファイルを対象にする。

#209 の結論（未マージ。上の差分には入っていない）: develop 形の既存 DB を開いても行は減らない。`src/lib/db.ts` は無変更。テストだけ。起動は例外で終わらず、外部キーを切った状態で入りうる壊れた行も残る。`user_version` がすでに 1 以上なら下げない。

## 登録メールの確認（#112）

このリリースには入っていない。

#112 は、登録時のメール確認と、登録・ログインの試行回数の制限。仕様は Issue の付録Bへのリンクで、このブランチにその実装は無い。`src/app/api/auth/register/route.ts` は、形式とパスワード長を見たあと、すぐ会員を作り、クッキーを出す。確認を待たない。`src/lib/email.ts` は正規化と形式の検査だけで、メールは送らない。下書きのプライバシーも「確認メールは送りません」と書いている。試行回数の制限も、この Issue の範囲では入っていない。

## まだ確認していないこと

- 実機。iPhone Safari、Android Chrome、デスクトップで写真の流れを通していない。手順は `docs/feature-branch-testing.md` にある。
- 本番ホストの OS。exe.dev の VM がどの OS か、`unzip`、Chrome の共有ライブラリ、サンドボックスが通るかは見ていない。
- 未マージの PR。#208、#209、#210、#211。中身は下の節。この確認の差分には入っていない。

## 法的な判断が要る点

下書きは実装の説明で、法令への適合は宣言していない。次は人が決める。文面はここに写さない。

- Amazon アソシエイトである旨を出すか。参加の有無、運営者名、載せる場所。
- 楽天アフィリエイトである注記が要るか。文言。
- 楽天の価格の注意と「Supported by Rakuten Developers」が、公式の求めと一致しているか。出費予定にはクレジットが無い。検索候補の各行は取得時刻だけで、価格の注意文は無い。
- Yahoo! の API クレジットを規定どおり出すか。リンクに「広告」「PR」が要るか。アフィリエイト用の ID は無い。
- 商品リンク全般に「広告」や「PR」が要るか。下書きの外部タグの文は、広告用・解析用のスクリプトが無い、という実装の説明のまま。
- 退会でアップロードを消す例外。他の会員が同じファイルを指しているときは残すことがある。下書きに書くか。
- ショップが2件以上の写真グループでは、価格の再取得でその URL のページを取らない。下書きにその例外を書くか。まとめての価格確認（未購入、ゴミ箱に無い、商品コードが無い、写真グループに入っていない）は実装と合う。

## 未マージ

次の PR は `feature/photo-capture` にまだ入っていない。develop との差分には混ぜない。

- https://github.com/maishu-kobo/butuyokuoh/pull/208 退会時、その会員のアップロードだけ消す。未マージなので、上の差分には入っていない。
  - このリリースでは、所有記録の無い古い十六進ファイルは消さない。残す。
  - ファイル削除は、退会の DB トランザクションが commit したあとだけ。失敗はログして throw しない。ロールバックしてもファイルは残る。
  - スキーマの追加（表 `member_uploads` と索引 2 つ）は Dev Lead が承認した。既存の行は消さない。
- https://github.com/maishu-kobo/butuyokuoh/pull/209 既存 DB を開いても行は減らない。`db.ts` は無変更。テストだけ
- https://github.com/maishu-kobo/butuyokuoh/pull/210 Chrome はサンドボックスを先に試し、`No usable sandbox!` のときだけ `--no-sandbox` に一度落とす
- https://github.com/maishu-kobo/butuyokuoh/pull/211 プライバシーと利用規約の事実関係
