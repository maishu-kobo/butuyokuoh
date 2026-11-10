# WORKLOG

エージェント／作業者向けの進行ログ。仕様の正本ではない。使い方の索引は [README.md](./README.md)。

## 2026-11-10 — エージェントが商品メモ（notes）を使う（#396）

### 決定

- DB / スキーマは触らず、既存の `items.notes`（`AGENT_NOTES_MAX=2000`、制御文字除去）を使う。notes はスキーマ上任意（欠落で拒否しない）。
- 案内上の既定は「登録時に必ず会話からメモを書く」。ユーザー明示の内容・メモ不要指定を優先。登録前確認なし。
- 登録成功時は常にサーバ組み立ての `memo.tell_user` を返す（MCP の content.text 先頭にも載せる）。`relay=true` のときそのまま伝える。付け忘れは `update_item` で補ってから with-notes の tell_user を伝える。明示空は「メモは付けていません…」。
- ゴミ箱復元では「追加しました」と言わず、リクエスト notes 未適用を案内（Bugbot Medium 対応）。
- 比較候補一括保存へのメモ必須化はスコープ外。

### 結果

- `src/lib/agent-memo.ts`、REST / MCP の add・notes 付き update、MCP text 先頭表示。
- テスト: `tests/agent-memo.test.ts`（tell_user 両ケース、クリア、復元、案内）、e2e `agent.spec.ts`。

## 2026-11-10 — 比較中の商品を1回で同じ比較グループへ保存する（#388）

### 決定

- MCP に `save_comparison_candidates` を足した（`src/lib/agent-comparison-candidates.ts`）。引数は `name` と `candidates`（2〜10件。各要素は `url` か `item_id` のどちらか一方、`url` には任意の `name`）。各候補は独立した商品のまま、手作業比較グループ（`origin = NULL`）に入る。REST には足していない（`create_comparison_group` と同じく MCP のみ）。
- 取得・保存・失敗の記録は新しく書かず、`add_item_by_url` と同じ `prepareStoreMedia` / `insertAgentItem` / `mediaFetchErrors`、グループ作成は `createAgentComparisonGroup` を使う。外部取得はトランザクションの外で逐次、書き込みは 1 つの `immediate` トランザクションで、その中で候補の状態を読み直す。失敗すればグループも商品も所属変更も残らない。
- 再送の扱いは、表も列も足さず、操作ログ（`comparison_candidates.save`）の保存記録で先に判定する。記録は要求の指紋（整形後のグループ名と候補の組の SHA-256。順序と計測パラメータに依らない）、グループ ID、候補ごとの品目 ID と目印（候補のキーのハッシュ。URL は書かない）。指紋の一致は `json_extract` の等値で引き、件数では切らない（残るのは保持期間 `AGENT_AUDIT_RETENTION_DAYS` = 90 日）。記録のグループと品目 ID がそのまま残っていれば、何も書かずに `status: already_saved`（`changed: false`、`replayed: true`、`replay_of`）を返す。グループ名の変更や他の商品の追加はそのまま（今の状態を返す）。記録のあとで候補が外された・移された・ゴミ箱や購入済みになった・削除されたときは 409 `SAVED_REQUEST_CHANGED` で何も書かない（利用者の変更を再送で巻き戻さない。別の行に入れ替わった ID を最初の結果として返さない）。応答が途切れた再送も、取得中に重なった同じ要求も、この照合で 1 回分の保存になる。
- 既存の商品の扱い: 既登録 URL（リスト上・グループなし）は再取得も重複登録もせずその商品を入れる。使うのは指定された名前のグループだけ。候補の一部が入っている手作業比較グループの名前が要求の名前（整形後）と同じなら、新しいグループは作らずそこへ残りを足す（`group.created: false`）。名前が違えば 409 `CANDIDATE_IN_OTHER_GROUP` で何も書かない（そのグループへ足しも、そこから移しもしない）。候補がどのグループにもいなければ、同じ名前のグループが他にあっても新しく作る（名前だけでは照合しない）。同じ URL の生きている行（リスト・購入済み）が複数あるときは 409 `URL_AMBIGUOUS` で `item_id` の指定を求める（判定は `item-input.ts` の `findCleanedStoredUrlMatches` を共有）。別々の比較グループにいる候補同士（409 `CANDIDATES_IN_DIFFERENT_GROUPS`）、同じ商品の店舗比較の店の行（409 `ITEM_IN_STORE_GROUP`）、ゴミ箱（409 `ITEM_TRASHED` / `URL_IN_TRASH`）、購入済み（409 `ITEM_PURCHASED`）は拒否し、移動も復元もしない。登録済みの商品は所属以外（名前・メモ・価格・「エージェントが追加」の印）を変えない。
- 上限は既存の数え方にそろえた。新規 URL があればその件数分の add / add_url / add_day（`add_item_by_url` と同じ）、取得なしでグループを作るなら add / add_day を 1（`create_comparison_group` と同じ）、事前の検査での拒否と変更なしの再送は消費しない。検査は 認可 → 構文・保存記録・候補の状態 → レート → 取得 の順で、確実に失敗する要求は外へ取りに行かない。レートを消費したあとの失敗（取得の失敗、422 `NAME_REQUIRED`、取得中の変化による 409）では戻さない。
- 取得の間の変化: トランザクションの中で保存記録と候補の状態を読み直し、取得の前に見た行・所属・書き先と違えば 409（`CANDIDATES_CHANGED` か個別のコード）で何も書かない。別のグループや新しいグループへ書き先を変えない。同じ要求が先に保存を終えていた場合だけ、その結果を返す。
- 応答の範囲: `write` だけのトークンには、グループ ID・品目 ID・操作の結果だけを返す。商品名・URL・価格・グループ名・件数・保存済みの取得失敗は `read` があるときだけ（拒否の文面でも、グループは ID だけで示す）。
- 接続時の案内（initialize の `instructions`）の 2〜3 行目に、日英で保存方法の選び方を置いた（保存を頼まれたときだけ適用。比較候補は `save_comparison_candidates`、同じ商品の店舗比較は `add_item_by_url` の `urls`、独立した商品と「別々に」は `add_item_by_url` を商品ごとに1回）。`add_item_by_url` / `create_comparison_group` の説明と `llms.txt` も同じ基準にそろえた。

### 結果

- テスト: `tests/agent-comparison-candidates.test.ts`（実 `/api/mcp` 経路と Web の `/api/comparison-groups`・`/api/items`。混在保存、1件失敗で何も残さない、再送、取得中の重複要求、取得中の状態変化、既登録 URL・別グループ・ゴミ箱・購入済み、権限・所有者・入力・上限、従来の単品・複数店舗登録、指紋のプロパティテスト。レビュー対応で、指定した名前のグループだけを使うこと、保存後の利用者の変更を再送で巻き戻さないこと、取得中の移動・除外・入れ替わり、同じ URL の重複行、write だけのトークンへの応答を足した）。`tests/e2e/agent.spec.ts` に、MCP で保存した2件が Web の比較の絞り込みに出る確認を足した。
- 文面: `public/llms.txt`、`docs/features.md`、`CHANGELOG.md`、`/help/agents`、接続カードの頼み方の例。
- 再レビュー対応（2026-11-10）:
  - 保存記録の照合で、`url` の候補は記録した行が今もその URL の商品か（`findCleanedStoredUrlMatches`。計測パラメータ・楽天の包装 URL は同じ商品）も確かめる。`update_item` で URL を書き換えられた行は 409 `SAVED_REQUEST_CHANGED`（候補の位置と品目 ID を示し、取得も書き込みもしない）、同じ URL の生きている行が増えていれば 409 `URL_AMBIGUOUS`。`item_id` の候補は ID に従う。
  - `write` だけのトークンにも `group.name` を返す。値は呼び出し側が指定した名前（整形後）で、現在のグループ名がそれと同じときだけ（作成・追加の成功時は常に同じ）。利用者が改名していれば省き、保存済みの名前は読ませない。
  - 候補がすべて指定の名前のグループに入っていて書くものが無い最初の要求でも、受領を操作ログに 1 件記録する（`changed: false`。商品・グループ・所属は変えず、上限も消費しない）。以後の同じ要求はこの記録と照合され、利用者が Web で外した候補を遅れた再送で入れ直さない。同じ要求を繰り返しても記録は増えない。
  - `resolveCandidate` は URL ごとに品目の表を 1 回だけ読む（`item-input.ts` に `classifyStoredUrlMatches` を分け、`findCleanedStoredUrlRegistration` もそれを使う。振る舞いは同じ）。
  - 「取得中に同じ要求が重なる」テストは、2 つの要求を最初の URL の名前解決で止めて両方そろってから進める形にした（CI で `fetched.length > 2` が実行順に依って落ちたため。重なりの検査は「何も保存されないうちに両方が取得の入口にいる」「両方が 2 件ずつ取得した」に強めた）。

### 制約・残るもの

- 保存記録で再送を見分けられるのは、操作ログの保持期間（`AGENT_AUDIT_RETENTION_DAYS` = 90 日）の間。それを過ぎた再送は現在の状態だけで判定する（候補がすべて指定の名前のグループにいれば `already_saved`、利用者が外していれば新しい保存として扱う）。
- `SAVED_REQUEST_CHANGED` のあとで同じ名前・同じ候補をもう一度まとめるには、別のグループ名で呼ぶか `update_item` を使う（保持期間の間）。
- 新規 URL の取得は既存の複数店登録と同じく逐次（Amazon の取得はブラウザ起動に進むことがあり、並列にしない）。遅いページが続くとクライアントのタイムアウトを超えうるが、同じ引数の再送で安全に続けられる。
- Issue の 3（Grok Bot・Codex・Claude Code での同じ会話の検証）は、配備後に coordinator が行う。この作業では実クライアントでの実行はしていない。
- 「この2台の違いを教えて」で何も保存しないことは、案内とツールの説明で促すだけで、サーバ側では強制できない。実クライアントの検証で確かめる。

## 2026-11-09 — エージェントからゴミ箱の品目を1件だけ完全削除（#381）

### 決定

- 削除ロジックは新しく書かず、Web の `DELETE /api/trash/[id]` と MCP / REST で `purgeTrashedItem`（`src/lib/item-input.ts`）を共有する。所有者確認とゴミ箱判定は同じ `immediate` トランザクションの中で行い、消し順は Web と同じ `price_history` → `notification_settings` → `items`。
- 戻り値は `purged` / `not_trashed` / `not_found` に分け、Web は従来どおりまとめて 404、エージェントは `not_trashed` を 409 `ITEM_NOT_TRASHED`、`not_found` を 404 `ITEM_NOT_FOUND` にする。2 回目は 404（`trash_item` のような冪等成功にしない）。
- ツール名は `purge_item`。`scope: write`、`auditAction: items.purge`、`destructiveHint: true` / `idempotentHint: false`。操作ログには `item_id` も残す（元に戻せないため）。
- ゴミ箱全件を空にする操作（Web の `DELETE /api/trash`）はエージェントに公開しない。テストで「破壊的ツールは `trash_item` と `purge_item` だけ」「品目一覧・品目本体に `DELETE` が無い」を固定した。

### 結果

- 追加: `purgeAgentItem`、MCP `purge_item`、REST `DELETE /api/agent/v1/items/{id}/trash`。`tests/trash-url-restore-mcp.test.ts`・`tests/agent-api.test.ts`・`tests/trash-url-restore.test.ts` に挙動テスト。完全削除後の同一 URL は `restored_from_trash` にならず再取得で新規 INSERT になることを固定。
- 文面: `/help/agents`・`/terms`・`/privacy`・接続カードの例・MCP initialize の instructions（日英）・`llms.txt`・OpenAPI から「完全削除はできない」を外し、「ゴミ箱の自分の品目を1件ずつだけ」に直した。`LEGAL_REVISED_DATE` を 2026年11月9日 にした。
- レビュー対応: `purge_item` の引数は宣言どおり `item_id` だけ（別名 `id`・混在・余分なキー・型違いは 400。他ツールの `id` 別名は維持）。MCP / REST とも、認可 → 検査 → 実行の順にし、`items.purge` の操作ログは実際に消えたときだけ検査済みの `item_id` 付きで書く（拒否は記録しない）。Web と REST の完全削除 `DELETE` のパス id は `parseDecimalRouteId`（10進の数字だけ。`Number("0x1f")` のように別の行を指す表記は 404）。
- レビュー対応 2: 削除と `items.purge` の記録を `purgeAgentItem` の中で同じ接続の 1 つの immediate トランザクションにした（`purgeTrashedItemRows` を呼び出し側トランザクション前提に分け、Web は `purgeTrashedItem` で自前に包む）。記録に失敗すると削除も戻り 500 `PURGE_FAILED`（品目と子レコードは残る）。MCP の引数検査は 1 回だけになり、`executeAgentTool` を直接呼んでも同じ記録が残る。`items.purge` の INSERT だけを拒む TEMP トリガで MCP / REST の巻き戻しと再試行をテストした。

### 残るもの

- #382（取得失敗時の価格・画像の手動設定）は別作業。本 PR では触れない。
- e2e（`tests/e2e/agent.spec.ts`）はブラウザ無しで未実行。追加した 409 の確認は CI か手元の Playwright で見る。

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
