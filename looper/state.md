# Loop State

- 周回: 0
- discovery 連続空振り: 0

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
- [ ] DBマイグレーション機構の追加と quantity/sort_order カラム反映 (#32) | 受け入れ条件: data/ を空にした新規環境で起動後、items の GET/POST がSQLiteエラーなく動作する。カラム追加済みの既存DBでも起動時にエラーが出ない | origin: human | fix: 0
- [ ] scraper に HTTPステータス確認と指数バックオフリトライを追加、check-prices のアイテム間隔を5秒以上に延長 (#13) | 受け入れ条件: 503/429 応答時に最大3回リトライすることがテストで確認できる。check-prices.ts のアイテム間隔が5000ms以上 | origin: human | fix: 0
- [ ] Amazon 価格取得の Puppeteer フォールバック (#13) | 受け入れ条件: fetch でボット検知/失敗した場合に Puppeteer で再取得するコードパスが存在し、tester が実Amazon URLで価格取得を確認できる | origin: human | fix: 0
- [ ] スクレイプ結果の記録: items に last_scraped_at / scrape_status / scrape_error を追加し check-prices と refresh で更新 (#33) | 受け入れ条件: check-prices 実行後、成功/失敗それぞれのアイテムに last_scraped_at と scrape_status が記録される | origin: human | fix: 0
- [ ] ItemCard に価格更新ステータス表示 (#33) | 受け入れ条件: 最終更新からの経過時間が表示され、scrape_status が failed のアイテムに警告表示が出る | origin: human | fix: 0
- [ ] page.tsx 初期3フェッチ（items/comparison-groups/categories）の Promise.all 並列化 (#34) | 受け入れ条件: 3つの fetch が並列実行され、表示内容が変更前と同一 | origin: human | fix: 0
- [ ] /api/items の previous_price 相関サブクエリ解消と複合インデックス追加 (#35) | 受け入れ条件: 行ごとの相関サブクエリが無くなり、レスポンス内容が変更前と同一。EXPLAIN QUERY PLAN でインデックス使用を確認 | origin: human | fix: 0
- [ ] ItemCard 画像に loading="lazy" decoding="async" を付与 (#36) | 受け入れ条件: 一覧の img 要素に属性が付与され、画像表示が変更前と同一 | origin: human | fix: 0

## in_progress

## done
<!-- 書式: - [x] タイトル | PR: #N | 周回: N -->

## blocked
<!-- 書式: - タイトル | 理由 | fix試行: N -->
- ループ全体（push 不可） | アカウント shimazushi は maishu-kobo/butuyokuoh に READ 権限のみで `git push` が 403 拒否される。feature ブランチの push と PR 作成ができないため周回を実行できない。対処案: (1) shimazushi に write 権限を付与 (2) 書き込み可能なアカウントで gh auth login (3) fork 運用に切り替え | fix試行: 0

## 終了ログ
- 2026-06-11 周回0: push 権限不足のためループ終了（人間の介入待ち）。develop ブランチはローカルに作成済み・未push。
