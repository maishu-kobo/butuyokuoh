import type Database from 'better-sqlite3';

export const DEMO_IMAGE = '/demo/wishlist.svg';

export function seedDemoData(db: Database.Database, userId: number, now: number) {
  const category = db.prepare('INSERT INTO categories (user_id, name, color, sort_order) VALUES (?, ?, ?, ?)');
  const categories = [
    ['暮らし', '#059669'], ['ガジェット', '#2563eb'], ['趣味', '#d97706'],
  ].map(([name, color], index) => Number(category.run(userId, name, color, index).lastInsertRowid));
  const group = db.prepare('INSERT INTO comparison_groups (user_id, name) VALUES (?, ?)');
  const groups = ['デスクの椅子選び', '音楽を楽しむ'].map(name => Number(group.run(userId, name).lastInsertRowid));
  const date = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
  const examples = [
    { name: '読書がはかどるデスクチェア', price: 24000, category: 0, group: 0, days: 7 },
    { name: 'ゆったり座れるワークチェア', price: 32000, category: 0, group: 0, days: 7 },
    { name: '持ち歩けるワイヤレスヘッドホン', price: 18000, category: 1, group: 1, days: 30 },
    { name: '休日を楽しむコーヒーセット', price: 6500, category: 2, group: null, days: null },
    { name: 'お気に入りのマグカップ', price: 2200, category: 0, group: null, purchased: true, days: null },
    { name: '検討を見送ったデスクライト', price: 4800, category: 1, group: null, deleted: true, days: null },
  ];
  const insert = db.prepare(`INSERT INTO items
    (user_id, name, url, image_url, current_price, original_price, category_id, comparison_group_id,
     priority, planned_purchase_date, is_purchased, purchased_at, deleted_at, notes, is_demo_sample)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const history = db.prepare('INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, ?, ?)');
  examples.forEach((item, index) => {
    const result = insert.run(userId, item.name, `manual://demo-${index}`, DEMO_IMAGE,
      item.price, item.price + 1000, categories[item.category], item.group === null ? null : groups[item.group],
      index < 2 ? 2 : 3, item.days === null ? null : date(item.days), item.purchased ? 1 : 0,
      item.purchased ? date(-3) : null, item.deleted ? new Date(now).toISOString() : null,
      'デモ用の商品です。名前や価格、購入予定日を自由に変更できます。');
    [14, 7, 0].forEach((days, historyIndex) => {
      history.run(result.lastInsertRowid, item.price + (2 - historyIndex) * 500,
        new Date(now - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' '));
    });
  });
}
