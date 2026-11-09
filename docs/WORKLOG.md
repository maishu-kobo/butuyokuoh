# WORKLOG

エージェント／作業者向けの進行ログ。仕様の正本ではない。使い方の索引は [README.md](./README.md)。

## 2026-11-09 — エージェントからゴミ箱の品目を1件だけ完全削除（#381）

### 決定

- 削除ロジックは新しく書かず、Web の `DELETE /api/trash/[id]` と MCP / REST で `purgeTrashedItem`（`src/lib/item-input.ts`）を共有する。所有者確認とゴミ箱判定は同じ `immediate` トランザクションの中で行い、消し順は Web と同じ `price_history` → `notification_settings` → `items`。
- 戻り値は `purged` / `not_trashed` / `not_found` に分け、Web は従来どおりまとめて 404、エージェントは `not_trashed` を 409 `ITEM_NOT_TRASHED`、`not_found` を 404 `ITEM_NOT_FOUND` にする。2 回目は 404（`trash_item` のような冪等成功にしない）。
- ツール名は `purge_item`。`scope: write`、`auditAction: items.purge`、`destructiveHint: true` / `idempotentHint: false`。操作ログには `item_id` も残す（元に戻せないため）。
- ゴミ箱全件を空にする操作（Web の `DELETE /api/trash`）はエージェントに公開しない。テストで「破壊的ツールは `trash_item` と `purge_item` だけ」「品目一覧・品目本体に `DELETE` が無い」を固定した。

### 結果

- 追加: `purgeAgentItem`、MCP `purge_item`、REST `DELETE /api/agent/v1/items/{id}/trash`。`tests/trash-url-restore-mcp.test.ts`・`tests/agent-api.test.ts`・`tests/trash-url-restore.test.ts` に挙動テスト。完全削除後の同一 URL は `restored_from_trash` にならず再取得で新規 INSERT になることを固定。
- 文面: `/help/agents`・`/terms`・`/privacy`・接続カードの例・MCP initialize の instructions（日英）・`llms.txt`・OpenAPI から「完全削除はできない」を外し、「ゴミ箱の自分の品目を1件ずつだけ」に直した。

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
