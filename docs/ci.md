# CI

`feature/capture-existing-bugfixes`、`develop`、`main` 向けの pull request で走る。`ci.yml`、`playwright.yml`、`quarantine.yml` は `develop` への push でも走る。`ci.yml` は `main` への push も対象にする。path フィルタは付けない。必須のジョブが skip になると、その SHA のチェックが pending のままになる。権限は `contents: read` だけ。失敗した Playwright の結果は `actions/upload-artifact` v4 が上げる。`actions: write` は付けない。アクションはコミット SHA でピンする。

マージを赤で止める必須ステータスチェックは、GitHub のブランチ保護と ruleset で設定する。このリポジトリのファイルだけでは有効にならない。

## 速いレーン

`.github/workflows/ci.yml`。キャッシュが温かいときの目標は 2 分未満。

| チェック名 | 中身 |
| --- | --- |
| `test, types, build` | 単体テスト、`tsc --noEmit`、本番ビルド、lint。警告は `.github/lint-warning-baseline.json` を超えると落とす |
| `npm audit` | `npm run audit:high`。high は落とす |

単体テストは `node scripts/test-lanes.mjs blocking-unit`。隔離リストが空なら `npm test` と同じファイルを実行する。`tsc` と `next build` は並べない。両方とも `.next/types` を触る。

### Blacksmith の予算判定と自動切り替え

関連 Issue は #287、導入調査は #232。`main` への push で `Select CI runner` が先に利用量を確認し、`test, types, build` の実行先を選ぶ。PR（同一リポジトリ・fork とも）、他ブランチ、再実行は GitHub 標準ランナーを使う。main push を CI の対象に追加するが、既存の検査とジョブ名、20分の制限、`contents: read` は維持する。audit、Playwright、CodeQL 等は GitHub のまま。

判定ジョブ自身は `ubuntu-latest` で動く。スキップ、失敗、タイムアウト、認証欠落、取得不能、不正な応答、対象組織・対象期間の不一致、ストレージ請求データの欠落、予算不足の場合も、後続の検査を省略せず `ubuntu-latest` に戻す。開始済みのジョブを別のランナーへ移すものではない。

#### 内部上限

単位は公式CLI 0.5.3の `billing_minutes`（プラットフォームの料金倍率を含むvCPU分）。Linux x64・4 vCPUの1実行分は4単位となる。公開料金ページの「2 vCPU換算分」とは異なる。

- 内部上限は **月1,200 vCPU分**。4 vCPU換算で300分、公開説明の無料枠6,000 vCPU分の20%。管理画面FAQの厳しい解釈である3,000 vCPU分に対しても40%に留める。
- 1回に **120 vCPU分**を予約する。20分のジョブ上限に、停止・端数処理の余裕として10分を加え、4を掛ける。この余裕は提供元の停止時間保証ではない。
- 月内に認めるのは **最大10個のCI実行番号**。`firstRunNumber` 以上、`firstRunNumber + 10` 未満だけを対象にする。PRやGitHub実行、キャンセルも番号を消費し、枠を返却しない。
- `max(取得した月間利用量, 先行する実行番号の数 × 120) + 120 <= 1200` の場合だけBlacksmithを選ぶ。実行中・未集計分は先行番号の予約量で保守的に扱う。
- 判定と実行先の式の両方で `run_attempt == 1` を確認する。失敗したジョブだけの再実行で古い判定結果が再利用されてもGitHubへ戻す。
- 月末24時間と確認月が変わった後はGitHubを使う。月替わりで自動的に予算を再発行しない。

利用量が遅れても、実行番号で枠を分けるため、並列ジョブが同じ残量を見て予約を重ねることはない。GitHubのキャッシュやartifactを可変の残高台帳として使わず、GitHubへの書き込み権限も追加しない。初期導入は速度改善の試行なので枠を小さく取り、無料枠を使い切る最適化は行わない。

#### 認証と設定

GitHub Environment `blacksmith-budget` の利用可能ブランチを **branchのmainだけ**にし、そのEnvironment Secretに `BLACKSMITH_ORG_TOKEN` を登録する。リポジトリ共通のSecretには置かない。Environmentの制限をGitHub側で確認してからトークンを保存する。PRのコードやテスト、本番ビルドのジョブへトークンを渡さない。

公式の組織トークンは閲覧専用ではなく、キャッシュ管理やTestboxの起動等の権限も持つ。CIでは認証、`usage`、`usage storage` の読み取りだけを使う。トークンはstdinからCLIへ渡し、CLIのstdout/stderrや生の応答をログへ出さない。利用量はrepoフィルターなしの組織全体を取得する。

CLIバイナリは公式配布のLinux amd64版をSHA-256で固定し、自動更新を無効にする。配布物が変わる、ダウンロードに失敗する、CLIの応答形式が変わる場合もGitHubへ戻る。更新時はバージョン・ハッシュ・実応答を確認してPRで変更する。

Repository variablesは次の2つ。Secretだけ登録しても有効にはならない。

| 変数 | 内容 |
| --- | --- |
| `BLACKSMITH_NO_CHARGE_CONFIRMED` | 無課金条件を確認したUTC月。例: `2026-11`。`true` は受け付けない |
| `BLACKSMITH_BUDGET` | `{"month":"2026-11","firstRunNumber":123}` の形式。開始前に最新CI実行番号を確認し、次の番号を指定する |

**同じ月の `firstRunNumber` を変更して枠を増やさない。** 期限切れの予算や失敗・キャンセル分を再利用しない。CIワークフローの削除・再作成で実行番号をリセットした場合も有効化を解除する。

#### 有効化の前提と限界

次をすべて確認してから、現在の月に限って変数を設定する。未確認なら設定せず、GitHubで継続する。

1. 開始時点の組織全体の当月利用量が0で、CI以外に無料枠を消費する経路がない。Blacksmith Appとrunner groupの実行範囲を物欲王に限定し、このゲートを通らないランナー利用を認めない。
2. 無料枠の算定・期間・端数処理、ジョブ停止と実際の課金終了の関係、最大停止遅延を確認し、上記の予約量内に収まる。
3. Docker layer cache、Sticky Disks、固定IP、Testboxes、[code]smith等の追加課金経路を使わない。ストレージの請求情報が取得可能で、現在使用量と推定費用がともに0である。
4. 公式CLIの実応答と管理画面の利用量が一致し、認証・権限・取得失敗・タイムアウト・月替わり・並列・再実行の検証が通る。

2026-11-01の管理画面FAQでは、Blacksmith自体には実行を止める課金上限がない。CI側の予約は追加の防御であり、サービス側の請求上限にはならない。取得した期間が正しくても、集計の即時性が保証されたわけではない。未承認の別ワークフローや別リポジトリでの利用、設定の手動変更、想定を超える停止遅延まで請求ゼロを保証しない。ストレージAPIの `billing_data_available: false` も0円の証明として扱わない。

緊急停止は `BLACKSMITH_NO_CHARGE_CONFIRMED` を空にする。新規判定からGitHubへ戻るが、既に実行先が決まったジョブには遡及しない。必要ならGitHubで該当実行をキャンセルする。キャンセルの反映にも時間がかかるため、上限間際まで実行しない。

公式資料: [無料枠](https://docs.blacksmith.sh/blacksmith-runners/overview#faq)、[利用量CLI](https://docs.blacksmith.sh/blacksmith-cli/usage)、[CLI認証](https://docs.blacksmith.sh/blacksmith-cli/overview)、[管理画面FAQ](https://app.blacksmith.sh/maishu-kobo/support)。

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

このワークフローの対象は冒頭の3ブランチ向けPR。mainの既存解析は、[PR #206](https://github.com/maishu-kobo/butuyokuoh/pull/206) の `codeql-main.yml` へ引き継ぐ。main向けPR・push・週次・手動の解析を持ち、JS/TSと既定クエリを維持する。Default setupの解除とmain用ワークフローの適用を両方完了させること。PRを作っただけではmainの継続解析は復旧しない。ブランチ保護は変更しない。

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
