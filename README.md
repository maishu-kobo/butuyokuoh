# 物欲王 (Butuyokuoh)

複数のECサイトのほしいものリストを一元管理するアプリ

## 機能

- 📌 **アイテム登録**: Amazon、楽天、その他ECサイトのURLを登録
- 🔍 **自動スクレイピング**: 商品名、価格、画像を自動取得
- ⭐ **優先度管理**: 1-5の優先度を設定
- 📅 **購入予定日**: いつ買うか計画
- 📈 **価格履歴**: Keepa風の価格変動グラフ
- 💰 **予算計算**: 月ごとの合計出費を計算
- 🔄 **比較グループ**: 似た商品をグループ化して比較

## 技術スタック

- Next.js 16 (App Router)
- TypeScript
- SQLite (better-sqlite3)
- Tailwind CSS
- Recharts

## セットアップ

```bash
# 依存インストール
npm install

# 開発サーバー
npm run dev

# ビルド
npm run build

# 本番起動
npm run start
```

## TODO

- [ ] 価格下落通知 (Slack/メール)
- [ ] 定期価格チェック (cron)
- [ ] ユーザー認証
- [ ] インポート/エクスポート
