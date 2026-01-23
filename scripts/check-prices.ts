import Database from 'better-sqlite3';
import path from 'path';
import { scrapeUrl } from '../src/lib/scraper';
import { 
  sendSlackNotification, 
  sendDiscordNotification, 
  sendSlackStockNotification,
  sendDiscordStockNotification,
  NotificationPayload,
  StockNotificationPayload 
} from '../src/lib/notifier';

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
  stock_status: string | null;
}

interface UserSettings {
  user_id: number;
  slack_webhook: string | null;
  discord_webhook: string | null;
  notify_on_price_drop: number;
  notify_on_target_price: number;
  notify_on_stock_back: number;
}

async function checkPrices() {
  console.log(`[${new Date().toISOString()}] Starting price check...`);

  // 未購入のアイテムを全て取得
  const items = db.prepare(`
    SELECT id, user_id, name, url, image_url, current_price, target_price, stock_status
    FROM items
    WHERE is_purchased = 0 AND deleted_at IS NULL
  `).all() as Item[];

  console.log(`Found ${items.length} items to check`);

  for (const item of items) {
    try {
      console.log(`Checking: ${item.name.substring(0, 50)}...`);
      
      const scraped = await scrapeUrl(item.url);
      
      const oldPrice = item.current_price;
      const newPrice = scraped.price;
      const oldStockStatus = item.stock_status;
      const newStockStatus = scraped.stockStatus;

      // 価格と在庫状態を更新
      db.prepare(`
        UPDATE items 
        SET current_price = COALESCE(?, current_price), 
            stock_status = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(newPrice, newStockStatus, item.id);

      // 価格が取得できた場合のみ履歴に追加
      if (newPrice) {
        db.prepare(`
          INSERT INTO price_history (item_id, price)
          VALUES (?, ?)
        `).run(item.id, newPrice);
      }

      console.log(`  - Price: ¥${oldPrice?.toLocaleString() || '---'} -> ¥${newPrice?.toLocaleString() || '---'}`);
      console.log(`  - Stock: ${oldStockStatus || 'unknown'} -> ${newStockStatus}`);

      // ユーザーの通知設定を取得
      const userSettings = db.prepare(`
        SELECT * FROM user_notification_settings WHERE user_id = ?
      `).get(item.user_id) as UserSettings | undefined;

      if (userSettings) {
        // 在庫復帰通知（out_of_stock -> in_stock）
        if (oldStockStatus === 'out_of_stock' && newStockStatus === 'in_stock' && userSettings.notify_on_stock_back) {
          console.log(`  - Stock is back! Sending notifications...`);
          
          const stockPayload: StockNotificationPayload = {
            item: { ...item, current_price: newPrice } as any,
            type: 'stock_back',
          };
          
          if (userSettings.slack_webhook) {
            await sendSlackStockNotification(userSettings.slack_webhook, stockPayload);
            console.log(`    - Slack: sent`);
          }
          if (userSettings.discord_webhook) {
            await sendDiscordStockNotification(userSettings.discord_webhook, stockPayload);
            console.log(`    - Discord: sent`);
          }
        }

        // 価格が下がった場合の通知チェック
        if (oldPrice && newPrice && newPrice < oldPrice) {
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
            if (userSettings.discord_webhook) {
              await sendDiscordNotification(userSettings.discord_webhook, payload);
              console.log(`    - Discord: sent`);
            }
          }
          // 価格下落通知
          else if (userSettings.notify_on_price_drop) {
            console.log(`  - Price dropped! Sending notifications...`);
            
            if (userSettings.slack_webhook) {
              await sendSlackNotification(userSettings.slack_webhook, payload);
              console.log(`    - Slack: sent`);
            }
            if (userSettings.discord_webhook) {
              await sendDiscordNotification(userSettings.discord_webhook, payload);
              console.log(`    - Discord: sent`);
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
