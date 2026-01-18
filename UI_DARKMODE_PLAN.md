# ダークモード対応計画

## 概要
- Tailwind CSSのdarkMode機能を使用
- システム設定に連動 + 手動切り替えオプション
- localStorageで設定を保存

## 実装ステップ

### Step 1: Tailwind設定
- [ ] `tailwind.config.ts` に `darkMode: 'class'` を追加

### Step 2: テーマプロバイダー作成
- [ ] `src/components/ThemeProvider.tsx` を作成
  - テーマ状態管理 (light/dark/system)
  - localStorageで永続化
  - html要素に dark クラスを付与

### Step 3: レイアウトに適用
- [ ] `src/app/layout.tsx` にThemeProviderを追加

### Step 4: 各コンポーネントに dark: クラス追加
- [ ] `src/app/page.tsx` - メインページ
- [ ] `src/app/settings/page.tsx` - 設定ページ
- [ ] `src/components/ItemCard.tsx` - アイテムカード
- [ ] `src/components/LoginForm.tsx` - ログインフォーム
- [ ] `src/components/AddItemForm.tsx` - アイテム追加フォーム
- [ ] `src/components/BudgetView.tsx` - 出費予定
- [ ] `src/components/PurchasedHistory.tsx` - 購入済み
- [ ] `src/components/StatsView.tsx` - 統計
- [ ] `src/components/PriceChart.tsx` - 価格チャート
- [ ] `src/components/ImportWishlistModal.tsx` - インポートモーダル

### Step 5: テーマ切り替えUI追加
- [ ] 設定ページにテーマ切り替えセクション追加

## カラーパレット

### ライトモード（現在）
- 背景: slate-50, white
- テキスト: slate-900, slate-700, slate-500
- アクセント: orange-500, amber-500

### ダークモード
- 背景: slate-900, slate-800
- テキスト: slate-100, slate-300, slate-400
- アクセント: orange-400, amber-400
- カード: slate-800
- ボーダー: slate-700
