# 物欲王 (Butuyokuoh)

複数のECサイトのほしいものリストを一元管理するWebアプリ

## ✨ 主な機能

### 📌 アイテム管理
- **URL登録**: Amazon、楽天、その他ECサイトのURLから自動で商品情報を取得
- **手動登録**: 画像アップロード対応
- **優先度管理**: 最高/高/普通/低/最低の5段階
- **カテゴリ分類**: 自由にカテゴリを作成・色分け
- **比較グループ**: 似た商品をグループ化して比較
- **購入予定日**: いつ買うか計画
- **個数管理**: 複数個購入の合計金額を自動計算

### 📈 価格トラッキング
- **価格履歴グラフ**: Keepa風の価格変動表示
- **目標価格設定**: 希望価格を設定（JPY/USD対応）
- **価格下落通知**: Discord/Slack Webhookで通知
- **定期価格チェック**: 6時間ごとに自動更新（JST 0:00, 6:00, 12:00, 18:00）

### 📥 インポート/エクスポート
- **ほしいものリストインポート**: Amazon・楽天のリストを一括インポート
- **Chrome拡張機能**: 非公開リストも対応、商品ページから直接追加
- **CSVエクスポート**: Excel対応（BOM付きUTF-8）

### 📊 分析・管理
- **統計ダッシュボード**: カテゴリ別/優先度別/サイト別/価格帯分析
- **出費予定**: 月別の購入予定金額を計算
- **購入済み履歴**: 購入したアイテムの記録
- **ゴミ箱**: 削除アイテムの復元（設定ページ）
- **検索・フィルター**: 商品名、メモ、カテゴリ、比較グループで絞り込み

### 🎨 UI/UX
- **ダークモード**: システム設定連動 / 手動切り替え
- **ドラッグ＆ドロップ**: 同一優先度内での並び替え
- **一括操作**: 複数アイテムの選択・削除・優先度変更
- **モバイル対応**: スワイプでタブ切り替え、コンパクト表示

### 🔐 認証
- **メール/パスワード認証**
- **Google SSO**: Googleアカウントでログイン

### 📱 PWA対応
- スマホのホーム画面に追加可能
- オフラインでも起動可能

---

## 🚀 セットアップ

### サーバー起動

```bash
# 依存インストール
npm install

# データベースディレクトリ作成
mkdir -p data

# 開発サーバー（ホットリロード）
npm run dev

# 本番用ビルド
npm run build

# 本番起動
npm run start
```

デフォルトで `http://localhost:8000` で起動します。

### 環境変数（オプション）

`.env.local` を作成:

```env
# NextAuth（Google SSO用）
AUTH_SECRET=your-secret-key
NEXTAUTH_URL=https://your-domain.com
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

---

## 🧩 Chrome拡張機能

商品ページから直接追加、非公開ほしいものリストのインポートに対応。

### 対応ブラウザ

| ブラウザ | 対応 | 拡張機能ページ |
|---------|:----:|---------------|
| Google Chrome | ✅ | `chrome://extensions/` |
| Microsoft Edge | ✅ | `edge://extensions/` |
| Brave | ✅ | `brave://extensions/` |
| Vivaldi | ✅ | `vivaldi://extensions/` |
| Opera | ✅ | `opera://extensions/` |
| Arc | ✅ | `arc://extensions/` |
| Firefox | ❌ | 非対応 |
| Safari | ❌ | 非対応 |

### インストール

1. `extension` フォルダを用意（または `public/butuyokuoh-extension.zip` を解凍）
2. ブラウザの拡張機能ページを開く
3. 「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」→ `extension` フォルダを選択

### 初期設定

1. 物欲王にログイン → 「設定」ページで認証トークンをコピー
2. 拡張機能アイコン（👑）をクリック → 「設定」を開く
3. サーバーURLとトークンを入力して保存

### 使い方

#### 商品ページから追加

1. Amazon/楽天の商品ページを開く
2. 拡張機能アイコン（👑）をクリック
3. 優先度（最高/高/普通/低/最低）とカテゴリを選択
4. 「物欲王に追加」をクリック

#### ほしいものリストをインポート

1. Amazon/楽天にログイン
2. ほしいものリストページを開く
   - Amazon: `https://www.amazon.co.jp/hz/wishlist/ls/XXXXX`
   - 楽天: `https://my.bookmark.rakuten.co.jp/...`
3. 拡張機能アイコン（👑）をクリック
4. 「インポート」をクリック

---

## 📖 使い方

### アカウント作成

1. トップページにアクセス
2. 「新規登録」タブを選択
3. メールアドレスとパスワード（6文字以上）を入力
4. 「アカウント作成」をクリック

※ Google SSOを設定済みの場合は「Googleでログイン」も使用可能

### 商品を追加

#### URLから追加
1. 「+ 新しいアイテムを追加」をクリック
2. 商品URLを貼り付け
3. 優先度、購入予定日、カテゴリ等を設定
4. 「追加」ボタン

#### 手動で追加
1. 「手動で追加」リンクをクリック
2. 商品名、価格、画像等を入力

### 価格通知の設定

1. 「設定」ページを開く
2. Discord/Slack Webhook URLを入力
3. 「価格下落時に通知」「目標価格到達時に通知」をON
4. 保存

各アイテムの編集画面で「目標価格」を設定すると、その価格以下になった時に通知されます。

---

## 🛠 技術スタック

- **フレームワーク**: Next.js 16 (App Router)
- **言語**: TypeScript
- **データベース**: SQLite (better-sqlite3)
- **スタイル**: Tailwind CSS
- **グラフ**: Recharts
- **認証**: NextAuth.js v5
- **PWA**: next-pwa

---

## 📁 ディレクトリ構成

```
butuyokuoh/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # APIエンドポイント
│   │   │   ├── auth/           # 認証 (register, login, logout, [...nextauth])
│   │   │   ├── items/          # アイテムCRUD, 価格履歴
│   │   │   ├── categories/     # カテゴリ管理
│   │   │   ├── comparison-groups/  # 比較グループ
│   │   │   ├── budget/         # 予算計算
│   │   │   ├── purchased/      # 購入済み
│   │   │   ├── trash/          # ゴミ箱
│   │   │   ├── stats/          # 統計
│   │   │   ├── export/         # CSVエクスポート
│   │   │   ├── notification-settings/  # 通知設定
│   │   │   ├── extension-add/  # 拡張機能: 商品追加
│   │   │   ├── extension-import/  # 拡張機能: インポート
│   │   │   └── extension-categories/  # 拡張機能: カテゴリ取得
│   │   ├── settings/           # 設定ページ
│   │   ├── page.tsx            # メインページ
│   │   └── layout.tsx
│   ├── components/             # Reactコンポーネント
│   │   ├── ItemCard.tsx        # アイテムカード
│   │   ├── AddItemForm.tsx     # アイテム追加フォーム
│   │   ├── BudgetView.tsx      # 出費予定
│   │   ├── StatsView.tsx       # 統計ダッシュボード
│   │   ├── PurchasedHistory.tsx  # 購入履歴
│   │   ├── TrashView.tsx       # ゴミ箱
│   │   ├── LoginForm.tsx       # ログインフォーム
│   │   └── AuthProvider.tsx    # 認証プロバイダ
│   ├── lib/                    # ユーティリティ
│   │   ├── db.ts               # データベース
│   │   ├── auth.ts             # 認証ヘルパー
│   │   ├── scraper.ts          # 商品スクレイピング
│   │   ├── wishlist-scraper.ts # リストスクレイピング
│   │   └── notifier.ts         # 通知送信
│   └── types/                  # TypeScript型定義
├── extension/                  # Chrome拡張機能
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── content-amazon.js       # Amazon リストページ
│   ├── content-amazon-product.js  # Amazon 商品ページ
│   ├── content-rakuten.js      # 楽天 リストページ
│   └── content-rakuten-product.js # 楽天 商品ページ
├── scripts/
│   └── check-prices.ts         # 定期価格チェック
├── data/                       # SQLiteデータベース
├── public/
│   ├── manifest.json           # PWAマニフェスト
│   └── butuyokuoh-extension.zip  # 拡張機能配布用
└── docs/                       # ドキュメント
```

---

## 📋 TODO

- [x] 価格下落通知 (Discord/Slack Webhook)
- [x] 定期価格チェック (6時間ごと自動実行)
- [x] ユーザー認証（メール/パスワード、Google SSO）
- [x] エクスポート機能 (CSV)
- [x] PWA対応
- [x] 統計ダッシュボード
- [x] ゴミ箱機能
- [x] 検索・ソート・フィルター（折りたたみ式）
- [x] Chrome拡張機能から商品ページ直接追加
- [x] ダークモード
- [x] ドラッグ＆ドロップ（同一優先度内）
- [x] 一括操作（選択モード）
- [x] モバイルスワイプ対応
- [ ] LINE/Discord SSO
- [ ] 複数通貨対応強化
- [ ] 共有リスト機能

---

## 📄 ライセンス

MIT
