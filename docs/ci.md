# CI

`feature/photo-capture`、`feature/capture-existing-bugfixes`、`develop` 向けの pull request で走る。path フィルタは付けない。必須のジョブが skip になると、その SHA のチェックが pending のままになる。権限は `contents: read`。アクションはコミット SHA でピンする。

## 速いレーン

`.github/workflows/ci.yml`。キャッシュが温かいときの目標は 2 分未満。

| チェック名 | 中身 |
| --- | --- |
| `test, types, build` | 単体テスト、`tsc --noEmit`、本番ビルド、lint |
| `npm audit` | `npm run audit:high`。high は落とす |

単体テストは `node scripts/test-lanes.mjs blocking-unit`。隔離リストが空なら `npm test` と同じファイルを実行する。`tsc` と `next build` は並べない。両方とも `.next/types` を触る。

### Blacksmith の限定導入（無課金の条件を確認するまで無効）

`test, types, build` の実行先だけをブランチ単位で切り替えられる。
Repository Actions variables の `BLACKSMITH_NO_CHARGE_CONFIRMED` が文字列 `true` で、`BLACKSMITH_CI_BRANCH` にブランチ名を指定した場合だけ、同一リポジトリのそのブランチからの PR と、既存のトリガーに合うそのブランチへの push で `blacksmith-4vcpu-ubuntu-2404` を使う。
無課金の確認が済んでいない場合、ブランチ変数が未設定または空、対象外のブランチ、fork からの PR は `ubuntu-latest` を使う。
`BLACKSMITH_NO_CHARGE_CONFIRMED` は人間が確認結果を記録するスイッチであり、Blacksmith の予算上限を設定したり、利用量を監視して自動停止したりする機能ではない。
この変数は新しいトリガーを追加しない。

テスト内容、ジョブ名、権限、時間制限、Action の SHA、Node.js の版を維持する。
`npm audit`、Playwright、CodeQL、dependency review、gitleaks、隔離テスト、差分検証は GitHub ランナーのままとする。
Blacksmith の障害を検出して自動的に GitHub へ切り戻す仕組みではないため、有効化後に起動しない場合は下記の復旧手順を使う。

#### 適用範囲と費用

2026-10-25 に `feature/photo-capture` は [PR #175](https://github.com/maishu-kobo/butuyokuoh/pull/175) で `develop` に取り込まれた。
この設定も `develop` に置き、同ブランチ向けの試行用 PR で評価する。
リポジトリに Dockerfile、Compose、Docker イメージのビルドや push の定義はなく、デプロイ手順は exe.dev VM 上の Node.js と systemd である。
この導入では Docker layer cache、Sticky Disks、固定 IP を追加しない。
本番 VM の Node.js やデプロイ手順にも変更を加えない。

物欲王は公開リポジトリなので、現在の [GitHub 標準ランナーの実行料は無料](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。
導入の目的は CI の待ち時間を短くできるか確かめること。
公開リポジトリ向け Linux ランナーの [4 CPU / 16 GB](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) に合わせ、Blacksmith も [4 vCPU / 16 GB / Ubuntu 24.04 x64](https://docs.blacksmith.sh/blacksmith-runners/overview) を選ぶ。
2 vCPU への縮小や ARM への変更は、この試行に含めない。

2026-10-25 の [公式料金](https://www.blacksmith.sh/pricing) は x64 2 vCPU が $0.004/分、今回の 4 vCPU が $0.008/分。
[無料枠](https://docs.blacksmith.sh/blacksmith-runners/overview) は組織全体で月 3,000 分（x64 2 vCPU 換算）なので、4 vCPU だけを使う場合は実行時間 1,500 分に相当する。
同じ組織の他リポジトリも無料枠を消費する。
他の利用がなければ月額の概算は `max(0, 4vCPUの月間実行分数 - 1500) × $0.008`。
例えば月 1,000 分は $0、月 2,000 分は $4、月 5,000 分は $28（税、端数処理、追加サービスを除く）。
無料枠を使い切った後の20分のジョブは約 $0.16 で、並列実行や繰り返し実行の回数に応じて増える。
20分の時間制限は月額上限ではない。

Actions cache は [追加料金なし](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions) で、公式の `actions/setup-node` や `actions/cache` が自動的に Blacksmith の保存先を使う。
既存の SHA を維持し、廃止された `useblacksmith/setup-node` や `useblacksmith/cache` へ置き換えない。
Docker layer cache と Sticky Disks は $0.50/GB/月、固定 IP は $100/IP/月の別料金。
[Spending Alerts](https://docs.blacksmith.sh/introduction/settings) はメール通知であり、自動停止する予算上限として扱わない。

#### 無料枠を超えた場合

2026-10-25 の公開資料からは、無料枠到達時に必ず自動停止し、超過分を請求しないことを確認できていない。
[利用規約](https://docs.blacksmith.sh/about/terms-of-service) は利用料金の支払いを定めており、カード未登録を請求されない保証として扱わない。
Blacksmith の担当者は [2026-06 の説明](https://news.ycombinator.com/item?id=48476323) で、カード未登録でも無料枠の超過後に実行を継続する方針を述べ、その後 [無料枠を使い切った際の停止スイッチを追加中](https://news.ycombinator.com/item?id=48482211) と報告した。
これは過去の実装状況であり、現在の提供状況、既定値、実行中ジョブの超過分の扱いを保証するものではない。

課金を許容しない運用では、次の条件を確認できるまで App とランナーを有効化せず、両変数を未設定のままにする。

- 管理画面または提供元の回答で、無料枠終了時に実行を停止する設定と、超過分を請求しない条件を確認する。
- 組織全体にその設定を適用し、実行中・並列ジョブと計測の遅延でも課金が発生しないことを確認する。
- 自動チャージ、従量課金への自動移行、有料の追加サービスを無効にする。

Spending Alerts、20分のジョブ制限、CI 側で残量を定期取得する方法だけでは、請求額をゼロに固定できない。
無課金の条件が確認できない場合は、無料の GitHub 標準ランナーを継続する。

#### 認証とセキュリティ

[Quickstart](https://docs.blacksmith.sh/introduction/quickstart) のとおり、GitHub 組織への Blacksmith GitHub App 導入が必要。
個人所有のリポジトリは対象外で、ログインは GitHub を使う。
組織の管理者または App をインストールできる担当者が `maishu-kobo` に導入し、対象リポジトリを `butuyokuoh` に限定する。
SSO や IP allowlist がある組織では、その認証と通信許可も確認する。
このランナー導入のために PAT や Blacksmith API キーを CI Secrets に追加する必要はない。

[App の権限](https://docs.blacksmith.sh/blacksmith-administration/github-app) には Actions、Contents、Workflows、Pull requests、Checks の読み書き、Issues と Metadata の読み取り、組織ランナーの管理、Members の読み取りがある。
ランナー利用だけでもインストール時に表示される権限全体を確認する。
Secrets API で秘密の値を読む権限がないことと、実行時に秘密を扱わないことは別である。
チェックアウトしたコード、ジョブに渡したトークンや環境変数、ログ、キャッシュは外部の実行基盤で処理される。
今回のジョブは `contents: read` を維持し、本番 Secrets、OIDC、デプロイ資格情報を追加しない。

[公式セキュリティ説明](https://www.blacksmith.sh/security) は、ジョブごとの Firecracker microVM と終了後の破棄、キャッシュの分離と暗号化、SOC 2 Type II を掲げている。
同ページの更新日は 2025-08-08 で、監査報告書自体は今回確認していない。
ログとキャッシュは VM の破棄後も残り得るため、保存期間と削除方法は別途確認する。
キャッシュの Branch Protected Caches は有効のまま使い、組織の閲覧権限は [権限表](https://docs.blacksmith.sh/blacksmith-administration/permissions) で確認する。
実行地域は米国または欧州で、日本リージョンの記載はない。
AI 機能や Testboxes はこの試行の対象外とし、必要になった場合に [処理委託先](https://docs.blacksmith.sh/about/sub-processors) と送信対象を確認する。

fork 判定はこのワークフローの実行先を制限するもので、組織ランナー全体のアクセス制御ではない。
App 導入時には runner group の公開リポジトリ利用、対象リポジトリ、利用可能なワークフローの設定も確認し、他のワークフローからの無制限な利用を許可しない。
`pull_request_target` や `self-hosted` ラベルの追加、PR の承認設定の緩和は行わない。

#### 有効化と比較

1. ワークフロー変更について人間の承認と `REVIEW.md` のレビューを得る。上記の無課金の条件を確認し、設定・適用範囲・確認日を Issue #232 に記録する。
2. 組織に App を導入し、対象リポジトリ、公開リポジトリの runner group、無課金の設定を確認する。
3. Repository の Settings → Secrets and variables → Actions → Variables で `BLACKSMITH_CI_BRANCH` に試行する PR の head ブランチ名を指定し、`BLACKSMITH_NO_CHARGE_CONFIRMED` を `true` にする。どちらも Secret ではない。組織変数から同名の値を継承していないことも確認する。
4. 該当 PR の CI を再実行し、job の labels と runner 名が Blacksmith になったことを確認する。GitHub のままなら、PR 更新などで新しい run を起動して再確認する。
5. 同一 SHA について GitHub と Blacksmith の成功結果、待ち時間と実行時間、キャッシュの初回と再利用時を比較する。`npm ci`、Puppeteer、Chrome の `sysctl`、単体テスト、型検査、本番ビルド、lint が通ることを確認する。公式の速度倍率は実測値として扱わない。
6. 対象を広げる場合も無課金の条件を維持する。`BLACKSMITH_CI_BRANCH` は PR の head を選ぶため、`develop` を指定しても develop 向けのすべての PR は切り替わらない。既存の push トリガーは `feature/photo-capture` だけで、develop への push は新設していない。

#### 復旧

対象の待機中または実行中の run を取り消し、Repository variable `BLACKSMITH_NO_CHARGE_CONFIRMED` を `false` にし、`BLACKSMITH_CI_BRANCH` を空にする。
変数を削除する場合は、同名の組織変数が再び適用されないことを確認する。
新しい CI run で `ubuntu-latest` と成功結果を確認する。
値を変えても、既に実行中のジョブは移動しない。
App 未導入、課金停止、障害でランナーが起動しない場合も、この手順を使う。
`timeout-minutes: 20` は実行開始後の制限なので、待機中のジョブを20分で回復させる保証にはならない。
恒久的に撤回する場合は、`check.runs-on` を `ubuntu-latest` に戻す。

## 重いレーン

毎回走り、失敗すると止める。速いレーンの完了を待たない。

| チェック名 | ファイル | 中身 |
| --- | --- | --- |
| `playwright` | `.github/workflows/playwright.yml` | e2e。ジョブの時間制限は 30 分 |
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
