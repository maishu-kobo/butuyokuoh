import { getDb } from '../src/lib/db';
import { scrapeUrl, deriveScrapeOutcome } from '../src/lib/scraper';
import { sendSlackNotification, sendDiscordNotification, NotificationPayload } from '../src/lib/notifier';

// getDb() 経由で取得することで initDb/migrateDb が実行され、
// 新カラム（last_scraped_at/scrape_status/scrape_error）への UPDATE が
// マイグレーション未実行の既存DBでも失敗しないようにする
const db = getDb();

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
  discord_webhook: string | null;
  notify_on_price_drop: number;
  notify_on_target_price: number;
}

async function checkPrices() {
  console.log(`[${new Date().toISOString()}] Starting price check...`);

  // 未購入かつゴミ箱（論理削除）に入っていないアイテムを全て取得
  const items = db.prepare(`
    SELECT id, user_id, name, url, image_url, current_price, target_price
    FROM items
    WHERE is_purchased = 0 AND deleted_at IS NULL
  `).all() as Item[];

  console.log(`Found ${items.length} items to check`);

  for (const item of items) {
    try {
      console.log(`Checking: ${item.name.substring(0, 50)}...`);
      
      const scraped = await scrapeUrl(item.url);

      // スクレイプ結果（成功/失敗）を導出
      const outcome = deriveScrapeOutcome(scraped);

      if (!scraped.price) {
        // 価格が取れなかった場合も last_scraped_at と失敗ステータスを記録する
        db.prepare(`
          UPDATE items
          SET last_scraped_at = datetime('now'),
              scrape_status = ?,
              scrape_error = ?
          WHERE id = ?
        `).run(outcome.status, outcome.error, item.id);
        console.log(`  - No price found (${outcome.error}), recorded as failed`);
        continue;
      }

      const oldPrice = item.current_price;
      const newPrice = scraped.price;

      // 価格を更新（合わせてスクレイプ成功を記録）
      db.prepare(`
        UPDATE items
        SET current_price = ?,
            last_scraped_at = datetime('now'),
            scrape_status = ?,
            scrape_error = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(newPrice, outcome.status, outcome.error, item.id);

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

    } catch (error) {
      console.error(`  - Error: ${error}`);
    } finally {
      // レートリミット対策で5秒待機（スキップ・エラー時も含め全アイテム間に適用）
      await new Promise(resolve => setTimeout(resolve, 5000));
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
