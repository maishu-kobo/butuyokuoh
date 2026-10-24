# feature/photo-capture を develop に入れる前の確認

`origin/feature/photo-capture`（`44e1b2d1c1670084ed53c10d9b8dafa94f581a59`）と `origin/develop`（`f11349adccc6580b01e440391311f42ebcb350f4`）を読んで書いた。本番、本番のデータベース、秘密は見ていない。このファイルは確認メモで、アプリの挙動は変えない。

下の「develop との差分」は、その2つのブランチのあいだにあるものだけ。まだマージしていない PR は「未マージ」に分け、中身は差分に入れない。

## develop との差分

### 写真から登録

会員の「新しいアイテムを追加」に、写真から商品を探して登録する入口がある。初期状態はオフ。`CAPTURE_ENABLED` が `true` のときだけ入口と API が出る。推定は、それに加えて `CAPTURE_AI_ENABLED` も `true` のときだけ。ゲストには入口を出さない。

送る前に、ブラウザが長辺 1600px の JPEG へ縮小する。5MB を超える写真は送らない。デスクトップでブラウザが復号できない HEIC / HEIF は、サーバが JPEG にしてから判定する。画素の宣言が上限を超えるもの、画素サイズの書いていないものは復号しない。サーバは位置情報を落とす。判定へ渡すのは JPEG だけ。写真のファイルはデータベースに保存しない。

推定は Cloudflare Workers AI。キーが無い、判定できない、回数やニューロンの上限のときは、商品名の手入力に戻る。テスト用の商品名を返すのは、開発でテストフックがオンのときだけ。本番では返さない。確かなときは商品名を1つ、迷うときは3つまで。判定の一時的な失敗は1回送り直す。モデルが読めないと言ったときは送り直さない。

候補は Yahoo! ショッピングと楽天市場の API。キーが無い店は検索しない。両方無いときは候補を出さず、手入力へ戻す。Amazon の商品 API は使わない。検索結果へのリンクだけを出す。候補は30分で消える。候補が2件以上のときは1つの比較グループとして登録し、リストでは1枚のカードにする。1件のときは比較グループを作らず、URL から登録した商品と同じ1件にする。本体を付属品より前に出す。店の検索語に「-ケース」のような除外は足さない。開いた店ごとの削除、優先度、比較グループの変更は、そのグループの店に効く。

候補の画像 URL が無い、または `img` の読み込みに失敗したときは、64px 四方の「画像なし」を出す。商品名は画像の枠の中には入れず、横の本文に残る。その候補の選択と登録はできる。

### 価格

定期のページ取得（`priceCheckItems`）が外すのは、商品コードがあるものと、`origin` が `photo` の比較グループに入っているもの。1件の登録は比較グループを作らない。商品コードが空なら、この定期の対象に残る。

手動の再取得は、店が2件未満ならページを取りに行く。ページを取らない再取得は、ゴミ箱に無い店が2件以上の写真グループだけ。

楽天の商品コードがある未購入の商品は、`scripts/check-prices.ts` が24時間ごとに楽天の API で価格を取り直す。この取り直しは `CAPTURE_ENABLED` を見ない。`RAKUTEN_APP_ID` と `RAKUTEN_ACCESS_KEY` が両方あるときだけ動く。止めるには、その2つの鍵を外す。

`RAKUTEN_AFFILIATE_ID` があるとき、楽天の検索の商品 URL はアフィリエイトのリンクになり得る。無いときは付けない。`AMAZON_ASSOCIATE_TAG` があるときだけ、Amazon の検索リンクに `tag` が付く。

### 出費

写真グループの出費は、購入済みが複数あれば、その購入済みを全部数える。`tests/capture-photo-spend.test.ts` は2件で700。未購入のときは、選んだ候補か、最安の1件。候補を全部は足さない。出費予定の行は、複数店でも見出しやインデントを付けない。

写真の比較グループは、保存した計上を消して自動の最安へ戻せる。手動の選択があるとき、そのグループの先頭の表示行に「自動（最安）に戻す」が出る。押すと `budget_item_id` を空にする。失敗すると「合計に数える商品の設定を保存できませんでした。もう一度お試しください。」と出し、保存中はボタンを止める。左の四角いチェックは一時的な小計で、保存した候補とは別。購入済みを全部数えることと、未購入は選んだ候補か最安の1件であることは変わらない。予算の取得が `budget_selected_item_id` を返すのは、`origin` が `photo` のときだけ。

### 会員、ログイン、退会

Google のクライアント ID かシークレットが無い、または空白だけのときは、「Googleでログイン」を出さない。両方あるときは今までどおり。メールとパスワードのログインは残る。Google で同じメールの会員に結ぶと、その会員のパスワードは消し、ログインの世代を進めて、それまでのトークンを使えなくする。

退会は、その会員の行（商品、価格履歴、撮影、候補、カテゴリ、比較グループ、通知設定、判定の回数、所有記録）を消す。ゲストの行は消さない。消すファイルのパスは、その DB トランザクションの中で集める。commit のあと、`removeUploadsBestEffort` で消す。失敗はログして throw しない。commit しなければファイルは残る。消すのは、所有記録のある十六進、その会員の `会員id_時刻.拡張子`、その会員の image_url が指し他の会員の参照も所有も無いファイル。十六進で所有記録が無くても、この条件なら消す。残すのは、参照も所有記録も無い十六進。その十六進はディレクトリを走査して消さない。その会員の `会員id_時刻.拡張子` だけ、アップロードディレクトリの名前から集める。

本番（`NODE_ENV` が production）では、会員のクッキー `butuyokuoh_token` とゲストのクッキー `butuyokuoh_guest` の両方に Secure が付く。

### プライバシーと利用規約

`/privacy` と `/terms` は下書き。画面に「確定したプライバシーポリシーではありません」「確定した利用規約ではありません」と出る。下書きの日付は 2026-10-23。同意したとみなす文は無い。

下書きの事実関係は、実装に合わせてある。写真はこのアプリのリクエストに届く。判定機能がオンで、使える Cloudflare のアカウント ID と API トークンが両方あるときだけ、`api.cloudflare.com` へ送る。キーが無い、または使えないときは送らない。データベースには保存しない。判定の記録には、回数に加えて各回のニューロン数も残る。ゲストのクッキー `butuyokuoh_guest` も、本番では Secure が付く。人が決める点は、下の「法的な判断が要る点」に分けた。

### 取り込み済みの不具合と、開発側の検査

develop に入っている既存の修正を、このブランチへ取り込んである。購入日の暦日、統計の個数、拡張機能のゴミ箱の重複、比較グループを消したときに撮影の参照を外す、登録 API の本文サイズ、依存関係の high / critical を 0 にする、を含む。

CI は、単体テスト・型・ビルド・lint・audit の速いレーンと、Playwright・CodeQL・依存差分・秘密スキャンの重いレーンに分かれる。CodeQL は、解析と SARIF の取り込みが失敗したらジョブを落とす。本番の起動には使わない。

### Chrome の起動

ページ取得の Chrome は、サンドボックス付きで先に起動する。起動が `No usable sandbox!` で死んだときだけ、`--no-sandbox` と `--disable-setuid-sandbox` で一度やり直す。ほかの失敗ではやり直さない。

### 既存 DB を開いたとき

develop 形の DB を開いても行は減らない。#209 のテストは `src/lib/db.ts` を変えていない。足す列と戻し方は、下の「既存の本番 DB」。

実行環境は Node.js 22.12 以上。puppeteer は 25.15.0。詳細は「実行時の依存とシステムパッケージ」。

### 秘密ファイル

`CAPTURE_SECRETS_FILE` は、開いた記述子だけを調べる（`5de2d5811a0dc7f58ebb138a4091ec7f3c5d1c9c`）。開く前に `lstat` しない。`O_RDONLY`、`O_NOFOLLOW`、`O_NONBLOCK` で一度開き、その記述子を `fstat` する。通常ファイルで、モードが `0600`、8192 バイト以下、リポジトリの外であり、`realpath` の inode が開いた記述子と一致するときだけ中身を読む。`getuid` があるときは、所有者の uid がプロセスと違うファイルは使わない。どれかが違えば使わない。中身は開いた記述子から読む。値はここに書かない。

### 任意のコミット前チェック

希望する開発者だけが、`npm ci` のあと `npm run hooks:install` を実行する。このリポジトリのローカル `core.hooksPath` を `.githooks` にする。他のリポジトリとグローバル設定は変えない。同じリポジトリの worktree はそのローカル設定を共有する。別のフック設定は上書きしない。worktree 固有のフック設定があると止める。pre-commit は、ステージ済みの空白と競合、ステージ済みの JS/TS だけを ESLint する。未ステージの差分は検査しない。自動修正、`git add`、stash はしない。`eslint.config.*`、`tsconfig.json`、`package.json`、`package-lock.json` がインデックスと作業ツリーで違うときは止める。外すのは `npm run hooks:uninstall` だけで、自動では外さない。`npm run verify:fast` は `tsc --noEmit` と単体テストを、実行した人が明示的に走らせる。pre-push フックは無い。ローカルフックは回避できる。

### アップロードと退会のテスト

テストだけ。`tests/upload-test-directory.ts` が、アプリのモジュールを読む前に、プロセスごとの一時ディレクトリへ移動する。終わったら元のディレクトリへ戻り、一時ディレクトリを消す。`tests/upload-image.test.ts` と `tests/account-deletion.test.ts` が、これを先に読む。2つのテストは保存先を共有しない。本番のアップロード先は変えていない。

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
- Chrome の取得に `unzip` が要る。`npm install`（手順は `docs/deployment.md`）と `npm ci`（`docs/development.md`、`docs/feature-branch-testing.md`）は、puppeteer 25.15.0 の postinstall（`install.mjs`）で Chrome for Testing の zip を取る。展開は `@puppeteer/browsers` 3.2.5。Linux では `unzip` コマンドを使う。`yauzl` は、そのパッケージの optional peer として `package-lock.json` に宣言がある。解決済みのパッケージとしては無い。`unzip` が PATH に無いと zip を展開できない。手順書には `unzip` とは書いていない。
- Chrome を動かす共有ライブラリは、`docs/development.md` の「Puppeteerがクラッシュする」。Ubuntu / Debian の例は `libnss3`、`libatk1.0-0`、`libatk-bridge2.0-0`、`libcups2`、`libdrm2`、`libxkbcommon0`、`libxcomposite1`、`libxdamage1`、`libxfixes3`、`libxrandr2`、`libgbm1`、`libasound2`。本番の OS に入っているかは未確認。

ページ取得の Chrome は、上の「Chrome の起動」と同じ。サンドボックスを先に試し、`No usable sandbox!` のときだけ `--no-sandbox` で一度落とす。

## 既存の本番 DB

起動時に、列と表を足す。消したり、名前を変えたりはしない。手順の本体は `docs/database.md` の「スキーマ変更の前のバックアップ」。新しいコードでプロセスを上げる前に、アプリを止め、`sqlite3` の `.backup` で一貫したコピーを取る。`cp` だけだと WAL が別ファイルに残ることがある。

このブランチが既存の DB に足すもの:

- `users.session_generation`（既定 0）
- `comparison_groups` の `origin`、`capture_id`、`budget_item_id`
- `items` の `source_item_code`、`price_fetched_at`
- 表 `captures`、`capture_candidates`、`capture_ai_usage` と、その索引
- 表 `member_uploads`（`name` が主キー）と索引 `idx_member_uploads_user`、`sqlite_autoindex_member_uploads_1`。足すだけ。既存の行は消さない
- `PRAGMA user_version` を、今より小さいときだけ 1 にする。すでに 1 以上なら下げない
- 接続のたびに `foreign_keys = ON`。ファイルには残らない

`migrateDb` は、既存の会員や商品の行を `DELETE` しない。メールアドレスを `LOWER(TRIM())` に揃える処理は develop から引き継いでいる。正規化後が他の行とぶつかるときは、その行を変えず、行も消さない。期限切れの検索候補を消すのは、ゲストの後片付けのときだけ。DB を開いただけでは走らない。新しい表なので、写真を使う前の本番 DB にはその行は無い。

SQLite は、外部キーを有効にしても、すでに入っている違反行を走査して消さない。

戻すときはアプリを止める。`-wal` と `-shm` を消してから、取る前の `.backup` を `sqlite3` の `.backup` で `data/butuyokuoh.db` に戻し、止めていた方のコードで起動する。行を `DELETE` して戻さない。`BUTUYOKUOH_DB_PATH` を変えている場合は、そのファイルを対象にする。

develop 形の既存 DB を開いても行は減らない。#209 は `src/lib/db.ts` を変えず、`tests/develop-schema-open.test.ts` だけを足した。上の `member_uploads` も、既存の行は消さない。

## 登録メールの確認（#112）

このリリースには入っていない。

#112 は、登録時のメール確認と、登録・ログインの試行回数の制限。仕様は Issue の付録Bへのリンクで、このブランチにその実装は無い。`src/app/api/auth/register/route.ts` は、形式とパスワード長を見たあと、すぐ会員を作り、クッキーを出す。確認を待たない。`src/lib/email.ts` は正規化と形式の検査だけで、メールは送らない。下書きのプライバシーも「確認メールは送りません」と書いている。試行回数の制限も、この Issue の範囲では入っていない。

## まだ確認していないこと

- 実機。iPhone Safari、Android Chrome、デスクトップで写真の流れを通していない。手順は `docs/feature-branch-testing.md` にある。
- 本番ホストの OS。exe.dev の VM がどの OS か、`unzip`、Chrome の共有ライブラリ、サンドボックスが通るかは見ていない。

## 法的な判断が要る点

下書きは実装の説明で、法令への適合は宣言していない。次は人が決める。文面はここに写さない。

- Amazon アソシエイトである旨を出すか。参加の有無、運営者名、載せる場所。
- 楽天アフィリエイトである注記が要るか。文言。
- 楽天の価格の注意と「Supported by Rakuten Developers」が、公式の求めと一致しているか。出費予定にはクレジットが無い。検索候補の各行は取得時刻だけで、価格の注意文は無い。
- Yahoo! の API クレジットを規定どおり出すか。リンクに「広告」「PR」が要るか。アフィリエイト用の ID は無い。
- 商品リンク全般に「広告」や「PR」が要るか。下書きの外部タグの文は、広告用・解析用のスクリプトが無い、という実装の説明のまま。
- 退会でアップロードを消す例外。他の会員が同じファイルを指しているときは残すことがある。下書きに書くか。
- ショップが2件以上の写真グループでは価格の再取得でページを取らない、という例外を下書きに書くかは人が決める。

## 未マージ

`feature/photo-capture` 向けに開いている draft。番号と題だけ。中身は develop との差分に入れない。

- #196 検索サービスの出典と任意のAmazon広告表示
- #201 写真候補のURLを自動反映し再入力なしで登録
- #203 ダークモードの行ホバーと選択時の配色

この文書の PR 自体は未マージのまま。
