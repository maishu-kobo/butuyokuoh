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
