import Database from 'better-sqlite3';
import path from 'path';
import { scrapeUrl } from '../src/lib/scraper';
import { sendSlackNotification, sendLineNotification, NotificationPayload } from '../src/lib/notifier';

const dbPath = path.join(process.cwd(), 'data', 'butuyokuoh.db');
const db = new Database(dbPath);

interface Item {
  id: number;
  user_id: number;
  name: string;
  url: string;
  image_url: string | null;
  current_price: number | null;
  target_price: number | null;
}

interface UserSettings {
  user_id: number;
  slack_webhook: string | null;
  line_notify_token: string | null;
  notify_on_price_drop: number;
  notify_on_target_price: number;
}

async function checkPrices() {
  console.log(`[${new Date().toISOString()}] Starting price check...`);

  // 未購入のアイテムを全て取得
  const items = db.prepare(`
    SELECT id, user_id, name, url, image_url, current_price, target_price
    FROM items
    WHERE is_purchased = 0
  `).all() as Item[];

  console.log(`Found ${items.length} items to check`);

  for (const item of items) {
    try {
      console.log(`Checking: ${item.name.substring(0, 50)}...`);
      
      const scraped = await scrapeUrl(item.url);
      
      if (!scraped.price) {
        console.log(`  - No price found, skipping`);
        continue;
      }

      const oldPrice = item.current_price;
      const newPrice = scraped.price;

      // 価格を更新
      db.prepare(`
        UPDATE items 
        SET current_price = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newPrice, item.id);

      // 価格履歴に追加
      db.prepare(`
        INSERT INTO price_history (item_id, price)
        VALUES (?, ?)
      `).run(item.id, newPrice);

      console.log(`  - Price: ¥${oldPrice?.toLocaleString() || '---'} -> ¥${newPrice.toLocaleString()}`);

      // 価格が下がった場合のみ通知チェック
      if (oldPrice && newPrice < oldPrice) {
        const userSettings = db.prepare(`
          SELECT * FROM user_notification_settings WHERE user_id = ?
        `).get(item.user_id) as UserSettings | undefined;

        if (userSettings) {
          const payload: NotificationPayload = {
            item: item as any,
            oldPrice,
            newPrice,
            targetPrice: item.target_price || undefined,
            type: item.target_price && newPrice <= item.target_price ? 'target_reached' : 'price_drop',
          };

          // 目標価格到達通知
          if (item.target_price && newPrice <= item.target_price && userSettings.notify_on_target_price) {
            console.log(`  - Target price reached! Sending notifications...`);
            
            if (userSettings.slack_webhook) {
              await sendSlackNotification(userSettings.slack_webhook, payload);
              console.log(`    - Slack: sent`);
            }
            if (userSettings.line_notify_token) {
              await sendLineNotification(userSettings.line_notify_token, payload);
              console.log(`    - LINE: sent`);
            }
          }
          // 価格下落通知
          else if (userSettings.notify_on_price_drop) {
            console.log(`  - Price dropped! Sending notifications...`);
            
            if (userSettings.slack_webhook) {
              await sendSlackNotification(userSettings.slack_webhook, payload);
              console.log(`    - Slack: sent`);
            }
            if (userSettings.line_notify_token) {
              await sendLineNotification(userSettings.line_notify_token, payload);
              console.log(`    - LINE: sent`);
            }
          }
        }
      }

      // レートリミット対策で20.5秒待機
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`  - Error: ${error}`);
    }
  }

  console.log(`[${new Date().toISOString()}] Price check completed`);
}

checkPrices().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
