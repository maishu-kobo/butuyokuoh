# 在庫復帰通知機能

## 概要
商品が在庫切れから在庫ありに変わった際に通知する機能。

## ユースケース
- 人気商品や限定品が在庫切れ → 再入荷時に即座に知りたい
- 予約商品の在庫状況を追跡したい

## 実装案

### 1. データベース変更
```sql
-- itemsテーブルに在庫状態カラムを追加
ALTER TABLE items ADD COLUMN stock_status TEXT DEFAULT 'unknown';
-- 'in_stock', 'out_of_stock', 'unknown'

-- 在庫履歴テーブル（オプション）
CREATE TABLE stock_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
```

### 2. スクレイパー拡張
`src/lib/scraper.ts` に在庫状態の取得を追加:

```typescript
export interface ScrapedItem {
  name: string;
  price: number | null;
  imageUrl: string | null;
  source: string;
  sourceName: string | null;
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown'; // 追加
  note?: string;
}
```

**Amazon在庫判定パターン**:
- `id="availability"` 内のテキスト
- 「在庫あり」「一時的に在庫切れ」「この商品は現在お取り扱いできません」

**楽天在庫判定パターン**:
- 「SOLD OUT」「品切れ」「入荷待ち」

### 3. 通知設定UI拡張
設定ページに追加:
- [ ] 在庫復帰時に通知

### 4. check-prices.ts 拡張
価格チェック時に在庫状態も確認し、`out_of_stock` → `in_stock` 変化時に通知。

### 5. 通知メッセージ
```
🎉 在庫が復活しました！

商品名: XXXXX
現在価格: ¥X,XXX

[商品ページを開く]
```

## タスク
- [ ] DBスキーマ変更
- [ ] scraperに在庫状態取得を追加
- [ ] user_notification_settingsにnotify_on_stock_backカラム追加
- [ ] check-prices.tsで在庫変化検知
- [ ] notifier.tsに在庫復帰通知を追加
- [ ] 設定ページUIに在庫通知オプション追加
- [ ] アイテムカードに在庫状態バッジ表示

## 優先度
中

## ラベル
`enhancement`, `notification`
