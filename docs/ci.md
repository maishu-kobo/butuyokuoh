# CI

`feature/photo-capture`、`feature/capture-existing-bugfixes`、`develop`、`main` 向けの pull request で走る。`ci.yml`、`playwright.yml`、`quarantine.yml` は `develop` への push でも走る。path フィルタは付けない。必須のジョブが skip になると、その SHA のチェックが pending のままになる。権限は `contents: read`。失敗した Playwright の結果を残すジョブだけ `actions: write` を足す。アクションはコミット SHA でピンする。

マージを赤で止める必須ステータスチェックは、GitHub のブランチ保護と ruleset で設定する。このリポジトリのファイルだけでは有効にならない。

## 速いレーン

`.github/workflows/ci.yml`。キャッシュが温かいときの目標は 2 分未満。

| チェック名 | 中身 |
| --- | --- |
| `test, types, build` | 単体テスト、`tsc --noEmit`、本番ビルド、lint。警告は `.github/lint-warning-baseline.json` を超えると落とす |
| `npm audit` | `npm run audit:high`。high は落とす |

単体テストは `node scripts/test-lanes.mjs blocking-unit`。隔離リストが空なら `npm test` と同じファイルを実行する。`tsc` と `next build` は並べない。両方とも `.next/types` を触る。

## 重いレーン

毎回走り、失敗すると止める。速いレーンの完了を待たない。

| チェック名 | ファイル | 中身 |
| --- | --- | --- |
| `playwright` | `.github/workflows/playwright.yml` | 開発サーバの e2e。固定の商品ページ。ジョブの時間制限は 30 分 |
| `production smoke` | 同じファイル | `npm run build` のあと `next start`。キャプチャのテスト用フックは渡さない |
| `guest disabled` | 同じファイル | `GUEST_MODE_ENABLED=false` の `disabled.spec.ts` |
| `analyze` | `.github/workflows/codeql.yml` | CodeQL。解析・取り込み失敗で停止。high は `.github/codeql/high_gate.py` で判定 |

ほかの必須ゲートもそのまま止める。

| チェック名 | 失敗条件 |
| --- | --- |
| `dependency review` | high |
| `gitleaks` | 秘密の検出 |

## CodeQL の結果取り込み

CodeQL は `.github/workflows/codeql.yml` の advanced setup を使う。GitHub のリポジトリ設定にある Default setup を同時に有効にすると、advanced setup の SARIF が拒否される。Default setup は無効に保ち、このワークフローから送信する。切り替えはリポジトリ全体に適用される。

`analyze` は SARIF の送信だけでなく取り込み完了を待つ。actionは待機時間切れや状態取得エラーを警告だけで終える場合があるため、後続ステップでアップロードIDの状態を再取得し、`complete` 以外・ID欠落・APIエラーを失敗にする。解析・取り込みの失敗はジョブを失敗させる。取り込みが失敗しても、既存の high 判定は引き続き実行する。重大度、クエリ、例外リストは取り込みの設定とは別に管理する。確認処理は `.github/codeql/verify_ingestion.sh` にあり、同じスクリプトを偽のGitHub CLIで実行する `verify_ingestion_test.py` を毎回のCodeQLジョブで実行する。処理中・失敗の場合はその状態もログに残す。

確認するときは、対象コミットのログで `Analysis upload status is complete`、CodeQLチェックで正常な取り込み、Code scanningの解析一覧で対象のrefとcommit SHAおよび空のerrorを確認する。単に `Successfully uploaded results` と出ただけでは完了としない。

このワークフローの対象は冒頭の4ブランチ向けPR。mainの既存解析は、[PR #206](https://github.com/maishu-kobo/butuyokuoh/pull/206) の `codeql-main.yml` へ引き継ぐ。main向けPR・push・週次・手動の解析を持ち、JS/TSと既定クエリを維持する。Default setupの解除とmain用ワークフローの適用を両方完了させること。PRを作っただけではmainの継続解析は復旧しない。ブランチ保護は変更しない。

## Playwright のブラウザ

キャッシュは `~/.cache/ms-playwright`。キーは OS、インストール済み Playwright の版、`package-lock.json`。別の版を復元しないので `restore-keys` は付けない。

ミスのときだけ `npx playwright install chromium`（時間制限 5 分）。`--with-deps` は使わない。`ubuntu-24.04` には chromium の共有ライブラリが入っていて、apt が 30 分で打ち切られるまで止まっていた。

失敗したときは `test-results`（trace、スクリーンショット、JSON）を artifact に残す。成功した実行は残さない。

ヒットでもミスでも、そのあと `node scripts/verify-playwright-browsers.mjs` を実行する。`playwright install chromium --dry-run` はブラウザが無くても成功するので、それだけでは足りない。dry-run が出した Install location ごとに、次を見て欠けるとジョブを落とす。

- `INSTALLATION_COMPLETE` がある
- linux の実行ファイルがある（chromium、chromium-headless-shell、ffmpeg）
- 実行ファイルが極端に小さくない
- sha256 をログに出す。Playwright 同梱の `browsers.json` には実行ファイルのダイジェストが無いので、期待値とは比べない
- chromium は `--version`、ffmpeg は `-version` が成功する

## フレークしたテストの隔離

リストは `.github/test-quarantine.txt`。最初は 0 件。失敗を隠すために足さない。直したら行を消す。

1 行にリポジトリルートからのパスを 1 つ書く。空行と `#` で始まる行は無視する。先頭の `./` は外れる。

```text
tests/example.test.ts
tests/e2e/guest.spec.ts
```

単体は `tests/*.test.ts` だけ。e2e は `playwright test --list` が `playwright.config.ts` から見つけたファイル。リストが空でも、1 件でも、必須レーンはその発見結果から隔離分だけを引いて同じコマンドで実行する。発見結果に無いパスは隔離ジョブが失敗する。必須レーンはそのパスを外さない。

次のファイルは隔離リストに書けない。必須の `blocking-unit` と `blocking-e2e` が、テストを始める前に拒否する。

- `tests/test-lanes.test.ts`
- `tests/bugfix-ssrf.test.ts`
- `tests/regression-auth.test.ts`
- `tests/capture-secrets.test.ts`

| コマンド | どこで使う |
| --- | --- |
| `node scripts/test-lanes.mjs blocking-unit` | 必須の単体テスト。リストにあるものだけ外す。保護したテストがあると失敗する。0 件になると失敗する |
| `node scripts/test-lanes.mjs blocking-e2e` | 必須の e2e。`playwright test --list` から隔離分を引く。全部外すと失敗する |
| `node scripts/test-lanes.mjs quarantine` | 隔離したテストだけ。0 件なら何も実行せず成功する。保護したテストがあると失敗する |
| `node scripts/test-lanes.mjs count` | 「単体の件数 e2e の件数」を出す。0 件なら依存を入れない |

隔離ジョブのチェック名は `quarantined tests`（`.github/workflows/quarantine.yml`）。毎回実行する。失敗するとそのチェックは赤になる。この名前は `test, types, build`、`npm audit`、`playwright`、`analyze`、`dependency review`、`gitleaks` ではない。0 件のときは `npm ci` しない。e2e が 1 件でもあるときだけ、必須レーンと同じブラウザキャッシュを使い、ヒットでも実体を検査してから実行する。

ローカルの `npm test` と `npm run test:e2e` はリストを見ない。手元では全部走る。


## develop との動作比較

`npm run test:diff` は `origin/develop` と候補コミットに同じ入力を渡し、一時 SQLite の状態と応答を比較する。外部 API と本番 DB は使わない。想定した差分だけを `scripts/diff-harness/approved-changes.json` で承認する。

`required` の認証保護は、差分がなくても必須。develop へ取り込み済みの場合は、両方のスナップショットでパスワード無効化・セッション世代・未確認 Google の拒否を直接確認し、「維持」と表示する。両方が同じ危険な動作へ戻った場合も失敗する。未対応の必須ルールは失敗させるため、必須ルールを足す際は比較処理の不変条件と回帰テストも追加する。
