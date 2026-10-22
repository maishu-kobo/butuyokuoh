# CI

`feature/photo-capture`、`feature/capture-existing-bugfixes`、`develop` 向けの pull request で走る。path フィルタは付けない。必須のジョブが skip になると、その SHA のチェックが pending のままになる。権限は `contents: read`。アクションはコミット SHA でピンする。

## 速いレーン

`.github/workflows/ci.yml`。キャッシュが温かいときの目標は 2 分未満。

| チェック名 | 中身 |
| --- | --- |
| `test, types, build` | 単体テスト、`tsc --noEmit`、本番ビルド、lint |
| `npm audit` | `npm run audit:high`。high は落とす |

単体テストは `node scripts/test-lanes.mjs blocking-unit`。隔離リストが空なら `npm test` と同じファイルを実行する。`tsc` と `next build` は並べない。両方とも `.next/types` を触る。

## 重いレーン

毎回走り、失敗すると止める。速いレーンの完了を待たない。

| チェック名 | ファイル | 中身 |
| --- | --- | --- |
| `playwright` | `.github/workflows/playwright.yml` | e2e。ジョブの時間制限は 30 分 |
| `analyze` | `.github/workflows/codeql.yml` | CodeQL。high は `.github/codeql/high_gate.py` が落とす |

ほかの必須ゲートもそのまま止める。

| チェック名 | 失敗条件 |
| --- | --- |
| `dependency review` | high |
| `gitleaks` | 秘密の検出 |

## Playwright のブラウザ

キャッシュは `~/.cache/ms-playwright`。キーは OS、インストール済み Playwright の版、`package-lock.json`。別の版を復元しないので `restore-keys` は付けない。

ミスのときだけ `npx playwright install chromium`（時間制限 5 分）。`--with-deps` は使わない。`ubuntu-24.04` には chromium の共有ライブラリが入っていて、apt が 30 分で打ち切られるまで止まっていた。

ヒットでもミスでも、そのあと `node scripts/verify-playwright-browsers.mjs` を実行する。`playwright install chromium --dry-run` はブラウザが無くても成功するので、それだけでは足りない。dry-run が出した Install location ごとに、次を見て欠けるとジョブを落とす。

- `INSTALLATION_COMPLETE` がある
- linux の実行ファイルがある（chromium、chromium-headless-shell、ffmpeg）
- 実行ファイルが極端に小さくない
- sha256 をログに出す
- chromium は `--version`、ffmpeg は `-version` が成功する

## フレークしたテストの隔離

リストは `.github/test-quarantine.txt`。最初は 0 件。失敗を隠すために足さない。直したら行を消す。

1 行にリポジトリルートからのパスを 1 つ書く。空行と `#` で始まる行は無視する。先頭の `./` は外れる。

```text
tests/example.test.ts
tests/e2e/guest.spec.ts
```

単体は `tests/*.test.ts` だけ。e2e は `playwright.config.ts` が選ぶファイル（`disabled.spec.ts` を含む）。それ以外のパスは隔離ジョブが失敗する。必須レーンはそのパスを外さない。

| コマンド | どこで使う |
| --- | --- |
| `node scripts/test-lanes.mjs blocking-unit` | 必須の単体テスト。リストにあるものだけ外す。0 件になると失敗する |
| `node scripts/test-lanes.mjs blocking-e2e` | 必須の e2e。リストが空なら `npx playwright test`。全部外すと失敗する |
| `node scripts/test-lanes.mjs quarantine` | 隔離したテストだけ。0 件なら何も実行せず成功する |
| `node scripts/test-lanes.mjs count` | 「単体の件数 e2e の件数」を出す。0 件なら依存を入れない |

隔離ジョブのチェック名は `quarantined tests`（`.github/workflows/quarantine.yml`）。毎回報告する。`continue-on-error` なので失敗してもマージは止めない。0 件のときは `npm ci` しない。e2e が 1 件でもあるときだけ、必須レーンと同じブラウザキャッシュを使い、ヒットでも実体を検査してから実行する。

ローカルの `npm test` と `npm run test:e2e` はリストを見ない。手元では全部走る。
