import type Database from 'better-sqlite3';

export function priceCheckItems(db: Database.Database) {
  return db.prepare(`
    SELECT i.id, i.user_id, i.name, i.url, i.image_url, i.current_price, i.target_price
    FROM items i JOIN users u ON u.id = i.user_id
    WHERE u.account_type = 'member' AND i.is_purchased = 0 AND i.deleted_at IS NULL
  `).all();
}
