# Loop State

- 周回: 20
- discovery 連続空振り: 0（最終discovery: 周回16、採用5件）
- 常設指示（2026-06-12 人間より）: 溜まったマージ候補PRは Codex レビュー → 指摘対応 → マージまでループが実施してよい

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
<!-- 周回11 discovery 採用5件 -->
- [ ] comparison-groups の item_count が論理削除/購入済みアイテムを含む | 受け入れ条件: comparison-groups/route.ts の JOIN に AND i.deleted_at IS NULL AND i.is_purchased = 0 を追加（categories の集計方針に合わせる）。ゴミ箱投入/購入済み化で item_count が減る | origin: auto | fix: 0
- [ ] BudgetView で価格未取得アイテムが合計に黙って除外される点を明示 | 受け入れ条件: 月カード/全体合計に価格未取得アイテムが含まれる場合「うちN件は価格未取得のため合計に含まれません」等の注記を表示。該当0件なら非表示。既存の合計表示・選択合計の挙動は維持 | origin: auto | fix: 0
<!-- 周回16 discovery 採用5件 -->
- [ ] notifier の webhook fetch にタイムアウト追加 | 受け入れ条件: Slack/Discord 通知 fetch に AbortSignal.timeout(約10秒) が付与され、応答しないエンドポイント宛が約10秒で false 返却となり check-prices のループが継続する | origin: auto | fix: 0
- [ ] register/login のメール正規化と形式検証 | 受け入れ条件: 両APIで trim+小文字化を適用。Foo@Example.com 登録後に foo@example.com の重複登録が400。どちらの表記でもログイン成功。不正形式は400。email/password の型チェックあり | origin: auto | fix: 0
- [ ] 検索/フィルタ0件時の空状態メッセージと条件クリア | 受け入れ条件: アイテムは存在するがフィルタ/検索0件のとき「条件に一致するアイテムがありません」を表示。「条件をクリア」ボタンで検索語・カテゴリ・優先度・グループ・並び順が初期化され全件再表示 | origin: auto | fix: 0

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
- PriceChart USD目標の1件表示で判定不可なのに橙(未達色)になる軽微な不整合（PR #53 tester指摘[low]。注記追加 or 中立色に）
- stats: total_items が算出されるがレスポンスJSONに未含有（未公開フィールド。公開 or 削除して整理）（PR #54 tester指摘。purchased系のdeleted_at除外はCodexレビュー対応で実施済み）
<!-- 周回16 discovery で採用枠から漏れた候補 -->
- import-wishlist の Puppeteer 同時起動制御なし（多重リクエストでメモリ枯渇。実行中フラグ/簡易キューで同時1+429）
- 設定ページのカテゴリ/グループ/通知設定の失敗が無言（res.ok未確認、入力消失。重複名400のメッセージも非表示）
- Chrome拡張ポップアップ: 設定保存フィードバックが商品ページ以外で不可視 + 保存直後にカテゴリ未読込（popup.js:50,120）
- 購入済みにする際の購入日が当日固定（後日記録で月別集計ずれ。日付指定UI + 単品/一括のconfirm不一致）
- PWAなのにService Worker未登録（オフライン起動でブラウザエラー画面。オフライン案内ページ）
- migrateDb に deleted_at の addColumnIfNotExists を防御的に追加（PR #56 Codex指摘SHOULD。CREATE TABLEに当初から有り全ルートが依存済みのため実環境では非問題）/ check-prices実行中にゴミ箱移動されたアイテムのUPDATE側除外（NIT）
- ItemCard handleRefreshWithNewUrl（URL変更+再取得フロー）に失敗ハンドリングなし、失敗時も setEditing(false) でフォームが閉じる（PR #58 tester指摘。保存フローと同様の res.ok 確認+エラー表示を適用）
<!-- 2026-06-12 #58/#59 Codexレビューで見送ったSHOULD/NIT -->
- ItemCard 保存中にキャンセル/編集トグルすると飛行中PATCHの結果が閉じたフォームのstateに反映される（AbortController or in-flightフラグで防御。PR #58 Codex SHOULD見送り、表示実害なし）
- scrape_error にPuppeteer/Node内部文言（URL・パス等）がそのまま入りItemCardツールチップに表示される（オーナー本人のみ閲覧のため見送り。共有機能実装時に要サニタイズ。PR #59 Codex SHOULD見送り）
- refresh API がゴミ箱内アイテムに実行可能（SELECT に AND deleted_at IS NULL 追加。既存問題、PR #59 Codex NIT）

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
- [x] バグ: 比較グループ編集/削除API (comparison-groups/[id]) 不在による404を修正（PUT/DELETE実装） | PR: #51 | 周回: 12
- [x] 価格ソートで current_price が null のアイテムを末尾に表示 | PR: #52 | 周回: 13
- [x] PriceChart に目標価格(target_price)の基準線を表示 | PR: #53 | 周回: 14
- [x] stats の total_items / monthlyPurchased が論理削除アイテムを除外していない | PR: #54 | 周回: 15
- [x] ItemCard に価格更新ステータス表示 (#33完結) | PR: #55（Codexレビュー LGTM、即マージ済み） | 周回: 16
- [x] バグ: check-prices がゴミ箱アイテムをスクレイプ・通知 | PR: #56（Codex BLOCKERなし、マージ済み） | 周回: 17
- [x] 通知 webhook URL の検証（SSRF対策） | PR: #57（tester バイパス18パターン許可漏れ0件、Codex LGTM、マージ済み） | 周回: 18
- [x] ItemCard 編集保存失敗時にフォームを閉じずエラー表示する | PR: #58（tester 全6項目 pass、tsc/build pass） | 周回: 19
- [x] check-prices の例外catchパスでも scrape_status='failed' を記録する (#33 follow-up) | PR: #59（refresh route の同種漏れも修正。tester がモック差し替えで動的検証、全項目 pass） | 周回: 20

## blocked
<!-- 書式: - タイトル | 理由 | fix試行: N -->

## マージログ
- 2026-06-12 (周回20後、人間指示): マージ候補2本（#58, #59）を Codex CLI でレビュー → 対応 → develop へマージ。
  - Codex指摘: BLOCKER 0件。#58 SHOULD2件+NIT1件、#59 SHOULD2件+NIT1件
  - 対応: #58 に handleSave 先頭の同期多重送信ガード + role="alert"（8ee4142）、#59 に statusRecorded フラグで catch 内 failed 記録が成功記録を上書きしない防御（4f97db4）。tester 検証 pass（フラグのライフサイクル・no-priceパス不変・throwパス維持を確認）
  - 見送り3件（#58 飛行中PATCHのstate反映 / #59 scrape_error内部文言 / refreshのゴミ箱アイテム可）は discovery メモに記録
  - マージ順: #58 → #59（squash、コンフリクトなし）。統合ビルド: origin/develop (919d849) で npm install → tsc → next build すべて pass
  - 残オープンPR: Dependabot #31（base=main、引き続き人間判断推奨）
- 2026-06-12 (周回15後、人間指示): 溜まった8本（#47〜#54）を Codex CLI でレビュー → 対応 → develop へ全てマージ。
  - Codex指摘: BLOCKER 2件（#47 check-pricesがgetDb()未経由でマイグレーション未実行DBにてUPDATE失敗 / #54 purchased_count・totalの論理削除除外漏れ）、SHOULD 2件（#51 削除のトランザクション化 / #53 Y軸下限が負）→ 4件とも各ブランチに追加コミットで修正、tester実行検証pass（#47は失敗の実在を対比実証、#51はロールバック確認）
  - LGTM: #48, #49, #50, #52。#47のprice:0失敗扱いSHOULDは既存仕様と整合のためfollow-up（discoveryメモ）
  - マージ順: #50→#51→#52→#54→#49→#48→#47→#53（全squash、コンフリクトなし）
  - 統合ビルド: マージ後 origin/develop で npm install → tsc → next build すべて pass
  - 残オープンPR: Dependabot #31（base=main。developとの分岐があるため別途判断推奨）
- 2026-06-11 (周回7後): 人間の指示で溜まったマージ候補6本を Codex CLI でレビュー → 対応 → develop へマージ。
  - Codex レビュー結果: BLOCKER ゼロ。#44/#45/#39 は完全LGTM、#43は最適化SHOULD2件、#40/#41はスクレイパーSHOULD計5件
  - 対応: コア機能(#13)の信頼性に直結する3件（fetchWithRetryのper-attemptタイムアウト、body破棄、恒久4xxでPuppeteerスキップ）を #41 ブランチに追加実装し tester 検証 pass
  - マージ済み: #39, #44, #45, #43, #40, #41（全て squash、develop）。スタックの#41はsquash後コンフリクトしたため develop をマージして解決（#41側=#40内包の優越で欠落なし）
  - 統合ビルド: tsc/next build とも pass（6PR統合後の develop で確認）
  - 残った非ブロッカー指摘（#43 CTE化/履歴インデックス、#41 価格なし商品のPuppeteer抑制、engines明示 等）は follow-up Issue #46 に集約
  - 結果: develop は origin にマージ反映済み（main への昇格は未実施＝人間判断）。looper/state.md は引き続きローカルのみ

## 終了ログ
- 2026-06-12 周回20: 周回上限（20）到達のためループ終了。backlog 残5件、blocked 0件。レビュー待ちオープンPR: #58, #59（マージは人間判断、常設指示によりCodexレビュー→マージをループに依頼可）。
- 2026-06-11 周回0: push 権限不足のためループ終了（人間の介入待ち）。develop ブランチはローカルに作成済み・未push。
- 2026-06-11 周回1: push 権限解消を確認、blocked を解除。リモート develop を main (31986a7) から初期化。
