# Loop State

- 周回: 11
- discovery 連続空振り: 0（最終discovery: 周回11、採用予定）

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
- [ ] ItemCard に価格更新ステータス表示 (#33) | 受け入れ条件: 最終更新からの経過時間が表示され、scrape_status が failed のアイテムに警告表示が出る | origin: human | fix: 0 | 待機: PR #47 マージ後（scrape_status/last_scraped_at カラムとGET応答に依存。ItemCard.tsxスタック回避のためマージ待ち）
- [ ] 価格ソートで current_price が null のアイテムを末尾に表示 | 受け入れ条件: price_asc / price_desc いずれでも価格未取得アイテムが末尾に並び、価格ありアイテム同士の順序は従来どおり | origin: auto | fix: 0
- [ ] ItemCard 編集保存失敗時にフォームを閉じずエラー表示する | 受け入れ条件: PATCH 失敗時に編集フォームが開いたまま入力値が保持されエラーメッセージが表示される。成功時は従来どおり閉じる | origin: auto | fix: 0
- [ ] check-prices の例外catchパスでも scrape_status='failed' を記録する (#33 follow-up) | 受け入れ条件: scrapeUrl が例外を投げたアイテムでも last_scraped_at と scrape_status='failed' が記録される | origin: auto | fix: 0
<!-- 周回11 discovery 採用5件 -->
- [ ] バグ: 比較グループ削除API (/api/comparison-groups/[id]) が存在せず設定画面の削除が404になる | 受け入れ条件: comparison-groups/[id]/route.ts に DELETE を実装。認証+所有権(user_id)確認、未所有は404。削除時に紐づく items.comparison_group_id を NULL 化。設定画面から削除すると200で一覧から消え所属アイテムは未分類として残る | origin: auto | fix: 0
- [ ] PriceChart に目標価格(target_price)の基準線を表示 | 受け入れ条件: target_price がある場合 recharts ReferenceLine で水平線+「目標 ¥XXX」ラベルを描画、達成/未達が色だけでなくラベルでも判別可能。未設定時は従来通り線なし。履歴1件表示でも目標価格があればテキスト併記 | origin: auto | fix: 0
- [ ] stats の total_items / monthlyPurchased が論理削除アイテムを除外していない | 受け入れ条件: stats/route.ts の total_items COUNT に deleted_at IS NULL を追加、monthlyPurchased にも AND deleted_at IS NULL を追加。ゴミ箱投入後に /api/stats の該当数が減る | origin: auto | fix: 0
- [ ] comparison-groups の item_count が論理削除/購入済みアイテムを含む | 受け入れ条件: comparison-groups/route.ts の JOIN に AND i.deleted_at IS NULL AND i.is_purchased = 0 を追加（categories の集計方針に合わせる）。ゴミ箱投入/購入済み化で item_count が減る | origin: auto | fix: 0
- [ ] BudgetView で価格未取得アイテムが合計に黙って除外される点を明示 | 受け入れ条件: 月カード/全体合計に価格未取得アイテムが含まれる場合「うちN件は価格未取得のため合計に含まれません」等の注記を表示。該当0件なら非表示。既存の合計表示・選択合計の挙動は維持 | origin: auto | fix: 0

## discovery メモ（非採用候補、次回の参考）
<!-- 周回6 discovery で採用枠5件から漏れた候補 -->
- items POST/PATCH の category_id/comparison_group_id 所有権検証なし（クロステナント参照、#43マージ後に対応推奨）
- url-validator の SSRF ブロックリスト不備（169.254.x、172.17-31.x、IPv6等）+ vitest テスト基盤導入
- フロントの res.ok 未確認による401/500時クラッシュ（page.tsx、PriceChart、各タブの読み込み失敗時エラー表示+再試行と同根）
- 削除直後のUndoトースト（復元APIは既存）/ 全て更新の進捗表示 / ItemCardタップ領域44px化+aria-label
- /api/export・purchased・カテゴリ/グループ item_count の deleted_at 除外漏れ、CSV数式インジェクション
- extension-add でゴミ箱内URL再登録時に UNIQUE 制約違反で500
<!-- 周回11 discovery で採用枠から漏れた候補 -->
- extension-import の重複チェックがゴミ箱内URLを見落とし復活させられない（extension-import/route.ts:62、deleted_at考慮なし）
- items 並び替えがアイテムごとの個別PATCHでトランザクション/原子性なし → 一括 reorder エンドポイント(db.transaction)化（page.tsx:144、items/[id] PATCH）
- categories DELETE のアイテム category_id クリアが user_id で絞られていない（categories/[id]/route.ts:57、防御的に AND user_id=? 追加）
- StatsView 全ゼロ時の空状態オンボーディング誘導（取得失敗と区別）
- BudgetView 過去日付の購入予定を未来と視覚区別（予定日経過ラベル）
- AddItemForm URLモードの対応サイト判定フィードバック+所要時間予告（ImportWishlistModal水準に）
- TrashView 残り日数が少ないアイテムの緊急度マーカー（色依存でなく。※#48がTrashView.tsx変更中のためマージ後）
- upload route で file.name に /・\・.. を含む場合 path.basename で正規化 or 早期400（PR #50 tester指摘[low]、実害なしの防御強化）

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
- [x] getDb() で data/ ディレクトリを自動作成する | PR: #49 | 周回: 10
- [x] /api/upload の拡張子・MIME検証強化（SVG/HTML偽装XSS対策、四段構え検証） | PR: #50 | 周回: 11

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
