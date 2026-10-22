import type Database from 'better-sqlite3';

export function priceCheckItems(db: Database.Database) {
  return db.prepare(`
    SELECT i.id, i.user_id, i.name, i.url, i.image_url, i.current_price, i.target_price
    FROM items i JOIN users u ON u.id = i.user_id
    WHERE u.account_type = 'member' AND i.is_purchased = 0 AND i.deleted_at IS NULL
  `).all();
}

// 直近の履歴と同じ価格なら足さない。recorded_at が同じ秒でも id が大きい方を直近とする。
// check-prices は読み込むと外部取得を始めるので、この判定だけをここから呼ぶ。
export function recordPriceIfChanged(db: Database.Database, itemId: number, newPrice: number): boolean {
  const lastHistory = db.prepare(`
    SELECT price FROM price_history
    WHERE item_id = ?
    ORDER BY recorded_at DESC, id DESC
    LIMIT 1
  `).get(itemId) as { price: number } | undefined;

  if (!lastHistory || lastHistory.price !== newPrice) {
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, newPrice);
    return true;
  }
  return false;
}

export interface PriceNotificationSettings {
  notify_on_price_drop: number;
  notify_on_target_price: number;
}

// 値上げ・同値・旧価格なし・設定なしは通知しない。
// 目標価格に届き、目標の通知がオンなら price_drop ではなく target_reached。
// 目標に届いても目標の通知がオフなら、値下げ通知がオンのときだけ price_drop。
export function priceDropNotification(
  oldPrice: number | null,
  newPrice: number,
  targetPrice: number | null,
  settings: PriceNotificationSettings | undefined,
): 'target_reached' | 'price_drop' | null {
  if (!oldPrice || newPrice >= oldPrice || !settings) return null;
  const targetReached = targetPrice !== null && targetPrice > 0 && newPrice <= targetPrice;
  if (targetReached && settings.notify_on_target_price) return 'target_reached';
  if (settings.notify_on_price_drop) return 'price_drop';
  return null;
}
