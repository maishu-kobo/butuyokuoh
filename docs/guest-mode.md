# ゲスト体験

Issue #69（実装 #70〜#73）の初期版。データ引き継ぎは #74 で扱い、この版では実施しない。

## 利用者の動作

ログイン画面の「ゲストで試す」から、個人情報を入力せずに開始する。
ブラウザのCookieごとに独立した一時ユーザーを作成し、商品6件（未購入4・購入済み1・ゴミ箱1）、カテゴリ3件、比較グループ2件、価格履歴を投入する。
商品画像は共通のローカルSVGで、商品・価格はデモであることを表示する。

開始から24時間の固定期限。同じCookieで再開しても期限を延長せず、サンプルを重複投入しない。
同一ブラウザのタブは同じデータを使う。Cookieを削除すると元のデータに戻れない。
期限切れは全APIで拒否し、画面は再開を自動実行しない。
終了操作は体験データを即時削除する。期限切れ・放置したデータは毎時の清掃で削除する。

- 利用可能: 商品の手動追加・編集・購入・ゴミ箱・復元・完全削除、カテゴリ・比較グループ、検索・並べ替え・価格履歴・集計・予算・CSV出力・テーマ。
- ログイン後に利用可能: URL取得・再取得、インポート、画像追加、通知設定、拡張機能トークン。
- Googleログイン前に引き継がれない旨を確認する。成功後はサーバーが確認した通常ユーザーを優先し、ゲストデータを削除する。失敗・キャンセル時はゲストを保持する。

## 認証と保存

`users.account_type` は既存ユーザーを `member` として移行する。ゲストは `guest` で、DBのNOT NULL制約に合わせた予約メール `guest-<UUID>@guest.invalid` を持つ。公開ユーザー情報のemailはnull。予約ドメインでの通常登録・Google認証を拒否する。

32バイトの乱数トークンを `butuyokuoh_guest` Cookie に保存し、DBの `guest_sessions` にはSHA-256ハッシュ・user_id・開始/期限（UTC epoch ms）だけを保存する。
CookieはHttpOnly・SameSite=Lax・Path=/・ホスト限定、本番ではSecure。期限は固定。

認証優先順位は通常のNextAuth → 通常の既存JWT → ゲスト。ゲストIDで署名されたJWTも通常認証・拡張機能認証に使用できない。
個別の認証設定エラーはゲストへ黙ってフォールバックしない。
`/api/auth/me` を画面の認証状態の正とし、ユーザー切替時は画面コンポーネントを再生成して前ユーザーのキャッシュを破棄する。
画面復帰・タブ復帰・期限到達・APIの401で状態を再確認する。

既存APIは `withAccess` を適用し、ゲスト許可を明記したルートのみ受け付ける。新しい保護APIもこのラッパーを使用する。
ゲストの全書込と開始・終了には、設定された公開URLと一致するOriginを要求する。
16KiBのボディ上限・項目型/長さ/数値の検証を行い、カテゴリ・比較グループの所有権は通常ユーザーにも検証する。
ゲストによる外部画像指定を拒否し、価格取得ジョブと通知送信の双方で通常ユーザーに限定する。

## 運用設定

既定では無効。Webと清掃処理が同じDBを参照するように配置する。
`.env.local`（Git管理外）に設定する。清掃コマンドもNext.jsと同じ環境ファイルを読み込む。

| 変数 | 既定値 | 意味 |
| --- | --- | --- |
| `GUEST_MODE_ENABLED` | false | `true` で有効 |
| `AUTH_URL`（または `NEXTAUTH_URL`） | 本番必須 | ブラウザから見た公開URL。Origin照合に使用 |
| `GUEST_ALLOWED_ORIGINS` | なし | 別の公開Originも使う場合だけ、カンマ区切りで追加。例: `https://butsuyokuoh.exe.xyz`。パス・末尾スラッシュを含めない |
| `BUTUYOKUOH_DB_PATH` | `data/butuyokuoh.db` | Web・ジョブ共通のSQLiteパス |
| `GUEST_TTL_HOURS` | 24 | 新規体験の期限。既存セッションには遡及しない |
| `GUEST_MAX_ACTIVE` | 500 | 有効ゲストセッション上限 |
| `GUEST_CREATES_PER_MINUTE` | 30 | DB全体での作成回数/分 |
| `GUEST_WRITES_PER_MINUTE` | 60 | ゲストごとの書込回数/分 |
| `GUEST_MAX_ITEMS` | 50 | 購入済み・ゴミ箱を含む商品数 |
| `GUEST_MAX_CATEGORIES` | 20 | カテゴリ数 |
| `GUEST_MAX_GROUPS` | 10 | 比較グループ数 |
| `GUEST_MAX_HISTORY` | 500 | ゲスト全商品の価格履歴合計 |

数値設定は正の整数。サンプルが入るため、商品6・カテゴリ3・グループ2・履歴18以上で設定する。
Google OAuthの公開URLと異なるポート等でもアプリを公開している場合、追加のOriginを `GUEST_ALLOWED_ORIGINS` に明記する。Host・転送ヘッダーを根拠に自動で許可しない。
件数上限は409、時間あたりの制限と全体混雑は429＋Retry-After、ゲスト禁止機能は403、セッション不成立は401を返す。
SQLiteの即時トランザクション内で上限チェックと書込を行い、並列要求でも超過させない。
回数カウンタはSQLiteに保存し、プロセス再起動・Cookie削除で作成制限を回避できない。
IP制限は実装しない。転送ヘッダーを信頼せず、DB全体の制限を使用する。公開前に実ホストのプロキシ側制限を確認する。

## 清掃と停止

```sh
npm run cleanup-guests -- --dry-run
npm run cleanup-guests
```

削除対象は期限切れゲストと、セッションを失ったままTTLを過ぎたゲストのみ。
商品・履歴・通知・カテゴリ・グループ・セッションを明示的に削除する。外部キーCASCADEの設定に依存せず、途中失敗はユーザー単位でロールバックする。
バッチ単位で実行するため再実行できる。ログは件数のみで、トークンやメールを出力しない。
共通画像や通常ユーザーのデータは削除しない。
`--dry-run` は対象件数だけを表示する（DB初期化・スキーマ移行は通常どおり実行する）。

systemdの例を `deploy/systemd/butuyokuoh-guest-cleanup.{service,timer}` に置いた。
配置先のユーザー・作業ディレクトリを確認してからインストールする。

```sh
sudo cp deploy/systemd/butuyokuoh-guest-cleanup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now butuyokuoh-guest-cleanup.timer
sudo systemctl start butuyokuoh-guest-cleanup.service
systemctl list-timers butuyokuoh-guest-cleanup.timer
journalctl -u butuyokuoh-guest-cleanup.service
```

緊急停止は `GUEST_MODE_ENABLED=false` にしてWebを再起動する。新規開始・既存ゲストAPIを停止し、通常ログイン・ゲスト終了・清掃は維持する。
清掃タイマーは停止しない。停止後も期限切れデータを削除する。

## 検証と公開前の確認

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run build
E2E_PRODUCTION=1 npm run test:e2e
E2E_PRODUCTION=1 E2E_GUEST_DISABLED=1 npm run test:e2e
```

E2Eは一時ディレクトリの専用DB・ダミー認証鍵・ローカルサーバーを使用する。実データ・Google接続・Webhook送信は使用しない。
通常ユーザーのGoogle OAuth成功経路はテスト用NextAuth JWTでサーバー認証を、画面の切替・後処理は通常ログインで検証する。
本物のGoogle画面を経由する認証、公開HTTPSでのCookie/Origin、実ホストの匿名アクセス設定、清掃タイマーの実稼働は公開先で別途確認する。

公開時は次を記録する。

- デプロイSHAと適用した環境設定（秘密値を除く）。
- ログインしていない別ブラウザでログイン画面と「ゲストで試す」が表示されること。ホスト側認証が必要なら、その設定も確認する。
- HTTPSのSecure Cookieと正しい公開Originで開始・手動編集・終了が成功すること。
- Googleログイン成功/キャンセル、2ブラウザ間の分離、期限切れ後の拒否。
- 清掃コマンドとsystemdタイマーの実行ログ、通常ユーザーのデータが残ること。
- フラグを無効化したときにゲストだけが停止すること。

既存の依存パッケージの脆弱性対応は、この機能とは別に評価する。
