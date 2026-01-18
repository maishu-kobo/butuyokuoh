# UI改善TODOリスト

## 優先度高

### 1. アイテムカードの「other」ラベル問題 ✅ 完了
- **現状**: ソースが不明な場合に「other」と英語で表示
- **改善**: 「その他」に変更
- **ファイル**: `src/components/ItemCard.tsx`
- **難易度**: ★☆☆☆☆（簡単）
- [x] 実装

### 2. 比較グループ内での最安表示 ✅ 完了
- **現状**: フィルター後に並べて見るだけ
- **改善**: 比較グループフィルター適用時、最安価格のアイテムに🏷️最安バッジを表示
- **ファイル**: `src/app/page.tsx`, `src/components/ItemCard.tsx`
- **難易度**: ★★☆☆☆（普通）
- **実装内容**:
  - page.tsx: lowestPriceInGroupを計算
  - ItemCard: isLowestPrice propを追加
  - 最安の場合に価格が緑色 + 🏷️最安バッジ
- [x] 実装

### 3. 価格変動の視覚化 ✅ 完了
- **現状**: 価格推移グラフはあるが、リストビューで変動が見えない
- **改善**: 前回比で↑↓アイコン＋変動額を表示
- **ファイル**: `src/app/api/items/route.ts`, `src/types/index.ts`, `src/components/ItemCard.tsx`
- **難易度**: ★★☆☆☆（普通）
- **実装内容**:
  - API: price_historyからprevious_priceを取得するSQL追加
  - Item型: previous_price フィールド追加
  - ItemCard: previous_priceを優先的に使用して差分表示
- [x] 実装

## 優先度中

### 6. ドラッグ&ドロップで優先度変更
- **現状**: 編集画面から優先度を変更
- **改善**: リスト上でドラッグして並び替え
- **ファイル**: `src/app/page.tsx`, `src/components/ItemCard.tsx`
- **難易度**: ★★★☆☆（やや難）
- **実装方針**:
  - react-beautiful-dnd または @dnd-kit/core を使用
  - ドロップ時にAPIで優先度を更新
  - ソートが「優先度順」の時のみ有効
- [ ] 実装

### 7. 一括操作
- **現状**: 1件ずつ操作
- **改善**: チェックボックスで複数選択→一括削除/カテゴリ変更/グループ追加
- **ファイル**: `src/app/page.tsx`, `src/components/ItemCard.tsx`, 新規API
- **難易度**: ★★★☆☆（やや難）
- **実装方針**:
  - 選択モードのUIを追加
  - selectedItems stateを管理
  - 一括操作用のAPIエンドポイントを作成（または既存APIをループ）
  - 一括操作バーを表示
- [ ] 実装

### 8. ダークモード対応 ✅ 完了
- **現状**: ライトモードのみ
- **改善**: システム設定に連動、または手動切り替え
- **実装内容**:
  - Tailwind 4: globals.cssに@custom-variantでdarkモード設定
  - ThemeProvider: テーマ状態管理 (light/dark/system)、localStorage保存
  - 全コンポーネントに dark: クラスを追加
  - 設定ページにテーマ切り替えUI追加
- [x] 実装

## 実装順序（提案）

1. 「other」ラベル問題（簡単、すぐできる）
2. 比較グループ最安表示（比較グループフィルターとセットで使う）
3. 価格変動表示（データ構造確認が必要）
4. ダークモード（大きめの変更）
5. ドラッグ&ドロップ（ライブラリ追加）
6. 一括操作（UI設計が必要）
