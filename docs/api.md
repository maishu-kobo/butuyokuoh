# API仕様

## 概要

- **ベースURL**: `https://butsuyokuoh.exe.xyz:8000/api`
- **認証**: CookieベースのセッションまたはBearerトークン
- **レスポンス形式**: JSON

## 認証

### POST /api/auth/register

新規アカウント作成。

**リクエスト**:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "表示名"
}
```

**レスポンス**:
```json
{
  "user": { "id": 1, "email": "...", "name": "..." },
  "token": "jwt_token..."
}
```

### POST /api/auth/login

ログイン。

**リクエスト**:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### GET /api/auth/me

現在のユーザー情報を取得。

### GET /api/auth/token

Chrome拡張用の認証トークンを取得。

---

## アイテム

### GET /api/items

ユーザーのアイテム一覧を取得。

**レスポンス**: アイテムの配列

### POST /api/items

アイテムを追加。

**URLベース追加**:
```json
{
  "url": "https://www.amazon.co.jp/dp/XXXX",
  "priority": 3,
  "planned_purchase_date": "2026-02-15",
  "category_id": 1,
  "quantity": 1,
  "notes": "メモ"
}
```

**手動追加**:
```json
{
  "manual": true,
  "name": "商品名",
  "price": 3990,
  "image_url": "https://...",
  "url": "https://..."  // 任意
}
```

### GET /api/items/:id

アイテム詳細を取得。

### PATCH /api/items/:id

アイテムを更新。

**リクエスト**:
```json
{
  "priority": 2,
  "quantity": 2,
  "planned_purchase_date": "2026-03-01",
  "category_id": 1,
  "target_price": 3000,
  "image_url": "https://...",
  "current_price": 3500,
  "is_purchased": true,
  "purchased_at": "2026-02-20"
}
```

### DELETE /api/items/:id

アイテムをソフトデリート（ゴミ箱へ）。

### POST /api/items/:id/refresh

商品情報を再スクレイピング。

### GET /api/items/:id/price-history

価格履歴を取得。

---

## カテゴリ

### GET /api/categories

カテゴリ一覧。

### POST /api/categories

カテゴリ作成。

```json
{
  "name": "ガジェット",
  "color": "#3b82f6"
}
```

### PUT /api/categories/:id

カテゴリ更新。

### DELETE /api/categories/:id

カテゴリ削除。

---

## 出費予定

### GET /api/budget

購入予定日別のアイテムと合計。

**クエリパラメータ**:
- `month`: 特定の月のみフィルタ (YYYY-MM)

**レスポンス**:
```json
{
  "2026-02": {
    "items": [...],
    "total": 10970
  }
}
```

---

## 統計

### GET /api/stats

統計データ。

**レスポンス**:
```json
{
  "overview": {
    "wishlistCount": 10,
    "purchasedCount": 5,
    "wishlistTotal": 50000,
    "purchasedTotal": 30000
  },
  "byCategory": [...],
  "byPriority": [...],
  "bySource": [...],
  "priceRanges": [...]
}
```

---

## ゴミ箱

### GET /api/trash

削除済みアイテム一覧。

### POST /api/trash/:id

アイテムを復元。

### DELETE /api/trash/:id

アイテムを完全削除。

---

## エクスポート

### GET /api/export

CSVエクスポート。

**クエリパラメータ**:
- `filter`: `all` | `wishlist` | `purchased`

---

## 通知設定

### GET /api/notification-settings

通知設定を取得。

### PUT /api/notification-settings

通知設定を更新。

```json
{
  "slack_webhook": "https://hooks.slack.com/...",
  "discord_webhook": "https://discord.com/api/webhooks/...",
  "notify_on_price_drop": true,
  "notify_on_target_price": true
}
```

---

## アップロード

### POST /api/upload

画像アップロード。

**リクエスト**: `multipart/form-data`
- `file`: 画像ファイル (5MB以下)

**レスポンス**:
```json
{
  "url": "/uploads/1_1234567890.jpg"
}
```

---

## インポート

### POST /api/import-wishlist

Web版ほしいものリストインポート。

```json
{
  "url": "https://www.amazon.co.jp/hz/wishlist/ls/XXXXX"
}
```

### POST /api/extension-import

Chrome拡張からのインポート。

**ヘッダー**: `Authorization: Bearer {token}`

```json
{
  "items": [
    {
      "name": "商品名",
      "url": "https://...",
      "price": 3990,
      "imageUrl": "https://..."
    }
  ]
}
```

---

## エラーレスポンス

```json
{
  "error": "エラーメッセージ"
}
```

| ステータス | 説明 |
|----------|------|
| 400 | リクエストエラー |
| 401 | 認証必要 |
| 404 | リソースが存在しない |
| 500 | サーバーエラー |
