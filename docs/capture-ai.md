# 写真の見た目から商品を推定する

バーコードは読まない。写真を Cloudflare Workers AI に送り、商品名、ブランド、型番の候補にする。LLMが返すJANは写真にある値か検証できないので、チェックサムが合っていても検索には使わない。キーが無いとき、判定できないとき、回数やニューロンの上限に達したときは、商品名の手入力に戻る。

通常のリクエストでキーが無い、または形式が違うときは `AI_UNAVAILABLE` で手入力に戻る。テスト用の商品名を返すのは、`CAPTURE_TEST_HOOKS` が `1` で、かつ `NODE_ENV` が `production` でないときだけ。その中でも、キーが無いときと、シナリオを指定したテストだけがテスト用の商品を使う。本番では `CAPTURE_TEST_HOOKS` が付いていてもテスト用の商品は返さない。

`CAPTURE_ENABLED` と `CAPTURE_AI_ENABLED` が両方 `true` のときだけ呼ぶ。初期値はオフ。判定が使うキーは `src/lib/capture-secrets.ts` が読む `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` だけ。画面の使い方と店の検索のキーは [写真から登録](./capture.md)。

## 比べるモデル

既定は `@cf/meta/llama-3.2-11b-vision-instruct` のまま。変えるときはサーバの `CAPTURE_AI_MODEL` に、下の id か variant 名を置く。評価ハーネスは `--variant` で同じ23枚を比べる。選ぶまで本番の既定は変えない。

料金は [Workers AI の料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)（2026-10-20）。無料枠は1日 10,000 ニューロン。画像入力が付くものは各モデルページの Vision。llama 3.2 はリクエストの `image` に data URL を置く。llama 4、Mistral Small 3.1、Gemma、Moondream はチャットの `image_url` に data URL を置く（[OpenAI 互換](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)）。

23枚の llama 3.2 実測は 569 ニューロン（`03ee256`）。他モデルは入力ニューロン単価の比で見積もった。検索の段数を増やしても、この見積もりは増えない。

| variant | モデル | 入力ニューロン / 100万 | 23枚の見積もり |
| --- | --- | ---: | ---: |
| llama32 | `@cf/meta/llama-3.2-11b-vision-instruct` | 4410 | 570 |
| llama4 | `@cf/meta/llama-4-scout-17b-16e-instruct` | 24545 | 3200 |
| gemma4 | `@cf/google/gemma-4-26b-a4b-it` | 9091 | 1180 |
| gemma3 | `@cf/google/gemma-3-12b-it` | 31371 | 4070 |
| mistral31 | `@cf/mistralai/mistral-small-3.1-24b-instruct` | 31876 | 4140 |
| moondream | `@cf/moondream/moondream3.1-9B-A2B` | 27273 | 3560 |

`-ladder` は同じモデルで、Yahoo か楽天のどちらかが 0 件または失敗なら種類の検索語を足す。ニューロンは増えない。`ensemble` は llama 4 の種類・色・ブランドに、ブランドが一致したときだけ llama 3.2 のシリーズを足す。23枚で約 1,470 ニューロン（ライブの 904 と 569 の合計）。

Gemma 4 は推論モデルで、思考を切らないと `max_tokens` 400 を思考に使い `result.response` が null になる。リクエストは `chat_template_kwargs.enable_thinking: false` と `reasoning_effort: "none"`、上限は `max_completion_tokens`（[モデルページ](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)、[Gemma の思考](https://ai.google.dev/gemma/docs/capabilities/thinking)）。本文は `choices[].message.content` も読む。

### Gemini（無料枠）

Workers AI のほかに、選んだときだけ Google Gemini API で同じ写真を推定できる。既定のモデルは変えない。`CAPTURE_AI_MODEL` が未設定、または Workers の variant のときは、今までどおり llama 3.2 で、`GEMINI_API_KEY` は要らない。

| 設定 | モデル |
| --- | --- |
| `CAPTURE_AI_MODEL=gemini` または `gemini-ladder` | `gemini-3.5-flash` |
| `CAPTURE_AI_MODEL=gemini-lite` または `gemini-lite-ladder` | `gemini-3.5-flash-lite` |
| `CAPTURE_AI_MODEL=llama4-gemini-fallback` | 先に llama 4。失敗・読めない・商品名が無いとき、または検索段が 0 件のときだけ `gemini-3.5-flash-lite`。自信が低いだけでは呼ばない |
| `GEMINI_MODEL` | 上の2つのどちらか。置いたときだけ、直接の Gemini variant のモデルを上書きする |

`gemini-2.5-flash` と `gemini-2.5-flash-lite` は新規利用者に 404 となるため使わない。`gemini-ladder` と `gemini-lite-ladder` の段は評価ハーネスだけが使う。通常画面でその名前を置いても、推定に使うモデルは同じで、検索の段は増えない。

`llama4-brand-guard` は、ブランドの種類と商品の種類が違う sure だけを種類と色へ落とす。文字が無いだけではブランドは残す。文字を読んでいない数字の型番だけ外す。`llama4-gemini-grounded` は今のフォールバックにその確認を足す。候補の並べ替えはコードに残し、`CAPTURE_AI_RERANK=1` のときだけ動く。失敗したら元の順。どちらも未設定なら動かない。`llama4-gemini-fallback` の動きは変えない。

`llama4-evidence` と `gemini-lite-evidence` は、ブランドを書くのは写真に見える根拠があるときだけにする。読める印刷の文字（瓶、文字盤、ラベル、メダル）はロゴでなくても根拠になり、そのブランドを書く。金具・形・足床のような見た目も根拠になる。種類とシリーズは残し、ブランド名だけにしない。靴は靴のまま。`llama4-evidence` は、ブランドの種類と商品の種類が違う sure だけを `llama4-gemini-grounded` と同じ確認で落とす。文字が無いだけでは落とさない。印刷されていない数字の型番は、sure でも外す。そのあとの検索語にはシリーズと種類を残し、ブランド名だけにはしない。根拠つきの推定は `series`（Pixel、Galaxy Z、iPhone）と `formFactor`（`foldable` または `bar`）を返す。折りたたみなら `{ブランド} {series} Fold` で探す。スマホ、パソコン、ヘッドホン、腕時計の検索語には「本体」を足し、ギフトカード、プリペイドコード、ケース、カバー、フィルムは後ろへ下げる。`CAPTURE_WEB_LOOKUP=wikipedia` のときだけ、印刷された型番が無いスマホ、タブレット、パソコン、カメラ、ゲーム機、ヘッドホン、腕時計を、Wikipedia の英語と日本語の抜粋と `gemini-3.5-flash-lite` 1回で特定する。確信度が high のときだけその型番で探す。未設定ならこの通信はしない。429 のときはそのプロセスのその日はもう呼ばない。通常のフォールバックは今までどおり `gemini-3.5-flash-lite`。未設定ならどちらも動かない。既定のモデルは変えない。Flash は、ブランドが無く、色と種類だけの unsure で、靴・バッグ・服のときだけ `gemini-3.5-flash` を1日15回まで足す。シリーズが残る名前、sure、時計、ヘッドホンでは呼ばない。429 や上限の応答では Flash を送り直さず、今の推定か flash-lite に戻り、そのプロセスではその UTC 日の残りを呼ばない。503 は1回だけ送り直す。`llama4-gemini-fallback` は lite のまま。

無料枠はモデルごとに1日およそ20回で、中央値の待ちは約25秒。Gemini を既定にはしない。`llama4-gemini-fallback` も未設定なら動かない。自信が低い（unsure）だけでは lite を呼ばない。呼ぶのは llama 4 が失敗したとき（1日の上限を除く）、読めないとき、商品名が無いとき、そして llama 4 の検索段が 0 件のとき。lite の検索も 0 件、または lite が失敗・429・時間切れなら、llama 4 の名前と検索結果を残す。この判断は `runGeminiFallback` にあり、写真の推定 API と評価の `--mode all` が同じ関数を使う。推定 API は選んだとき、画面へ返す商品名を決めるために検索段を先に実行する。

キーは `GEMINI_API_KEY`。`AQ.` で始まるキーも通す。リクエストの URL には置かず、ヘッダ `x-goog-api-key` だけ。`CAPTURE_SECRETS_FILE` は知らないキーを読まないので、このキーはプロセスの環境変数に置く。`GEMINI_MODEL` の初期値は `gemini-3.5-flash`。思考はモデルごとで、flash は `thinkingLevel: low`、flash-lite は `thinkingLevel: minimal`（lite に `thinkingBudget: 0` を送ると 400。[Gemini 3.5](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5)、[思考](https://ai.google.dev/gemini-api/docs/generate-content/thinking)）。タイムアウトは 90 秒。画面の判定は待たずに1回だけ送り直す。429 と 503 を 10 秒、20 秒と最大6回待つのは評価ハーネスだけ。返答は `responseMimeType: application/json` と `responseSchema`。ニューロン台帳は増えない。

評価は推測と検索を別のマシンで分けられる。推測側は `GEMINI_API_KEY` だけ、検索側は Yahoo と楽天のキーだけ。最後の JSON は今までのライブ評価と同じ項目（`diagnosticPoints` の満点は 84。ブランドのある15枚は4点、無い8枚は3点）なので、Workers の結果と並べられる。

```bash
node --import tsx tests/eval/photo-search/live-harness.ts --mode guess --variant gemini-ladder --images tests/eval/photo-search/images --out /tmp/gemini-ladder-guesses.json
node --import tsx tests/eval/photo-search/live-harness.ts --mode search --guesses /tmp/gemini-ladder-guesses.json --out /tmp/gemini-ladder.json
```

lite は `--variant gemini-lite-ladder`。検索側は任意で `--truth /絶対パス/truth.json`。

llama 4 のあと、必要なときだけ lite を足す。推測は Cloudflare のキーとニューロンの申告が要る。Gemini のキーが無いときは llama 4 の推測だけを書く。店のキーは推測には要らない。

```bash
node --import tsx tests/eval/photo-search/live-harness.ts \
  --mode guess \
  --variant llama4-gemini-fallback \
  --images tests/eval/photo-search/images \
  --out /tmp/llama4-gemini-guesses.json \
  --account-used-neurons 0 \
  --usage-day 2026-10-29
```

`--mode guess` は llama 4 の JSON だけを書く。0件かどうかは検索しないと分からない。lite を足す判断は `--mode all`（Cloudflare、Gemini、Yahoo、楽天）と、`CAPTURE_AI_MODEL=llama4-gemini-fallback` の `POST /api/capture/identify` が同じ関数で行う。この環境では API キーが無いので、ライブの点数は未確認。

根拠のないブランドを外す評価。並べ替えは `CAPTURE_AI_RERANK=1` のときだけ:

```bash
node --import tsx tests/eval/photo-search/live-harness.ts \
  --mode all \
  --variant llama4-gemini-grounded \
  --images tests/eval/photo-search/images \
  --out /tmp/llama4-gemini-grounded.json \
  --account-used-neurons 0 \
  --usage-day 2026-10-29
```

ブランドの確認だけで並べ替えないときは `--variant llama4-brand-guard`。報告書の `geminiCalls` が lite の呼び出し回数。

根拠があるときだけブランドを書く評価。lite だけを見るときは `--variant gemini-lite-evidence`（Cloudflare は要らない）。

```bash
node --import tsx tests/eval/photo-search/live-harness.ts \
  --mode all \
  --variant llama4-evidence \
  --images tests/eval/photo-search/images \
  --out /tmp/llama4-evidence.json \
  --account-used-neurons 0 \
  --usage-day 2026-10-29
```

## 選んだモデル

`@cf/meta/llama-3.2-11b-vision-instruct`

写真20枚の実測（Issue #100）は、この環境に API トークンが無いため未確認。次の表は Cloudflare の公開ドキュメント（料金ページの更新日 2026-10-20、各モデルページ）による。4つとも Vision で、有料プラン必須のモデル一覧には入っていない。無料枠は1日 10,000 ニューロン。

| モデル | 入力ニューロン / 100万トークン | 出力ニューロン / 100万トークン | 画像の渡し方 |
| --- | --- | --- | --- |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 4410 | 61493 | `image` に data URL。テキストが返る |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 24545 | 77273 | チャット。専用の `image` 手順はモデルページに無い |
| `@cf/google/gemma-4-26b-a4b-it` | 9091 | 27273 | チャット |
| `@cf/qwen/qwen3.8-27b` | 40909 | 290909 | チャット。推論の既定が深く、出力が増えやすい |

選んだ理由は、4つの中で入力ニューロンが最も少なく、画像を data URL で渡してテキストを受け取る手順がドキュメントにあるため。商品名の正解率は未確認。実測で上位5件の差が1枚以内なら、ニューロンが少ないほうを採る、という Issue #100 の決め方はまだ適用できない。

モデルが 5016 を返したときは、追加のリクエストを送らず `AI_UNAVAILABLE` を返す。文面は固定で、上流の文章は返さない。

通信の失敗、時間切れ、408、429（1日の上限 3036 を除く）、5xx、JSON として読めない返事は、同じ判定の中で1回だけ送り直す。利用者の回数は1回のまま。ニューロンは、返事に数が書いてあればその合計を足す。モデルが `unreadable` と返したときだけ「この写真からは商品が読み取れません」にする。空の products や、色の候補をスラッシュで並べた名前は、読めない写真にはしない。スラッシュの一覧は1つの商品名に整え、世代の数字は落とす。自信があるとは扱わない。

このモデルは 2024-09 公開で、学習に Pixel 10（2025-08 発表）は入っていない。背面の形から近い世代を言い切り、学習にある色名をスラッシュで並べることがある。商品名の正解率は未確認のまま。比較する候補は、同じ Workers AI の `@cf/meta/llama-4-scout-17b-16e-instruct`、`@cf/google/gemma-4-26b-a4b-it`、`@cf/moondream/moondream3.1-9B-A2B`。モデル全体の選定は #100 で継続する。#247の1枚比較でも他モデルは誤同定したため、モデルは変更していない。

## 上限

- 1人につき1分3回、UTC の1日10回。判定の失敗も数える。写真の形式が違うときは数えない。
- 全体で UTC の1日 8,000 ニューロンに達したら、その日は判定を止める。無料枠 10,000 との差は余裕。
- 返事の `result.usage.neurons` が 0 以上の数なら、その値を足す。0 は 0 として数える。トークン料金の見積もりは足さない。
- `usage` が無い、または `neurons` が数値でないときだけ、378 ニューロンとして数える（入力 80,000 トークンと出力 400 トークンの切り上げ。実測ではない）。
- 回数とニューロンは SQLite の `capture_ai_usage` に残す。再起動しても、その UTC の日のカウントは残る。日付が変わると、その日の行は数えず、回数とニューロンは戻る。
- Cloudflare が 429 かつ内部コード 3036（無料枠を使い切った）を返したときも、その日は止める。
- 上限のときは「今日は写真からの自動の判定が上限に達しました。商品名を入れて探してください」。1分の上限だけ「写真からの判定は1分に3回までです。商品名を入れて探してください」。どちらも `fallback` は `manual-entry`。

## ローカルで1枚だけ試す

トークンはリポジトリに置かない。次の値はシェルか、リポジトリの外にあるモード 0600 のファイル（`CAPTURE_SECRETS_FILE`）にだけ書く。

```bash
export CAPTURE_ENABLED=true
export CAPTURE_AI_ENABLED=true
export CLOUDFLARE_ACCOUNT_ID=（32桁の16進数）
export CLOUDFLARE_API_TOKEN=（Workers AI の Read）
npm run dev
```

会員でログインしたブラウザから、写真を1枚選ぶ。API を直接呼ぶ場合は、ログイン済みの Cookie と、ページと同じ `Origin` を付けて `POST /api/capture/identify` に `photo` というファイルを1つだけ送る。JPEG、PNG、WebP で 5MB まで。30秒で打ち切る。トークンと写真はログに出さない。

## 退会と全体の利用上限

退会時はAI使用記録の会員IDと実行時刻を除き、日付と消費量だけを全体上限の計算に残す。処理中の予約も残し、終了時の精算で実消費量へ更新する。退会や再起動で使用済みの全体枠は戻らず、翌UTC日に新しい枠を使う。

## 写真の確かさと検索条件（#247）

指示文に実在のブランドや商品の見本は書かない。見本と同じ商品名（色や種類を足しただけのものも含む）は捨て、検索しない。種類や色だけの名前は自動検索しない。返されたbrand/modelが表示される商品名にも含まれる場合だけ残し、商品名に無い別ブランドは足さない。商品名にシリーズが残っていて model が空のときは、そのシリーズを model として残す。モデルがブランド名だけを返し、種類を productType か種類語の model に置いたときは、表示する商品名へ種類を足す。ブランドだけで種類もシリーズも無い推定は unsure に下げ、ブランド名だけを自動検索しない。ブランドと種類、またはブランドとシリーズがある推定は sure のまま検索する。この規則は同一商品を保証しない。商品名そのものに含まれる幻覚はこの規則で検出できないので、画面でも推定であることを伝える。JANはバーコード認識を実装するまで無条件に捨てる。

検索語は name、brand、model の重複する語を外し、空白で挟んだハイフンを外す。楽天は 128 バイト以内、Yahoo! は 400 字以内。助詞のある長い説明文は、色と種類だけに縮める。

店の検索が0件のときは、長い検索語からブランド欄、型番欄の順に外す。商品名のなかに種類と型番の両方があるとき、最後の検索語は型番の語だけを外し、種類は残す。ブランド名だけにはしない。1件でも返った検索は短くしない。候補の並びは、JAN、付属品、別カテゴリ、名前の部分一致、価格の順。クエリが靴なら鞄の候補を後ろへ回す。

写真だけで難しいときは、名前・ブランド・品番の追加入力を案内する。ファイル名の品番らしい英数字は、利用者が「この品番で探す」を選んだ場合だけ名前クエリとして送る。AIへファイル名を付加せず、ブランド・型番・JANの非表示条件にも入れない。撮影日時、IMG/PXL/DSCなどのカメラ名、UUID、短い文字列は提案しない。品番である保証はなく、一般的なファイル名には適用できない。

実画像の評価とモデル比較は [#247の評価記録](./capture-evaluation-247.md) を参照。1枚の結果で #100 の20枚評価を完了したとは扱わない。

### 評価ツールと通常画面の範囲（PR #252）

`CAPTURE_AI_MODEL` は通常画面の単一モデルを選ぶ設定。`*-ladder` と `ensemble` はライブ評価ツール専用で、通常画面の設定値ではない。評価が済むまで既定モデルを変更しない。種類が合う候補と、写真と同じ商品は区別する。過去の23枚のカテゴリ・ブランド採点は、同一商品の検索成功率を示していない。

評価時はサービスと共用する永続的な評価用SQLiteの絶対パスを `BUTUYOKUOH_DB_PATH` に設定し、Cloudflareの当日UTCのアカウント全体使用量を確認して `--account-used-neurons` と `--usage-day YYYY-MM-DD` を必ず渡す。本番DBは使わない。同じキーを使う別環境の実行を止め、実行をまたいで同じ台帳を使う。評価の台帳は写真ごとの `eval-…` を残し、画面の1分3回・1日10回はかけない。かけているのはアカウント全体の 8,000 ニューロンだけ。先に取るのはその variant の見積もり（llama 4 は1回およそ40から100。Gemini は 0）で、応答の利用量で精算する。不明な通信は1回2,000として計上する。これは保守的な見積もりであり、アカウント全体に強制する課金上限ではない。別環境との並列実行や古い使用量の申告では無料枠を保証できない。画面を使う会員の1分3回・1日10回はそのまま。

`--truth /absolute/path/truth.json` は画像IDから正解商品の品番リストへの対応（例: `{"original-bag":["7897722AA4V1000"]}`）。推定結果とは独立に正解を確認して作る。上位5件の商品名に品番が含まれるかを `exactProductTop5` に記録し、正解未設定は未採点にする。品番が商品名にない場合の目視照合は別途必要。カテゴリ採点は `diagnosticPoints` として別に残す。API失敗も正解がある画像の分母に含める。中断時の途中結果も保存する。

Issue #100 の完了には、正解が確認された20枚以上の同条件比較、Qwenを含む対象モデルの実測、処理時間・費用の集計が引き続き必要。このPRの修正だけでモデルの優劣や写真だけでの同一商品到達を結論づけない。

### 楽天の400再現（Issue #251）

2026-10-29、同じ接続元・認証・APIに対し `Gucci - Gucci Sylvie Bag` は400 (`wrong_parameter`, `keyword is not valid`)、単独ハイフンだけを除いた `Gucci Gucci Sylvie Bag` は200・8件、重複も除いた `Gucci Sylvie Bag` は200・8件。`G-SHOCK GW-M5610U`、日本語の商品名、品番単独は200だった。単独記号を除き、型番内部のハイフンや手入力のブランド・品番は残す。元の10/27リクエスト全体は未保存のため、その時の隠れた条件まで同一とする再現ではない。
