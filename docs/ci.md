# CI

`feature/capture-existing-bugfixes`、`develop`、`main` 向けの pull request で走る。`ci.yml`、`playwright.yml`、`quarantine.yml` は `develop` への push でも走る。`main` への push の CI は `deploy-main.yml` が reusable で `ci.yml` を呼ぶ（単体の `ci.yml` push は二重起動を避けるため対象外）。path フィルタは付けない。必須のジョブが skip になると、その SHA のチェックが pending のままになる。通常ジョブの権限は `contents: read` だけ。mainのBlacksmith判定ジョブに限って `actions: read` を加える。失敗した Playwright の結果は `actions/upload-artifact` v4 が上げる。`actions: write` は付けない。アクションはコミット SHA でピンする。

マージを赤で止める必須ステータスチェックは、GitHub のブランチ保護と ruleset で設定する。このリポジトリのファイルだけでは有効にならない。

## 速いレーン

`.github/workflows/ci.yml`。キャッシュが温かいときの目標は 2 分未満。

| チェック名 | 中身 |
| --- | --- |
| `test, types, build` | 単体テスト、`tsc --noEmit`、本番ビルド、lint。警告は `.github/lint-warning-baseline.json` を超えると落とす |
| `npm audit` | `npm run audit:high`。high は落とす |

単体テストは `node scripts/test-lanes.mjs blocking-unit`。隔離リストが空なら `npm test` と同じファイルを実行する。`tsc` と `next build` は並べない。両方とも `.next/types` を触る。

### Blacksmith の予算判定と自動切り替え

関連 Issue は #287、導入調査は #232。`main` への push では `deploy-main.yml` 経由の reusable `ci.yml` で `Select CI runner` が先に利用量を確認し、`ci / test, types, build` の実行先を選ぶ。履歴の対象ワークフローは `deploy-main.yml`（#319）。PR（同一リポジトリ・fork とも）、他ブランチ、再実行は GitHub 標準ランナーを使う。既存の検査内容、20分の制限、`contents: read` は維持する。audit、Playwright、CodeQL 等は GitHub のまま。

判定ジョブ自身は `ubuntu-latest` で動く。スキップ、失敗、タイムアウト、認証欠落、取得不能、不正な応答、対象組織・対象期間の不一致、ストレージ請求データの欠落、予算不足の場合も、後続の検査を省略せず `ubuntu-latest` に戻す。開始済みのジョブを別のランナーへ移すものではない。

#### 80%の内部上限と実使用量

判定の単位はvCPU分で、公式CLI 0.5.3の `billing_minutes` をこの単位として扱う設計。Linux x64・4 vCPUで1分動くと4単位となる。利用量APIと無料枠が同じ単位・期間であることを確認してから使う。料金ページは月3,000分、管理画面FAQは3,000 vCPU分と案内している。**3,000 vCPU分が当該組織に適用されるなら、80%は2,400 vCPU分**（4 vCPUで600分相当）。6,000 vCPU分を設定できるのは、その枠が適用されると提供元に確認できた場合だけで、上限は4,800 vCPU分となる。「3,000分」を自動的に2 vCPU換算して枠を倍増させない。

固定10回の制限は設けない。終了したジョブは実時間で計上し、次の式で選ぶ。

```text
max(Blacksmith組織全体の当月利用量, GitHub履歴で積算した完了分)
  + 実行中・割当済み待機中の予約分
  + 今回の予約120 vCPU分
  <= 確認済み無料枠 × 80%
```

- 完了分は対象BlacksmithジョブのGitHub開始〜終了時間をジョブごとに分単位で切り上げ、4を掛ける。失敗・キャンセル・過去のattemptも計上する。提供元の集計が遅れても、この積算を下回らない。
- 実行中・割当済みの待機中は1件120 vCPU分を確保する。20分のジョブ上限と10分の余裕を含む。30分超の実行・時刻不明・未知のランナーは継続せずGitHubへ戻る。完了後は実時間に置き換え、最大120を使い切った扱いにはしない。
- GitHub標準ランナーで動いたジョブやPRにはBlacksmithの予約分を割り当てない。
- mainのCIは `deploy-main.yml`（およびそれが呼ぶ `ci.yml`）で concurrency group を使い、main では `cancel-in-progress: false` 相当（`github.ref != 'refs/heads/main'` のときだけ true）にする。判定後から検査ジョブの登録までの隙間を含め、同時に複数の選択が行われないようにする。PRのキャンセル設定は従来どおり。GitHub標準のpending枠では新しい実行が古い待機実行を置き換えることがある。
- 別のmain実行が進行中なら判定を拒否する。手動キャンセル等で過去のジョブが残っていれば、履歴の予約分にも含める。判定だけの直列化や、利用量APIだけでの残量判定には依存しない。
- 再実行は判定・実行先の両方で拒否し、GitHubを使う。月末24時間もGitHubを使う。月替わりに無料枠を自動再発行しない。

GitHub履歴は当月のCI実行を全ページ取得し、対象main pushのジョブを `filter=all` で全attempt取得する。`historyStartRunNumber` から現在までの実行番号の連続性を確認する。この番号は履歴欠落を検知する開始位置であり、利用可能な回数の上限ではない。番号の欠落、ページの重複・件数変動、履歴削除、APIの検索上限（1,000件）に達する応答、タイムアウトは部分的な履歴として使わずGitHubへ戻る。API上限に達した際は、確認なしで開始位置を前進させない。

#### 認証と設定

GitHub Environment `blacksmith-budget` の利用可能ブランチはbranchのmainだけとし、Environment Secret `BLACKSMITH_ORG_TOKEN` に組織トークンを保存する。PRやテスト・ビルドには渡さない。

組織トークンには閲覧以外にキャッシュ管理やTestbox起動等の権限もあるが、CIでは認証、`usage`、`usage storage` の読み取りだけを行う。組織全体をrepoフィルターなしで取得する。公式CLI 0.5.3は配布物のSHA-256を固定し、自動更新を無効化する。配布物や応答形式が変わればGitHubへ戻る。

判定ジョブに限って `actions: read` を追加し、自動発行の `github.token` でGitHubの実行履歴を読む。他のジョブの権限は変えず、書き込み権限や追加のPATは使わない。GitHubのトークンはGitHub公式API以外へ送信せず、リダイレクトも拒否する。Blacksmith CLIの子プロセスにはGitHubトークンを継承させず、組織トークンも認証時のstdinだけで渡す。生のCLI応答・エラー・トークンをログへ出さない。

| Repository variable | 内容 |
| --- | --- |
| `BLACKSMITH_NO_CHARGE_CONFIRMED` | 無課金条件を確認したUTC月。例: `2026-11` |
| `BLACKSMITH_BUDGET` | 例: `{"month":"2026-11","freeVcpuMinutes":6000,"historyStartRunNumber":38}`。無料枠は確認済みのvCPU分、履歴開始位置は有効化前に確認した次の **deploy-main.yml** 実行番号 |

旧形式・未設定・対象月不一致は無効。`freeVcpuMinutes` は確認済みの3,000または6,000のみ受け付ける。**同月に履歴の開始位置を前進させない。** 履歴を削除したりワークフローを再作成した場合は無効化して調査する。月途中の初回有効化は、その時点まで組織全体の当月利用量が0である場合に限る。

#### 有効化の前提と限界

次をすべて確認してから、現在の月に限って変数を設定する。未確認ならGitHubで継続する。

1. 当該組織の無料枠・単位・期間と、開始時点の当月利用量0を確認する。Blacksmith App、runner group等で対象repo・mainのCI以外の消費経路を制限する。この履歴モデルは他のワークフローの未集計使用量を保証しない。
2. **GitHubのジョブ開始〜終了を切り上げた値が、完了したジョブの課金時間を過小評価しない**ことを確認する。VM準備・終了後の課金等が別途あるなら、このモデルのまま有効化しない。実行中の停止遅延も予約の30分以内に収まる必要がある。
3. Docker layer cache、Sticky Disks、固定IP、Testboxes、[code]smith等の追加課金機能を使わず、ストレージ請求情報が取得可能で現在使用量・推定費用が0であることを確認する。
4. 公式APIの実応答、GitHub上のmain直列化、失敗・タイムアウト・再実行時の継続、月替わりを検証する。

2026-11-01確認の管理画面FAQでは、Blacksmith自体に実行を止める課金上限はない。80%はCI側の判定であり、サービス側の請求上限ではない。集計の即時性、未知の消費経路、想定外の停止遅延まで請求ゼロを保証しない。`billing_data_available: false` も0円の証明にしない。

#### GitHubへ戻る理由の確認

`Select CI runner` のStep Summaryと `reason` 出力に、失敗した段階を固定コードで表示する。外部サービスのエラー文、応答本文、トークンは表示しない。

| reason | 確認するもの |
| --- | --- |
| `disabled-or-ineligible` | 月・対象ブランチ・再実行・月末・予算設定。有効化条件を確認するまで設定しない |
| `authentication-unavailable` / `usage-unavailable` | 認証設定、固定CLI、利用量の取得・JSON読取。秘密をログへ出して調べない |
| `unrecognized-usage-report` | 利用量の対象組織・期間・数値形式 |
| `storage-unavailable` / `storage-unverified` | ストレージの取得、請求データの有無・対象期間・現在使用量 |
| `history-unavailable` / `history-unverified` | GitHubの履歴取得・完全性、実行番号・attempt・ジョブの状態やラベル・時刻 |
| `paid-storage-detected` / `budget-reserved` | 追加費用または予約分を含む80%超過。上限を引き上げずGitHubで継続する |

履歴の削除・未知の状態などが月内に残れば、次回以降もGitHubを使い続けることがある。該当する実行をActions画面で調べ、実応答に基づく修正とテストを行う。復帰させる目的で履歴を削除したり、`historyStartRunNumber` を前進させたり、未知の使用量を0にしない。完全な履歴を確認できなければ、その月はGitHubで継続する。

#### 緊急停止と起動待ちからの復旧

緊急停止は `BLACKSMITH_NO_CHARGE_CONFIRMED` を空にする。新規判定からGitHubへ戻るが、既に実行先が決まったジョブには遡及しない。

Blacksmith選択後にランナーが供給されないと、`test, types, build` が `Queued`（起動待ち）のままになり、mainの後続CIも待機する。ジョブの20分タイムアウトは開始後に効くため、この待機を解消しない。開始前の自動切り替えも行わない。Actions画面で対象ジョブのランナーラベルと状態を確認し、起動待ちが10分以上続く場合は復旧を開始する。この10分は運用上の目安であり、課金時間や予算の計算には使わない。

1. `BLACKSMITH_NO_CHARGE_CONFIRMED` を空にして、新たなBlacksmith選択を止める。
2. 起動待ちのmain実行を `Cancel workflow` でキャンセルし、ジョブと実行が `Cancelled` になったことを確認する。キャンセル要求だけでは完了とみなさない。
3. 該当実行の `Re-run all jobs` で再実行する。attempt 2以降は設定や古い判定結果にかかわらずGitHub標準ランナーになる。ジョブのラベルが `ubuntu-latest` で、既存の検査が開始・完了することを確認する。後続mainのCIも確認する。
4. Blacksmithの状態と履歴・請求情報を調査する。復旧のために予算の開始位置を変えず、無課金条件を再確認するまで無効を保つ。

公式資料: [料金・無料枠](https://www.blacksmith.sh/pricing)、[利用量CLI](https://docs.blacksmith.sh/blacksmith-cli/usage)、[CLI認証](https://docs.blacksmith.sh/blacksmith-cli/overview)、[GitHub実行履歴API](https://docs.github.com/en/rest/actions/workflow-runs)、[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)、[管理画面FAQ](https://app.blacksmith.sh/maishu-kobo/support)。

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

`codeql.yml` はfeature/photo-capture、feature/capture-existing-bugfixes、feature/auto-deploy、develop、main向けPRと、再利用workflowとしての呼び出しを対象にする。拡張クエリとhigh判定を実行する。main向けPRではこのファイルの `pull_request` 起動だけを使い、main への push では `deploy-main.yml` の `security` ジョブから同じ `codeql.yml` を呼ぶ。設定（クエリ・high判定・取り込み確認）は同一ファイルに置く。

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

自動配備の `main validation and deployment` から呼ぶCIは `github_hosted_only: false` とし、main push の唯一の CI 経路として Blacksmith 判定（`Select CI runner`）を行う。PR ではこの reusable 呼び出し自体を skip し、単体ワークフロー側の検査だけを残す（#319）。
