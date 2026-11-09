# WORKLOG

エージェント／作業者向けの進行ログ。仕様の正本ではない。使い方の索引は [README.md](./README.md)。

## 2026-11-06 — CI を Blacksmith から GitHub-hosted へ緊急移行

### 決定

- Sota 承認範囲は「緊急 PR の作成のみ」。`main` へのマージ・本番デプロイ・production workflow の手動起動・secret / 環境変数の変更・VPS runner 追加・課金発生・レビュアー依頼はしない。
- 公開リポジトリの標準 GitHub-hosted Linux（`ubuntu-24.04`、4 vCPU / 16 GB、無料）へ全実行可能ジョブを寄せる。private 向け 2-core 主張は使わない。
- `Select CI runner` / `github_hosted_only` / Blacksmith Environment・CLI・API は通常 CI 経路から外す。ジョブ名・検査内容・権限・main 配備ゲートは維持する。
- `develop` 向け differential baseline の赤は Sota が nonblocking とし、本 PR では直さない。
- 開いている作業との関係: #287 / #232（Blacksmith 予算・試行）は参照のみ。`Closes` は付けない。無関係な draft PR #347 / #257 には触れない。

### 結果

- Draft PR: https://github.com/maishu-kobo/butuyokuoh/pull/371（head `733b739`、base `main`）。レビュー依頼なし。
- `.github/workflows/*.yml` の `runs-on` を `ubuntu-24.04` に統一。
- `ci.yml` から `select-runner` と Blacksmith CLI 呼び出しを削除。`deploy-main.yml` は reusable CI を引数なしで呼び、deploy ジョブも `ubuntu-24.04`。
- `tests/deploy-runner-routing.test.ts` を「全 workflow が GitHub-hosted のみ」を検証する形へ更新。
- `docs/ci.md` を現行方針へ更新。本エントリと AGENTS からのポインタを追加。
- ローカル検証: `npm test` 740 pass、`tsc` / lint（既存 warning 17）/ build 成功。PR checks 起動時の job labels はすべて `ubuntu-24.04`（GitHub Actions runner）。

### 残るもの

- 本 PR は draft のまま。マージは人間（Sota）判断。マージ後に初めて main push の deploy 経路が走る。
- GitHub Environment `blacksmith-budget` と変数／secret の削除はリポジトリ設定変更のため本 PR 外。
- `scripts/blacksmith-*` と単体テストは履歴用に残置（workflow 非参照）。削除や Issue #287 クローズは別判断。
- production 配備そのものの動作確認は未実施（禁止）。
- PR checks の最終成否は push 時点では pending（develop diff の既知赤は nonblocking・本 PR 対象外）。

## 2026-11-09 — #382 取得失敗の価格・画像をエージェントから補う

### 決定

- 専用ツールは増やさず、MCP `update_item` と REST `PATCH /api/agent/v1/items/:id` を拡張する。受け付ける公式名は `current_price` と `image_url` だけ。`price` / `original_price` / `target_price` / `imageUrl` の別名は新規・更新とも 400 のまま。
- 許可判定はフィールド単位の「null かどうか」。取得済み（または既に埋めた）側へ送ると 409 `MEDIA_ALREADY_SET` で、混在ボディ（メモ + 価格など）も丸ごと適用しない。null・空文字で消すのは 400。
- `current_price` は 0 より大きい有限の数（円）。`image_url` は画面表示と同じ安全性に加え、公開ホストの `https:` だけ。名前解決（私設アドレスの拒否）は認証・スコープ検査のあとに `updateAgentItem` の中で行う。
- 状態の再検査と更新は `db.transaction(...).immediate()` の中で行い、名前解決の間にゴミ箱へ入った・別の書き手が価格を入れた場合は 409 で何も書かない。埋めた価格は `price_history` に 1 行。`original_price` / `scrape_status` / `scrape_error` は触らない（取得が失敗した事実は残す）。
- 新規登録（`add_item` / `add_item_by_url`）は従来どおりサーバー取得のみ。クライアントの価格・画像は 400。
- `AgentItemView` と `AgentStoreView` に `scrape_status` / `scrape_error` を足し、エージェントが「補ってよい」条件を見分けられるようにした。

### 結果

- 実装: `src/lib/agent-items.ts`（`updateAgentItem` を async 化）、`src/lib/agent-tools.ts`（スキーマ・説明・pre-auth 構文検査）、`src/app/api/agent/v1/items/[id]/route.ts`。
- テスト: `tests/agent-manual-media.test.ts`（REST / 実 MCP / 予算 / 価格履歴 / 別名 / 不正値 / 認証順序 / 競合）。`tests/agent-api.test.ts` と `tests/e2e/agent.spec.ts` の「取得済み価格への PATCH」は 400 から 409 `MEDIA_ALREADY_SET` に変更。
- 文書: `public/openapi/agent-v1.yaml`、`public/llms.txt`、MCP initialize の instructions（日英）、接続カードの文面、`/terms`、`/help/agents`、`docs/features.md`、`CHANGELOG.md`。

### 残るもの

- e2e（`npm run test:e2e`）はこのセッションでは未実行（ブラウザ環境なし）。期待値の変更だけ入れた。
- 手動で埋めたあとも `scrape_status` は `failed` のまま。Web カードの失敗表示を手動設定で消すかは別 Issue で判断する。
- #381（MCP からゴミ箱を完全削除できない）は別作業。

### レビュー後の修正（同日）

- DB の状態に依存する検査（カテゴリ・比較グループの所有と存在、ゴミ箱、媒体が空か、URL の重複）を、画像ホストの名前解決のあとの `immediate` トランザクションの中へ移した。名前解決の間にカテゴリが消えても通常の 400 `INVALID_RELATION` で、外部キー違反の 500 にも部分書き込みにもならない。トランザクション前に残した DB 読みは所有確認（404）だけ。
- `image_url` は「https://」で始まる絶対 URL だけを受け付け、`new URL` の `href`（ホスト小文字・フラグメント無し）で保存する。`https:cdn.example/a.png` や `https:/cdn.example/a.png` はブラウザが基底 URL で別の場所と解釈するので 400。
- `current_price` に上限 `AGENT_MANUAL_PRICE_MAX`（1,000 億円）を置き、MCP スキーマと OpenAPI に `maximum` として書いた。数量上限 999 を掛けても安全な整数に収まり、予算合計が JSON で null にならない。小数は引き続き可。
- view の `scrape_error` は定型文（待機ページ・ボット制限・一般失敗）だけを出し、定期チェックや Web 再取得が残した内部の例外文は出さない。種別は `scrape_error_code`（`BOT_CHALLENGE` / `FETCH_FAILED`）で残す。
- 文書（MCP 説明、initialize の日英 instructions、llms.txt、OpenAPI、ヘルプ、接続カード）は「判定は各フィールドが null かどうかだけで、scrape_status は見ない。手動品目や一部取得の品目も同じ」に揃えた。
- `update_item` は画像ホストの名前解決で外部 DNS に触れるため `openWorldHint: true`。入力スキーマ（`additionalProperties: false`、`required: ['item_id']`）は変えていない。

### 2 回目のレビュー後の修正（同日）

- 名前解決の前に、所有（404）・ゴミ箱（409 `ITEM_TRASHED`）・埋めようとした価格や画像に値がある（409 `MEDIA_ALREADY_SET`）を先に返す。外部ホストが解決できなくても順序は同じ。同じ検査は書き込みトランザクションの中でも繰り返す（競合対策はそのまま）。`tests/e2e/agent.spec.ts` の「値がある品目へ `.example` の画像 URL で 409」と同じ形を、DNS 呼び出しゼロの確認つきでユニットテストに足した。
- 定型の失敗文は、それを出す側の実際の種別で分類する。`PRODUCT_FETCH_BLOCKED_HELP`（product-html の isBotChallengedHtml）と `AMAZON_BOT_NOTE`（scraper）は `BOT_CHALLENGE`、`PRODUCT_FETCH_HELP` は `FETCH_FAILED`。add の `media_fetch_errors`、`get_item`、`list_items` で同じ分類になることをボット対策ページの fixture で確認。
- OpenAPI 3.1 の新しい null 許容プロパティ（`scrape_status` / `scrape_error_code` / `scrape_error`、root と stores）は `nullable` ではなく `type: [string, 'null']` と null を含む `enum` で書いた。view の `scrape_status` も `success` / `failed` / null 以外は出さない。`image_url` の pattern は実装（スキームの大文字小文字を問わない）に合わせて `^[Hh][Tt][Tt][Pp][Ss]://` にし、MCP スキーマと OpenAPI で同じ値にした。
