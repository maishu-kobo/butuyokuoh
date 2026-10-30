# 検証と独立レビュー

## 検証対象

- 新案：`f1f750ace87a22d49c6556809e7eafd15fd28eae`。
- #258・#259を含む基準ブランチ：`82cc6adf41bb963458df0c9c92f217a8ec44ace6`。取り込みは `8a8df2f`。
- GitHub ActionsのChromium。固定データのみ。実アプリのCIも同じブランチで実行。Cloudflareの実API、本番データ、外部の商品検索は不使用。
- ネットワークを使った公式UI調査と、回帰テストは別の作業。調査用の一時specは削除済み。最終の試作回帰テストは通信を遮断し、フォントもローカルfixtureから読む。

## 実行結果

- [CI: test, types, build](https://github.com/maishu-kobo/butuyokuoh/actions/runs/41108997084)：成功。blocking-unit **577 passed / 0 failed**、`npx tsc --noEmit`、`npm run build`、`npm run lint`、警告増分チェックが成功。Lintは既存23 warnings / 0 errorsで、新規違反なし。
- [Playwright](https://github.com/maishu-kobo/butuyokuoh/actions/runs/41108997032)：通常レーン **90 passed**。production smoke・guest disabledも成功。
- CodeQL・gitleaks・Dependency review・npm audit・quarantined tests：成功。
- 成果物追加後の最終HEADのCIリンクはPR #257のChecksと提出コメントに記載。保存対象のコード・試験は上記f1f750aから変更していない。

## 6つの操作シナリオ

A/B/Cそれぞれ390px・1280pxで以下を操作。さらに各シナリオ末尾で320pxの横あふれを検査した。

- 一覧・商品名検索・0件・画像なし・価格未取得。
- ローカル写真の選択、固定サンプルへの戻し、候補未選択時の登録無効。
- Spaceで候補選択、登録。Cは確認段階を通る。
- 2店舗の表示、Spaceで店舗切替。日付を先に入力してから店を変更しても入力値が残る。
- 予定保存・日付順一覧・¥153,200の合計・価格未取得1件の除外・店舗候補の重複計上なし。
- Cのキーボード商品選択、写真シートのTab/Shift+Tab循環、Escapeと戻りフォーカス。
- Cの無効な画像選択時にダイアログ内の案内を表示。
- ライト・ダーク表示。主ボタンのホバー時に計算上4.5:1以上の文字コントラスト。
- JavaScriptエラーなし、ページからの外部リクエストなし。状態リセット後に4商品へ戻る。

スクリーンショットは一覧・写真候補・店舗比較・予定・ダーク予定の5状態×3案×2幅＝30枚。[一覧](screenshots.md)から閲覧できる。旧案と既存PRアプリの7枚も保存した。

## 画像を見て直した点

- CIの日本語フォント不足を解消。固定のNoto Sans JPとNoto Serif JPを撮影だけに使用し、OFLを同梱。アプリ用のライブラリ・フォント依存は増やしていない。
- 検索ラベルの縦折り返し、狭い「写真なし」の枠、予定行の日付・商品名・店舗の連結を修正。
- 保存ボタンのホバー時に白文字が薄い背景へ載る問題を修正し、コントラスト検査を追加。
- Cのシート画像は全ページではなく表示中のビューポートを撮影。Aのセリフ見出しを撮影用フォントでも保持。

## 独立レビュー

別のCodexによる静的レビュー。実装担当と別のエージェントが実施。

| 対象 | 判定 | 対応 |
|---|---|---|
| `cc33b50` | Important 3 | 未保存日付の消失、選択後フォーカス／モーダル通知、撮影フォントの外部通信依存 |
| `cc33b50 → 0425f27` | 元の3件は解消。残るImportant 1 | 一時的な公式資料取得specを最終テストから除去 |
| `0425f27 → 5bc2cc6` | Important 0 / Nit 0 / Pre-existing 0 | 調査specの削除と追加のホバー・キーボード検査を確認 |
| `5bc2cc6 → f1f750a` | **Important 0 / Nit 0 / Pre-existing 0** | ブラウザ検査で判明したTab循環の修正のみ再確認 |

ClaudeはCLIの認証状態が `loggedIn: false` で利用できなかった。Claudeによるレビューとしては扱っていない。独立レビューは静的確認であり、ブラウザ操作と画面確認は実装担当によるCI実行・取得画像の確認。

## 再現

リポジトリで `npm ci`、`npx playwright install chromium` の後：

```sh
npx playwright test tests/e2e/ui-revision.spec.ts
node scripts/test-lanes.mjs blocking-unit
npx tsc --noEmit
npm run lint
npm run build
```

通常のPlaywright設定を使うため、開発サーバーの起動を許可する環境が必要。単に試作を操作するだけならHTMLを開くだけでよい。

## 確認範囲の限界

- Safari/WebKit・Firefox・実機タッチ・スクリーンリーダーの読み上げは未検証。
- native date入力の見た目はOSとブラウザ依存。内部値と保存した日付は検証済み。
- 全テキスト・全組合せのアクセシビリティ適合を保証するものではない。主操作のコントラストと指定フローのキーボード操作を確認した。
- 写真認識・検索精度や実価格は評価していない。実APIは呼んでいない。
- Redの証拠：`5bc2cc6` のC案390/1280pxで `expect(#sample-photo).toBeFocused(): Received inactive`。Tab循環の不具合を修正し、同じ検査を再実行した。日付・外部フォントなど先行する静的指摘については、修正前Redは未記録。
- 新案は試作であり、実アプリへの統合・採用は利用者の選択待ち。Draftを維持する。
