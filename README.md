# 物欲王 (Butuyokuoh)

複数のECサイトのほしいものリストを一元管理するアプリ

## 機能

- 📌 **アイテム登録**: Amazon、楽天、その他ECサイトのURLを登録
- 🔍 **自動スクレイピング**: 商品名、価格、画像を自動取得
- 📥 **ほしいものリストインポート**: Amazon・楽天のリストを一括インポート
- ⭐ **優先度管理**: 1-5の優先度を設定
- 📅 **購入予定日**: いつ買うか計画
- 📈 **価格履歴**: Keepa風の価格変動グラフ
- 💰 **予算計算**: 月ごとの合計出費を計算
- 🔄 **比較グループ**: 似た商品をグループ化して比較

## セットアップ

### サーバー

```bash
# 依存インストール
npm install

# データベースディレクトリ作成
mkdir -p data

# 開発サーバー
npm run dev

# ビルド
npm run build

# 本番起動
npm run start
```

デフォルトでは `http://localhost:8000` で起動します。

### Chrome拡張機能

Amazonや楽天にログインした状態でほしいものリストをインポートできます。

#### インストール方法

1. Chromeで `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `extension` フォルダを選択

#### 使い方

1. Amazonまたは楽天にログイン
2. ほしいものリストページを開く
   - Amazon: `https://www.amazon.co.jp/hz/wishlist/ls/XXXXX`
   - 楽天: `https://my.bookmark.rakuten.co.jp/...`
3. 拡張機能アイコン（👑）をクリック
4. サーバーURLを確認・設定
5. 「インポート」をクリック

## 使い方

### 商品を個別に追加

1. 「新しいアイテムを追加」をクリック
2. ECサイトの商品URLを貼り付け
3. 優先度や購入予定日を設定
4. 「追加」ボタンで登録

### ほしいものリストをインポート（Web版）

1. 「インポート」ボタンをクリック
2. ほしいものリストのURLを貼り付け
3. 「インポート」をクリック

※ Web版は公開設定のリストのみ対応。非公開リストはChrome拡張機能を使用してください。

### 価格更新

- 各アイテムの更新ボタンで個別に更新
- 「全て更新」で全アイテムを一括更新

### 予算管理

1. 「予算」タブをクリック
2. 購入予定日が設定されたアイテムの月別合計が表示されます

### 比較グループ

似た商品をグループ化して比較できます。

1. 「比較」タブでグループを作成
2. アイテム追加時にグループを選択

## 技術スタック

- Next.js 16 (App Router)
- TypeScript
- SQLite (better-sqlite3)
- Tailwind CSS
- Recharts
- Puppeteer (スクレイピング用)

## ディレクトリ構成

```
butuyokuoh/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── api/          # APIエンドポイント
│   │   ├── page.tsx      # メインページ
│   │   └── layout.tsx
│   ├── components/       # Reactコンポーネント
│   ├── lib/              # ユーティリティ
│   │   ├── db.ts         # データベース
│   │   ├── scraper.ts    # 商品スクレイピング
│   │   └── wishlist-scraper.ts  # リストスクレイピング
│   └── types/            # TypeScript型定義
├── extension/            # Chrome拡張機能
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── content-amazon.js
│   └── content-rakuten.js
├── data/                 # SQLiteデータベース
└── public/
```

## TODO

- [ ] 価格下落通知 (Slack/メール)
- [ ] 定期価格チェック (cron)
- [ ] ユーザー認証
- [ ] エクスポート機能

## ライセンス

MIT
