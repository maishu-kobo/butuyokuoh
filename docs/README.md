# 物欲王 (Butuyokuoh) ドキュメント

物欲王のテクニカルドキュメントです。

## ドキュメント一覧

| ドキュメント | 説明 |
|-------------|------|
| [データベース設計](./database.md) | テーブル定義、ER図、インデックス |
| [機能一覧](./features.md) | 実装済み機能の詳細 |
| [写真から登録](./capture.md) | 写真から商品を追加する使い方、設定、上限 |
| [写真判定（AI）](./capture-ai.md) | 写真判定のモデル、検索、評価の範囲 |
| [デプロイ](./deployment.md) | mainからの自動配備、結果確認・再試行・停止・復旧の手順 |
| [ゲストモード](./guest-mode.md) | ゲストの有効化、期限、清掃 |
| [開発ガイド](./development.md) | ローカル開発環境のセットアップ |
| [CI](./ci.md) | 速いレーン、重いレーン、フレークしたテストの隔離 |

経緯・進捗は PR の説明へ。利用者に見える変更は `CHANGELOG.md`。耐久する設計判断だけを上の仕様ファイルへ書く。

## クイックリンク

- **GitHub**: https://github.com/maishu-kobo/butuyokuoh
- **技術スタック**: Next.js 16 + TypeScript + SQLite + Tailwind CSS
