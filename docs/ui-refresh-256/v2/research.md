# 調査と設計の根拠

調査日：2026-10-30 UTC（2026-10-31 JST）。ローカルのブラウザ環境が使えなかったため、GitHub Actions上のChromiumで公式ページを開き、本文と画面を確認した。検索結果の見出しだけで調査済みとは扱っていない。

## 前回案と現行PRの診断

[旧3案の画像](baseline/) と [#257の既存アプリ画面](baseline/app-1280.jpg) は固定fixtureで撮影したもの。本番データの画面ではない。

- 旧3案はいずれも、上部の案説明→ヘッダー→タブ→検索→商品という順序。案の説明が商品より先に広い面積を使っていた。
- Aは写真の大小、Bは行の密度、Cは余白と白い面が主な違いだった。B/Cは写真・名称・右端価格の並びが近かった。
- HTMLでも写真登録は同じ追加ダイアログを共有していた。写真を探す体験が「商品を追加」の一方式に埋もれていた。
- 同じヘッドホンの別店舗候補が別商品として並び、商品を選ぶ判断と店を選ぶ判断が混ざっていた。
- 旧#257アプリでは件数・合計・フィルター・追加欄が商品より先に並ぶ。物欲王固有の「店頭の写真→未確認事項→候補→店舗比較」の連続性が見えにくかった。

これは「AIが作った画面一般」の因果を実証した調査ではなく、この成果物の画面とコードからの診断である。対策は装飾の除去だけでなく、判断する順番と情報のまとまりを変えることに置いた。

## 確認した実例と適用先

| 一次資料・実際に見た箇所 | 確認したこと | 今回の適用と理由 |
|---|---|---|
| [Apple Photos — Get started](https://support.apple.com/guide/photos/get-started-pht23b129fed/mac)、Import / Browse your photos | 左のライブラリ・アルバム選択、上の表示操作、写真領域を分けている | Cの左ナビ・中央リストの分離。写真の閲覧と操作の位置を固定し、探す対象を変えても迷いにくくする。Aでは写真を主内容にする考え方を採用 |
| [Apple Reminders — User Guide](https://support.apple.com/guide/reminders/welcome/mac)、Organize your grocery list | 見出しで分類された行、現在のリストの選択状態 | Cの用途別見出しと商品行。すべてを独立カードにせず、カテゴリ→商品→詳細の順に読む |
| [Apple — Compare Mac models](https://www.apple.com/mac/compare/) | 商品を列として並べ、対応する仕様を同じ位置で比較する | Bの店舗比較を商品価格・送料・支払額・状態の共通行にする。Appleの大きな宣伝見出しや素材は転用しない |
| [Things — Features](https://culturedcode.com/things/features/)、Beautiful To-Dos / Headings / Upcoming | 一覧の項目を開いて詳細を扱い、追加項目は必要なときに出す。見出しと日付で整理 | Cの一覧と詳細の分離、全案の購入予定を日付順にする。Aは「欲しい理由」を商品に添える。Thingsの独自ジェスチャーは導入しない |

[Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout) の本文はページ表示では読み込めなかったため、[Appleが配信する同文書のJSON](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json)を取得して確認した。Visual hierarchy / Adaptabilityの、重要度による順序、整列と関連情報のまとまり、段階的な開示、幅に応じて機能を保つ原則を採用。Cの一覧・詳細・写真シート、Bの比較行、全案の幅に応じた組み替えに対応する。素材・ガラス表現の推奨はこのWebサービスへ機械的に適用していない。

## 採用しなかった／取得が不十分だった資料

- [Bellroy Backpacks](https://bellroy.com/products/category/backpacks)：ナビゲーションと説明文は取得できたが、商品グリッドが揃った状態を確認できなかった。商品一覧の設計根拠として採用していない。
- [REI Bellroy packs](https://www.rei.com/b/bellroy/c/packs)：ブラウザ取得がHTTP/2エラーで失敗。調査済みの実例に含めない。
- Apple純正アプリは公式ガイド掲載の画面を観察した。ネイティブアプリを自分で操作した検証ではない。

## 3案へ落とし込んだ判断

A：写真の大小、メモ、細い区切り線で「見つけた理由」を読む。写真登録は元画像を残したページにする。長い商品名を省略せず、画像なしも同じ位置に置く。

B：一覧で支払額・店・予定を揃える。写真候補は同じ比較項目、登録後の店舗は価格・送料・状態の表にする。支払額を強調して送料を隠さない。

C：現在の選択を背景色とフォーカスで示し、デスクトップは詳細ペイン、スマートフォンは詳細への遷移にする。写真は選択→比較→確認の順で情報を増やす。白背景や角丸そのものをAppleらしさの根拠にはしない。
