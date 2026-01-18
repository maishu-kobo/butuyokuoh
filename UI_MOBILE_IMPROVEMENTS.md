# モバイルUI改善計画

## 対象画面
- メインページ（リストタブ）
- タブナビゲーション

## 改善項目

### 1. タブの文字折り返し問題 ✅ 完了
- **現状**: タブ内の文字が不自然な位置で改行される（例：「購入」と「済」が縦に並ぶ）
- **改善**: `whitespace-nowrap` で折り返しを防止
- **ファイル**: `src/app/page.tsx`

### 2. カテゴリ数カードの削除 ✅ 完了
- **現状**: PCサイズでは3カラム目に「カテゴリ数」が表示、スマホでは非表示
- **改善**: カテゴリ数カードを完全に削除（PC/スマホ両方）
- **ファイル**: `src/app/page.tsx`

### 3. タブの横スクロール対応 ✅ 完了
- **現状**: タブが折り返されて表示される
- **改善**: タブエリアを横スクロール可能にする（`overflow-x-auto`）
- **ファイル**: `src/app/page.tsx`

### 4. サマリーカードのコンパクト化 ✅ 完了
- **現状**: アイテム数と合計金額のパネルが大きい
- **改善**: パディングと文字サイズを縮小（p-4 → px-4 py-2.5, text-2xl → text-xl）
- **ファイル**: `src/app/page.tsx`

## 実装内容

### タブナビゲーション
```tsx
// Before
<nav className="flex gap-2">
  <button className="flex items-center gap-2 px-4 py-2 ...">

// After
<nav className="flex gap-1.5 overflow-x-auto scrollbar-hide">
  <button className="flex items-center gap-1.5 px-3 py-2 ... whitespace-nowrap">
```

### サマリーカード
```tsx
// Before
<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
  <div className="bg-white rounded-2xl shadow-sm p-4">
    <p className="text-2xl font-bold ...">
  </div>
  // ... カテゴリカード（hidden sm:block）
</div>

// After
<div className="flex gap-3">
  <div className="flex-1 bg-white rounded-xl shadow-sm px-4 py-2.5">
    <p className="text-xl font-bold ...">
  </div>
  // カテゴリカード削除
</div>
```

## テスト結果

- [x] スマホサイズ (375x667): タブが横スクロール可能、文字折り返しなし
- [x] PCサイズ (1280x800): タブが横一列に表示、サマリーカードが2カラム
