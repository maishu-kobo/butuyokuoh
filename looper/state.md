# Loop State

- 周回: 9
- discovery 連続空振り: 0（最終discovery: 周回6、採用5件）

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
- [ ] ItemCard に価格更新ステータス表示 (#33) | 受け入れ条件: 最終更新からの経過時間が表示され、scrape_status が failed のアイテムに警告表示が出る | origin: human | fix: 0 | 待機: PR #47 マージ後（scrape_status/last_scraped_at カラムとGET応答に依存。ItemCard.tsxスタック回避のためマージ待ち）
- [ ] getDb() で data/ ディレクトリを自動作成する | 受け入れ条件: data/ が存在しない新規クローン環境で getDb() が例外を出さずDBを初期化できる | origin: auto | fix: 0
- [ ] /api/upload の拡張子・MIME検証強化（SVG/HTML偽装XSS対策） | 受け入れ条件: .svg/.html/許可外拡張子が400になる。ファイル名に / や .. を含むケースで uploads/ 直下以外に書き込まれない。正常な jpg/png は従来どおり成功 | origin: auto | fix: 0
- [ ] 価格ソートで current_price が null のアイテムを末尾に表示 | 受け入れ条件: price_asc / price_desc いずれでも価格未取得アイテムが末尾に並び、価格ありアイテム同士の順序は従来どおり | origin: auto | fix: 0
- [ ] ItemCard 編集保存失敗時にフォームを閉じずエラー表示する | 受け入れ条件: PATCH 失敗時に編集フォームが開いたまま入力値が保持されエラーメッセージが表示される。成功時は従来どおり閉じる | origin: auto | fix: 0
- [ ] check-prices の例外catchパスでも scrape_status='failed' を記録する (#33 follow-up) | 受け入れ条件: scrapeUrl が例外を投げたアイテムでも last_scraped_at と scrape_status='failed' が記録される | origin: auto | fix: 0

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
- [x] スクレイプ結果の記録: items に last_scraped_at / scrape_status / scrape_error を追加し check-prices と refresh で更新 (#33) | PR: #47 | 周回: 8
- [x] ItemCard 画像に loading="lazy" decoding="async" を付与 (#36) | PR: #48 | 周回: 9

## blocked
<!-- 書式: - タイトル | 理由 | fix試行: N -->

## マージログ
- 2026-06-11 (周回7後): 人間の指示で溜まったマージ候補6本を Codex CLI でレビュー → 対応 → develop へマージ。
  - Codex レビュー結果: BLOCKER ゼロ。#44/#45/#39 は完全LGTM、#43は最適化SHOULD2件、#40/#41はスクレイパーSHOULD計5件
  - 対応: コア機能(#13)の信頼性に直結する3件（fetchWithRetryのper-attemptタイムアウト、body破棄、恒久4xxでPuppeteerスキップ）を #41 ブランチに追加実装し tester 検証 pass
  - マージ済み: #39, #44, #45, #43, #40, #41（全て squash、develop）。スタックの#41はsquash後コンフリクトしたため develop をマージして解決（#41側=#40内包の優越で欠落なし）
  - 統合ビルド: tsc/next build とも pass（6PR統合後の develop で確認）
  - 残った非ブロッカー指摘（#43 CTE化/履歴インデックス、#41 価格なし商品のPuppeteer抑制、engines明示 等）は follow-up Issue #46 に集約
  - 結果: develop は origin にマージ反映済み（main への昇格は未実施＝人間判断）。looper/state.md は引き続きローカルのみ

## 終了ログ
- 2026-06-11 周回0: push 権限不足のためループ終了（人間の介入待ち）。develop ブランチはローカルに作成済み・未push。
- 2026-06-11 周回1: push 権限解消を確認、blocked を解除。リモート develop を main (31986a7) から初期化。
