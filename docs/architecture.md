# アーキテクチャ

## システム構成図

```
┌─────────────────┐     ┌─────────────────┐
│   Browser      │     │ Chrome拡張    │
│  (PWA対応)     │     │  (import)    │
└────────┬────────┘     └────────┬────────┘
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌────────────────────────┐
         │   exe.dev HTTPS Proxy   │
         │  (butsuyokuoh.exe.xyz)  │
         └────────────┬───────────┘
                    │
                    ▼
         ┌────────────────────────┐
         │      Next.js App        │
         │   (localhost:8000)      │
         ├────────────────────────┤
         │  - React (Frontend)     │
         │  - API Routes (Backend) │
         │  - NextAuth.js (認証)   │
         └────────────┬───────────┘
                    │
         ┌──────────┴───────────┐
         │                        │
         ▼                        ▼
┌────────────────┐    ┌────────────────┐
│    SQLite      │    │   Puppeteer    │
│ (data/*.db)    │    │  (scraping)    │
└────────────────┘    └────────────────┘
                              │
                              ▼
                    ┌────────────────┐
                    │  ECサイト群     │
                    │ (Amazon,楽天...) │
                    └────────────────┘

┌─────────────────────────────────────────┐
│          定期実行 (systemd timer)          │
├─────────────────────────────────────────┤
│  check-prices.ts                           │
│  - 6時間ごとに全アイテムの価格をチェック       │
│  - 価格変動時にSlack/Discord通知           │
└─────────────────────────────────────────┘
```

## 技術スタック

### フロントエンド

| 技術 | バージョン | 用途 |
|------|----------|------|
| React | 19.x | UIコンポーネント |
| Next.js | 16.x | フレームワーク (App Router) |
| TypeScript | 5.x | 型安全性 |
| Tailwind CSS | 3.x | スタイリング |
| Recharts | - | 価格グラフ |
| Lucide React | - | アイコン |

### バックエンド

| 技術 | 用途 |
|------|------|
| Next.js API Routes | REST API |
| NextAuth.js | 認証 (Email/Google OAuth) |
| better-sqlite3 | データベース |
| Puppeteer | Webスクレイピング |
| bcryptjs | パスワードハッシュ |
| jsonwebtoken | JWTトークン |

### インフラ

| 技術 | 用途 |
|------|------|
| exe.dev | ホスティングプラットフォーム |
| systemd | プロセス管理・定期実行 |
| SQLite | ファイルベースDB |

## ディレクトリ構造

```
butuyokuoh/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # APIエンドポイント
│   │   │   ├── auth/           # 認証関連
│   │   │   ├── items/          # アイテムCRUD
│   │   │   ├── categories/     # カテゴリ管理
│   │   │   ├── budget/         # 出費予定
│   │   │   ├── stats/          # 統計
│   │   │   ├── export/         # CSVエクスポート
│   │   │   ├── upload/         # 画像アップロード
│   │   │   └── ...             # その他
│   │   ├── settings/           # 設定ページ
│   │   ├── page.tsx            # メインページ
│   │   ├── layout.tsx          # ルートレイアウト
│   │   └── globals.css         # グローバルCSS
│   ├── components/             # Reactコンポーネント
│   │   ├── ItemCard.tsx        # アイテムカード
│   │   ├── AddItemForm.tsx     # アイテム追加フォーム
│   │   ├── BudgetView.tsx      # 出費予定ビュー
│   │   ├── StatsView.tsx       # 統計ダッシュボード
│   │   ├── PriceChart.tsx      # 価格グラフ
│   │   ├── LoginForm.tsx       # ログインフォーム
│   │   └── ...                 # その他
│   ├── lib/                    # ユーティリティ
│   │   ├── db.ts               # DB接続
│   │   ├── auth.ts             # 認証ヘルパー
│   │   ├── scraper.ts          # 商品スクレイピング
│   │   ├── wishlist-scraper.ts # リストスクレイピング
│   │   └── notifier.ts         # 通知送信
│   ├── types/                  # TypeScript型定義
│   │   └── index.ts
│   └── auth.ts                 # NextAuth設定
├── scripts/
│   └── check-prices.ts         # 定期価格チェック
├── extension/                  # Chrome拡張機能
│   ├── manifest.json
│   ├── popup.html/js
│   ├── content-amazon.js
│   └── content-rakuten.js
├── public/
│   ├── manifest.json           # PWAマニフェスト
│   ├── icons/                  # PWAアイコン
│   └── uploads/                # アップロード画像
├── data/
│   └── butuyokuoh.db           # SQLiteデータベース
├── docs/                       # ドキュメント
├── butuyokuoh.service          # systemdサービス
├── butuyokuoh-price-check.service  # 価格チェックサービス
├── butuyokuoh-price-check.timer    # 定期実行タイマー
├── package.json
├── tsconfig.json
├── next.config.ts
└── .env.local                  # 環境変数（非公開）
```

## データフロー

### アイテム登録フロー

```
1. ユーザーがURLを入力
2. APIがPuppeteerでスクレイピング
3. 商品情報（名前、価格、画像）を取得
4. itemsテーブルにINSERT
5. price_historyテーブルに初回価格を記録
6. フロントに返却・表示
```

### 価格チェックフロー

```
1. systemd timerが6時間ごとに起動
2. check-prices.tsが全アイテムを取得
3. 各アイテムのURLをスクレイピング
4. 価格変動があれば:
   - items.current_priceを更新
   - price_historyに記録
   - 価格下落なら通知送信
```

## セキュリティ考慮事項

- ユーザーデータは完全に分離（user_idでフィルタリング）
- パスワードはbcryptでハッシュ化
- JWTトークンは7日間有効
- HTTPSはexe.devプロキシで終端
- アップロードファイルはタイプ・サイズ制限あり

## スケーラビリティ

現在の構成は小規模（単一ユーザー～数十ユーザー）向け。

大規模化には以下の変更が必要:

1. **データベース**: SQLite → PostgreSQL/MySQL
2. **スクレイピング**: キューシステム（Redis + Bull）導入
3. **ファイルストレージ**: ローカル → S3/GCS
4. **ホスティング**: コンテナ化 (Docker) + オーケストレーション
