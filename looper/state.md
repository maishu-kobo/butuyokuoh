# Loop State

- 周回: 4
- discovery 連続空振り: 0

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
- [ ] スクレイプ結果の記録: items に last_scraped_at / scrape_status / scrape_error を追加し check-prices と refresh で更新 (#33) | 受け入れ条件: check-prices 実行後、成功/失敗それぞれのアイテムに last_scraped_at と scrape_status が記録される | origin: human | fix: 0 | 待機: PR #39/#40 マージ後（db.ts と check-prices.ts に依存、三重スタック回避）
- [ ] ItemCard に価格更新ステータス表示 (#33) | 受け入れ条件: 最終更新からの経過時間が表示され、scrape_status が failed のアイテムに警告表示が出る | origin: human | fix: 0 | 待機: 上記タスク完了後
- [ ] /api/items の previous_price 相関サブクエリ解消と複合インデックス追加 (#35) | 受け入れ条件: 行ごとの相関サブクエリが無くなり、レスポンス内容が変更前と同一。EXPLAIN QUERY PLAN でインデックス使用を確認 | origin: human | fix: 0
- [ ] ItemCard 画像に loading="lazy" decoding="async" を付与 (#36) | 受け入れ条件: 一覧の img 要素に属性が付与され、画像表示が変更前と同一 | origin: human | fix: 0
- [ ] getDb() で data/ ディレクトリを自動作成する | 受け入れ条件: data/ が存在しない新規クローン環境で getDb() が例外を出さずDBを初期化できる | origin: auto | fix: 0

## in_progress

## done
<!-- 書式: - [x] タイトル | PR: #N | 周回: N -->
- [x] page.tsx 初期3フェッチの Promise.all 並列化 (#34) | PR: #42（クローズ: 前提誤り。変更前から fire-and-forget で並列発火しており実装不要と判明。Issue #34 に訂正コメント済み） | 周回: 4
- [x] DBマイグレーション機構の追加と quantity/sort_order カラム反映 (#32) | PR: #39 | 周回: 1
- [x] scraper に HTTPステータス確認と指数バックオフリトライを追加、check-prices のアイテム間隔を5秒以上に延長 (#13) | PR: #40 | 周回: 2
- [x] Amazon 価格取得の Puppeteer フォールバック (#13) | PR: #41 (#40の上にスタック) | 周回: 3

## blocked
<!-- 書式: - タイトル | 理由 | fix試行: N -->

## 終了ログ
- 2026-06-11 周回0: push 権限不足のためループ終了（人間の介入待ち）。develop ブランチはローカルに作成済み・未push。
- 2026-06-11 周回1: push 権限解消を確認、blocked を解除。リモート develop を main (31986a7) から初期化。
