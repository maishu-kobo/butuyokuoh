# CI

`feature/photo-capture`、`feature/capture-existing-bugfixes`、`feature/auto-deploy`、`feature/agent-improvements`、`develop`、`main` 向けの pull request で走る。`ci.yml`、`playwright.yml`、`quarantine.yml` は `develop` への push でも走る。`main` への push の CI は `deploy-main.yml` が reusable で `ci.yml` を呼ぶ（単体の `ci.yml` push は二重起動を避けるため対象外）。path フィルタは付けない。必須のジョブが skip になると、その SHA のチェックが pending のままになる。通常ジョブの権限は `contents: read` だけ。実行先は GitHub-hosted の `ubuntu-24.04`（公開リポジトリでは無料の標準 Linux。4 vCPU / 16 GB）。失敗した Playwright の結果は `actions/upload-artifact` v4 が上げる。`actions: write` は付けない。アクションはコミット SHA でピンする。

マージを赤で止める必須ステータスチェックは、GitHub のブランチ保護と ruleset で設定する。このリポジトリのファイルだけでは有効にならない。

## 速いレーン

`.github/workflows/ci.yml`。キャッシュが温かいときの目標は 2 分未満。

| チェック名 | 中身 |
| --- | --- |
| `test, types, build` | 単体テスト、`tsc --noEmit`、本番ビルド、lint。警告は `.github/lint-warning-baseline.json` を超えると落とす |
| `npm audit` | `npm run audit:high`。high は落とす |

単体テストは `node scripts/test-lanes.mjs blocking-unit`。隔離リストが空なら `npm test` と同じファイルを実行する。`tsc` と `next build` は並べない。両方とも `.next/types` を触る。

### ローカルでの実行条件

`npm test` には一時 SQLite、localhost の HTTP サーバ、Chromium、Next.js の開発サーバを使うテストを含む。localhost の待受けやブラウザ起動を禁止した実行環境では全体成功を検証できない。テストを skip / 隔離せず、これらが使用できるローカル環境または上記 CI で全体を実行する。結果には実行場所、コミット、コマンド、成功 / 失敗件数を記録し、制限による失敗を成功扱いにしない。

Agent API の fixture テストは商品応答に加えて DNS もテスト内で固定する。実店舗や実 DNS の状態に依存させず、private IP・混在した DNS 応答の拒否も検証する。本番の URL 検査や SSRF 防御は変更しない。

### ランナー（GitHub-hosted）

すべての実行可能な workflow ジョブは `ubuntu-24.04` を使う。`Select CI runner`、`github_hosted_only`、Blacksmith Environment / CLI / API 呼び出しは通常 CI から外した（緊急移行。関連 #287 / #232。経緯は `docs/WORKLOG.md`）。検査内容・ジョブ名（`test, types, build`、`npm audit`、`playwright`、`analyze`、`dependency review`、`gitleaks`、`quarantined tests`）・権限・main 配備のゲート条件は変えない。`scripts/blacksmith-*.mjs` と対応テストは履歴用に残すが、workflow からは呼ばない。

公開リポジトリの GitHub-hosted Linux は無料枠の標準ランナーであり、private リポジトリ向けの 2-core 制限とは別である。

## 重いレーン

毎回走り、失敗すると止める。速いレーンの完了を待たない。

| チェック名 | ファイル | 中身 |
| --- | --- | --- |
| `playwright` | `.github/workflows/playwright.yml` | 開発サーバの e2e（2 shard 集約）。固定の商品ページ。各 shard の時間制限は 30 分 |
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

`codeql.yml` はfeature/photo-capture、feature/capture-existing-bugfixes、feature/auto-deploy、feature/agent-improvements、develop、main向けPRと、再利用workflowとしての呼び出しを対象にする。拡張クエリとhigh判定を実行する。main向けPRではこのファイルの `pull_request` 起動だけを使い、main への push では `deploy-main.yml` の `security` ジョブから同じ `codeql.yml` を呼ぶ。設定（クエリ・high判定・取り込み確認）は同一ファイルに置く。

`codeql-main.yml` は週次と手動だけ、JS/TSの既定クエリを実行する。Default setupの代替として残し、PR・main pushでは起動しない（#319）。Default setupは無効のまま。ブランチ保護はリポジトリ設定側の作業。

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

自動配備の `main validation and deployment` から呼ぶ CI も同じ GitHub-hosted `ubuntu-24.04` を使う。PR ではこの reusable 呼び出し自体を skip し、単体ワークフロー側の検査だけを残す（#319）。
