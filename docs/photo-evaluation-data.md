# 写真評価データと再実行手順

Issue #100 の写真評価を、同一商品・ブランド・種類・使用量に分けて再集計する。基準は main `78161507701a4fc2f49919b8cb91cc3670a215c2`。写真判定のJSONオブジェクト回答修正 #254 を含む。既定モデルや本番の動作、費用上限は変更しない。

## 評価条件

| 条件 | 入力 | 集計の扱い |
| --- | --- | --- |
| photo-only | メタデータを除去した画素と固定指示だけ | 写真のみの評価 |
| manual-hint | 人が品番などを確認して補った別の試行 | photo-only と分離 |
| legacy-unspecified | 入力条件の機械可読記録がない過去結果 | 写真のみの比較へ自動で含めない |

同じreportに異なる条件を混ぜるとエラーにする。live-harnessは `condition:photo-only`、`inputProtocol:prepared-pixels-only-v1`、予定画像IDを出力する。元ファイル名、出典、正解ブランド・品番はモデルへ送らない。既存の `prepareCapturePhoto` は再エンコードでメタデータを落とす。回帰テストでは、同じ画像の評価IDを品番入りファイル名と匿名IDに変えてもHTTP本文が一致することを確認する。

手動品番条件は実アプリの明示的な補助検索として別に記録する。この変更は、live-harnessへ自動的に品番を足す機能を追加しない。

## 正解データと分母

[カタログ](../tests/eval/photo-search/catalog.json) は23画像と元バッグの記録を持つ。既存23枚をすべて目視確認し、旧ラベル、現在の見え方、Git blob SHA、出典を分けて記録した。読めるブランド表記を独立に確認できた8枚だけ、ブランドの真値を採点する。写真に書かれていない商品名・SKU・商品URLは推測で補っていない。

- 同一商品Top5: 根拠付きの正解品番が検索上位5件の商品名に境界一致するかを既存 `exactProductTop5` で診断する。これは品番照合による代理指標で、同品番を含むアクセサリや品番未掲載の結果は目視照合が必要。
- 商品名・ブランド: 独立根拠付きのaliasとの完全一致。NFKC、大小文字、連続空白だけを正規化する。正解aliasはモデル結果を見る前に決める。
- 種類診断: 既存 `rubric.scorePhoto` のcategoryを再利用し、同一商品精度へ合算しない。これは推定名そのものではなく検索上位3件の種類と混入を診断する指標。
- 真値不明はnull。API失敗や予定済みで欠けた正解付きケースは分母から取り除かない。coverageに未実行画像を残す。
- HTTP失敗回数、失敗画像数、一部店舗だけ失敗した画像数を分ける。応答時間は記録件数・中央値・最大を示す。combinedは識別と検索の両方が記録された画像だけの和で、画面操作を含む実時間ではない。
- usage.neuronsの実測、prompt/completion tokens、台帳の保守的計上値を分ける。usage欠落を無料と見なさない。重複画像でも実際の通信コストは総量に残す。

23枚に正解SKUが揃っていないため、同一商品の検索成功率と正解商品名一致率は未評価。ブランドが読めたことを同一商品の特定に数えない。

### 元バッグと重複画像

[元バッグの評価記録](capture-evaluation-247.md)には、BALENCIAGA Rodeo medium、品番 `7897722AA4V1000`、製品URL、元画像SHA256がある。画像は再配布せず、既存記録を正解根拠として保持する。[10月29日の確認](https://github.com/maishu-kobo/butuyokuoh/issues/100#issuecomment-6497068914)では写真だけは一般名の推定に留まり、人が品番を選んだ検索で同一商品へ到達した。この二つを混同しない。

旧 `gucci-brand-only` と `lv-handbag` は同一のPrada写真だったと [sources.json](../tests/eval/photo-search/sources.json) に記録されている。旧24行報告では前者を精度分母から外し、通信量は残す。現存23ファイルのGit blob SHAはすべて異なる。画像の再エンコードによる見かけ上異なる重複を検出した証拠ではない。

Pradaの歴史資料、壊れたPC、古い香水、靴の部位説明、ペン先、人物のジーンズなどは、現在のEC検索との相性が悪いか対象が曖昧。MACの写真は口紅以外の化粧品も写り、HEMAのTシャツは無地ではなく国旗柄、マグ画像は複数商品が写る。カタログの `visualObservation` に実際の見え方を残している。

## 保存済み応答の再集計

新規API呼出は0回。[再集計JSON](../tests/eval/photo-search/reports/offline-audit-20261029.json) を保存した。入力条件・モデル・検索処理が統一された新たな比較実験ではなく、過去記録を同じ集計処理へ通した結果である。

| 保存結果 | 有効画像 | ブランド一致 | 検索種類診断 | 識別 中央値/最大 ms | 検索 中央値/最大 ms | reported neurons | 呼出 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| live-main.json | 23（元24行） | 5/8 | 16/23 | 1718 / 2413 | 403 / 1935 | 570.833 | 24 |
| live-pr.json | 23（元24行） | 5/8 | 13/23 | 1848 / 2920 | 553 / 1239 | 600.825 | 24 |
| live-pr03.json | 23 | 5/8 | 17/23 | 1839 / 2450 | 943 / 1871 | 568.845 | 23 |

検索時間の記録件数は23、23、22。検索HTTP失敗は1、1、0。全呼出でprompt/completion tokensとneuronsが記録されている。先頭2つの利用量は重複写真への通信も含む。同一商品Top5率・正解商品名一致率はいずれもnullであり、0%でも成功でもない。

## オフライン再実行

既存 `scripts/eval-photo-search.ts` に `--summarize` を追加した。既定の保存モデル応答replayは維持する。

```bash
npm ci
node --import tsx --test tests/photo-evaluation-report.test.ts
node --import tsx scripts/eval-photo-search.ts --summarize tests/eval/photo-search/fixtures/live-main.json --out /tmp/photo-main-summary.json
node --import tsx scripts/eval-photo-search.ts --summarize tests/eval/photo-search/fixtures/live-pr.json --out /tmp/photo-pr-summary.json
node --import tsx scripts/eval-photo-search.ts --summarize tests/eval/photo-search/fixtures/live-pr03.json --out /tmp/photo-pr03-summary.json
npm test
npx tsc --noEmit
npm run lint
npm run build
```

`--summarize` はファイルを読むだけで、外部API・本番DB・秘密値にはアクセスしない。出典・作者・ライセンス版は既存sources.jsonを保持する。再配布する場合は元ページの利用条件を確認し、必要なクレジットも同梱する。ライセンス外部ページの最新条件は今回再確認していない。

## 実API比較に残る準備

1. 正解SKU・製品URL・画像利用条件が確認された20枚以上のケースを作る。現状23枚の種類診断で代用しない。
2. 写真の入手元、独立した正解根拠、撮影/選択条件、真値の確認日を固定する。
3. 実行を許可された検証キー、利用上限、当日の使用量、専用永続台帳を用意し、同じキーの並行実行を避ける。本番DBは使わない。
4. 条件・対象モデル・検索方法・画像集合を揃えて少数から実行する。今夜はCloudflareを含む外部AI/商品検索APIを一切呼ばない。
5. 正解が上位5件にある割合と費用を比較してからモデルを選ぶ。既定モデルは変更しない。

未マージPR #255もlive-harness.tsを変更している。本変更は出力条件と予定IDの追加のみで、#255を取り込む際はこの差分を保つ。ファイル全体で上書きしない。

## 今回の検証記録（2026-10-29）

- テスト先行コミット（ローカル）`0fa1998` は `Cannot find module './eval/photo-search/metrics.mjs'` で失敗。実装後の新規8テストはすべて成功。
- `npm test`: 549件中540成功、9失敗。main基準は541件中531成功、10失敗。失敗名を照合し新規失敗は0。残る9件はローカルサーバのlisten EPERMやブラウザのsandbox制約によるもので、全体成功とは扱わない。
- `npx tsc --noEmit`: 成功。`npm run lint`: エラー0、既存警告23。
- `npm run build`: Turbopackが共有依存symlinkのroot外にあるNextを解決できず失敗。`npm run build -- --webpack`: 成功。
- `npm ci` はDNSのENOTFOUNDで失敗。lockfileのバージョンと一致し必須欠落0を確認した既存依存を再利用した。
- 既存保存応答3組を実行して集計JSONを保存。通常の写真登録UIは変更していない。ブラウザによる実サービス操作、実AI/EC APIは実行していない。

CI・独立レビューの最新結果はPRに追記する。未検証の実API比較を理由にDraftのまま共有する。
