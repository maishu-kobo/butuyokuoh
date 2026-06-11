# Loop State

- 周回: 7
- discovery 連続空振り: 0（最終discovery: 周回6、採用5件）

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
- [ ] スクレイプ結果の記録: items に last_scraped_at / scrape_status / scrape_error を追加し check-prices と refresh で更新 (#33) | 受け入れ条件: check-prices 実行後、成功/失敗それぞれのアイテムに last_scraped_at と scrape_status が記録される | origin: human | fix: 0 | 待機: PR #39/#40 マージ後（db.ts と check-prices.ts に依存、三重スタック回避）
- [ ] ItemCard に価格更新ステータス表示 (#33) | 受け入れ条件: 最終更新からの経過時間が表示され、scrape_status が failed のアイテムに警告表示が出る | origin: human | fix: 0 | 待機: 上記タスク完了後
- [ ] ItemCard 画像に loading="lazy" decoding="async" を付与 (#36) | 受け入れ条件: 一覧の img 要素に属性が付与され、画像表示が変更前と同一 | origin: human | fix: 0
- [ ] getDb() で data/ ディレクトリを自動作成する | 受け入れ条件: data/ が存在しない新規クローン環境で getDb() が例外を出さずDBを初期化できる | origin: auto | fix: 0
- [ ] /api/upload の拡張子・MIME検証強化（SVG/HTML偽装XSS対策） | 受け入れ条件: .svg/.html/許可外拡張子が400になる。ファイル名に / や .. を含むケースで uploads/ 直下以外に書き込まれない。正常な jpg/png は従来どおり成功 | origin: auto | fix: 0
- [ ] 価格ソートで current_price が null のアイテムを末尾に表示 | 受け入れ条件: price_asc / price_desc いずれでも価格未取得アイテムが末尾に並び、価格ありアイテム同士の順序は従来どおり | origin: auto | fix: 0
- [ ] ItemCard 編集保存失敗時にフォームを閉じずエラー表示する | 受け入れ条件: PATCH 失敗時に編集フォームが開いたまま入力値が保持されエラーメッセージが表示される。成功時は従来どおり閉じる | origin: auto | fix: 0

## discovery メモ（非採用候補、次回の参考）
<!-- 周回6 discovery で採用枠5件から漏れた候補 -->
- items POST/PATCH の category_id/comparison_group_id 所有権検証なし（クロステナント参照、#43マージ後に対応推奨）
- url-validator の SSRF ブロックリスト不備（169.254.x、172.17-31.x、IPv6等）+ vitest テスト基盤導入
- フロントの res.ok 未確認による401/500時クラッシュ（page.tsx、PriceChart、各タブの読み込み失敗時エラー表示+再試行と同根）
- 削除直後のUndoトースト（復元APIは既存）/ 全て更新の進捗表示 / ItemCardタップ領域44px化+aria-label
- /api/export・purchased・カテゴリ/グループ item_count の deleted_at 除外漏れ、CSV数式インジェクション
- extension-add でゴミ箱内URL再登録時に UNIQUE 制約違反で500

## in_progress

## done
<!-- 書式: - [x] タイトル | PR: #N | 周回: N -->
- [x] page.tsx 初期3フェッチの Promise.all 並列化 (#34) | PR: #42（クローズ: 前提誤り。変更前から fire-and-forget で並列発火しており実装不要と判明。Issue #34 に訂正コメント済み） | 周回: 4
- [x] /api/items の previous_price 相関サブクエリ解消と複合インデックス追加 (#35) | PR: #43 | 周回: 5
- [x] /api/items/[id]/price-history に認証と所有権チェックを追加（未認証アクセス+IDOR脆弱性修正、脆弱性の実在も実行確認済み） | PR: #44 | 周回: 6
- [x] 本番環境で JWT_SECRET 未設定時にフェイルファストする（公開フォールバック鍵によるトークン偽造の修正） | PR: #45 | 周回: 7
- [x] DBマイグレーション機構の追加と quantity/sort_order カラム反映 (#32) | PR: #39 | 周回: 1
- [x] scraper に HTTPステータス確認と指数バックオフリトライを追加、check-prices のアイテム間隔を5秒以上に延長 (#13) | PR: #40 | 周回: 2
- [x] Amazon 価格取得の Puppeteer フォールバック (#13) | PR: #41 (#40の上にスタック) | 周回: 3

## blocked
<!-- 書式: - タイトル | 理由 | fix試行: N -->

## 終了ログ
- 2026-06-11 周回0: push 権限不足のためループ終了（人間の介入待ち）。develop ブランチはローカルに作成済み・未push。
- 2026-06-11 周回1: push 権限解消を確認、blocked を解除。リモート develop を main (31986a7) から初期化。
