# Loop State

- 周回: 27
- 周回上限: 40（2026-06-12 人間が /loop 再実行でループ再開。再開時20 + デフォルト20周回分）
- discovery 連続空振り: 0（最終discovery: 周回27、採用5件）
- 常設指示（2026-06-12 人間より）: 溜まったマージ候補PRは Codex レビュー → 指摘対応 → マージまでループが実施してよい

## backlog
<!-- 書式: - [ ] タイトル | 受け入れ条件: 検証可能な条件 | origin: human|auto | fix: 0 -->
<!-- 周回11 discovery 採用5件 -->
<!-- 周回16 discovery 採用5件 -->
<!-- 周回22 discovery 採用5件 -->
- [ ] 論理削除除外漏れの一掃（purchased / export / categories item_count） | 受け入れ条件: 購入済みアイテムの論理削除後 GET /api/purchased の items/monthlySummary/totalStats に含まれない。GET /api/export の CSV にゴミ箱アイテムが含まれない。GET /api/categories の item_count がゴミ箱除外（復元で +1 に戻る） | origin: auto | fix: 0
- [ ] 一覧/予算/ゴミ箱の取得失敗時エラー表示と再試行（無限読み込み解消） | 受け入れ条件: /api/items・/api/budget・/api/trash の取得が !res.ok または例外のとき「読み込みに失敗しました」+「再試行」ボタンを表示し、再試行で復帰。非配列レスポンスで .map/.filter クラッシュしない。tsc pass | origin: auto | fix: 0
- [ ] items POST/PATCH/extension-add の category_id/comparison_group_id 所有権検証 | 受け入れ条件: 他ユーザー所有IDまたは存在しないIDを指定した POST/PATCH/extension-add が 400 または 404。自分所有IDは従来どおり成功。null 指定（解除）は引き続き許可 | origin: auto | fix: 0
<!-- 周回27 discovery 採用5件 -->
- [ ] SSRF ブロックリスト強化 + vitest テスト基盤導入 | 受け入れ条件: 共通ヘルパーを url-validator に追加し sanitizeGenericUrl と scrapeGeneric の両ガードが使用。169.254.0.0/16・127.0.0.0/8 全域・0.0.0.0・172.16.0.0/12 全域・[::1]・fe80::/fc00:: 系がすべて拒否され、通常の公開 https URL は許可。vitest が devDependencies に入り npm test で url-validator テスト（許可/拒否 各5ケース以上）が通る | origin: auto | fix: 0
- [ ] ハード削除経路の price_history/notification_settings 孤児化解消 | 受け入れ条件: trash/[id] DELETE・trash DELETE（全削除）・7日自動パージの全経路をトランザクション化し子レコードも削除。migrateDb に既存孤児クリーンアップ追加。完全削除後に該当 item_id の子レコード0件、起動後に既存孤児0件 | origin: auto | fix: 0
- [ ] 購入日が UTC 基準で前日にずれる問題の修正 | 受け入れ条件: 単品（ItemCard）・一括（page.tsx）の購入済み化で、端末ローカルTZの「今日」が記録される（JST 0:00〜8:59 でも当日日付）。購入済みタブの月別集計に正しく反映 | origin: auto | fix: 0
- [ ] URL 重複時の未捕捉 UNIQUE 500 の一掃（items POST 手動/URL・PATCH・extension-add） | 受け入れ条件: 4経路すべてで重複 URL が 409+明確なメッセージ（ゴミ箱内重複は復元/完全削除を案内する文言）。手動モード重複でも500にならない。新規URL登録・URL以外のPATCHは挙動不変 | origin: auto | fix: 0
- [ ] items POST（URL追加）で scrape_status/last_scraped_at を記録 (#33完結) | 受け入れ条件: URLモードの INSERT に deriveScrapeOutcome 由来の last_scraped_at/scrape_status/scrape_error を含める。価格取得失敗URLで登録直後に scrape_status='failed' が GET /api/items に現れる。手動追加モードは NULL のまま | origin: auto | fix: 0

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
- categories の item_count に deleted_at IS NULL 除外が漏れている（categories/route.ts:15 は is_purchased=0 のみ。ゴミ箱内未購入アイテムが計上される。PR #60 の coder/tester が独立に発見。comparison-groups と同じ1行修正）→ 周回22 discovery で「論理削除除外漏れの一掃」として backlog 採用済み
<!-- 周回22 discovery で採用枠から漏れた候補 -->
- PRAGMA foreign_keys 無効のためハード削除で price_history / notification_settings が孤児化（個別削除・7日自動パージ・全削除の各経路で明示 DELETE + トランザクション推奨。グローバル foreign_keys=ON は既存不整合データのリスクあり。既存孤児行のクリーンアップも）
- sanitizeGenericUrl の SSRF ブロックリスト強化 + vitest テスト基盤導入（169.254.169.254、172.17-31.x、0.0.0.0、IPv6、100.64/10 が素通し。url-validator.test.ts 最低10ケース付き）
- ゴミ箱内URL重複の衝突処理を items POST / extension-add で統一（POST は不正確なメッセージ、extension-add は UNIQUE 違反で500。判別可能な409+案内文言 or 自動復元）
- 削除直後/購入済み直後の Undo トースト（復元API・PATCH は既存。キーボード操作対応含む）
- 「全て更新」の進捗表示（i/n件カウンタ + 完了サマリ + 並列数上限）
- 選択モード中にタブ切り替えると一括操作バーが他タブに残留（page.tsx:714-774 が activeTab 非参照。誤一括削除リスク）
- ImportWishlistModal の楽天URL判定が緩く商品ページでも「有効」表示（ImportWishlistModal.tsx:46-49。import-wishlist 側の対応パターンと整合させる）
- ItemCard handleRefreshWithNewUrl は定義のみで JSX から未配線（URL変更しても価格再取得されない。配線 or 削除。失敗ハンドリング欠如も同時に解消）
<!-- 周回27 discovery で採用枠から漏れた候補 -->
- 購入済み/統計タブの取得失敗で無限読み込み・StatsView は非okレスポンスで TypeError クラッシュの恐れ（PurchasedHistory.tsx:26-31、StatsView.tsx:38-46。backlog の一覧/予算/ゴミ箱版と同方針で展開）
- refresh に加え PATCH もゴミ箱内アイテムに実行可能（items/[id]/route.ts:38 も deleted_at 条件なし。両方まとめて404に）
- 購入済み化の際に購入日を選択できる UI（後日まとめて記録のユースケース。UTCずれ修正は採用済み、こちらは任意日付入力）
- upload の file.name パストラバーサルは解消済みと判断（拡張子のみ使用・サーバ生成ファイル名。周回27 reviewer 確認）

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
- [x] comparison-groups の item_count が論理削除/購入済みアイテムを含む | PR: #60（1行変更、tester がテストDBで 3→2→1 の減少と LEFT JOIN 維持を動的検証、全項目 pass） | 周回: 21
- [x] BudgetView で価格未取得アイテムが合計に黙って除外される点を明示 | PR: #61（フロントのみ20行追加、全体/月/時期未定の3箇所に注記、tester が実データ突き合わせで全項目 pass） | 周回: 22
- [x] notifier の webhook fetch にタイムアウト追加 | PR: #62（AbortSignal.timeout(10s)+TimeoutError/AbortError判定。tester がDNS差し替え+無応答サーバで実測10.0秒false返却を確認、全項目 pass） | 周回: 23
- [x] register/login のメール正規化と形式検証 | PR: #63（lib/email.ts新規+LOWER(email)比較で既存大文字行も互換。tester がcurlで20パターン超実機確認、全項目 pass） | 周回: 24
- [x] 検索/フィルタ0件時の空状態メッセージと条件クリア | PR: #64（page.tsx 21行追加、5フィルタ全リセット確認。tester がロジック写経ミニテスト18件で全項目 pass） | 周回: 25
- [x] ゴミ箱を空にする機能の DELETE /api/trash 実装 | PR: #65（+19行。tester がcurl+sqlite3で件数返却/401/他ユーザー非削除を実機確認、全項目 pass。初回tester はセッション上限で中断→再検証） | 周回: 26
- [x] check-prices の価格不変時は price_history に INSERT しない | PR: #66（直近履歴比較+id DESCタイブレーク。tester がモック5回実行×3アイテムで同値スキップ/変動INSERT/記録系維持/独立性を動的検証、全項目 pass） | 周回: 27

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
