import type Database from 'better-sqlite3';

// 写真から登録した商品は、ページを取りに行く価格チェックに載せない。
// 商品コードがあるか、本人の比較グループが origin = 'photo' のときが対象。
// 機能を止めていても、この除外は残す。
export function priceCheckItems(db: Database.Database) {
  return db.prepare(`
    SELECT i.id, i.user_id, i.name, i.url, i.image_url, i.current_price, i.target_price
    FROM items i JOIN users u ON u.id = i.user_id
    WHERE u.account_type = 'member' AND i.is_purchased = 0 AND i.deleted_at IS NULL
      AND (i.source_item_code IS NULL OR i.source_item_code = '')
      AND NOT EXISTS (
        SELECT 1 FROM comparison_groups g
        WHERE g.id = i.comparison_group_id
          AND g.user_id = i.user_id
          AND g.origin = 'photo'
      )
  `).all();
}

export function excludesPagePriceCheck(
  db: Database.Database,
  item: { source_item_code?: string | null; comparison_group_id?: number | null; user_id?: number | null },
): boolean {
  if (item.source_item_code) return true;
  if (item.comparison_group_id == null || item.user_id == null) return false;
  const group = db.prepare(
    'SELECT origin FROM comparison_groups WHERE id = ? AND user_id = ?',
  ).get(item.comparison_group_id, item.user_id) as { origin: string | null } | undefined;
  return group?.origin === 'photo';
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
// 通知の type は送る分岐より前に決まっていた。目標価格に届いていれば、
// 目標通知がオフで値下げ通知だけオンのときも target_reached のまま送る。
export function priceDropNotification(
  oldPrice: number | null,
  newPrice: number,
  targetPrice: number | null,
  settings: PriceNotificationSettings | undefined,
): 'target_reached' | 'price_drop' | null {
  if (!oldPrice || newPrice >= oldPrice || !settings) return null;
  const targetReached = targetPrice !== null && targetPrice > 0 && newPrice <= targetPrice;
  if (targetReached) {
    if (settings.notify_on_target_price || settings.notify_on_price_drop) return 'target_reached';
    return null;
  }
  if (settings.notify_on_price_drop) return 'price_drop';
  return null;
}
