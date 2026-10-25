import { priceCheckItems, priceDropNotification, recordPriceIfChanged } from '../src/lib/price-check-items';
import { getDb } from '../src/lib/db';
import { scrapeUrl, deriveScrapeOutcome } from '../src/lib/scraper';
import { sendSlackNotification, sendDiscordNotification, NotificationPayload } from '../src/lib/notifier';
import { readCaptureSecrets } from '../src/lib/capture-secrets';
import { createRakutenLimiter, type RakutenHttpRequest, type RakutenHttpResponse } from '../src/lib/capture/rakuten';
import { refreshDueRakutenPrices } from '../src/lib/capture/rakuten-price';

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
  const items = priceCheckItems(db) as Item[];

  console.log(`Found ${items.length} items to check`);

  for (const item of items) {
    // スクレイプ結果の記録（成功側UPDATE）が完了したかどうか。
    // 完了後に後続処理（price_history INSERTや通知）が throw しても、
    // catch 側で scrape_status='failed' に上書きしないようにする。
    let statusRecorded = false;
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
      statusRecorded = true;

      // 価格履歴に追加（直近履歴と同値ならスキップ）。判定は recordPriceIfChanged。
      recordPriceIfChanged(db, item.id, newPrice);

      console.log(`  - Price: ¥${oldPrice?.toLocaleString() || '---'} -> ¥${newPrice.toLocaleString()}`);

      // 価格が下がった場合のみ通知チェック
      if (oldPrice && newPrice < oldPrice) {
        const userSettings = db.prepare(`
          SELECT * FROM user_notification_settings WHERE user_id = ?
        `).get(item.user_id) as UserSettings | undefined;

        const kind = priceDropNotification(oldPrice, newPrice, item.target_price, userSettings);
        if (kind && userSettings) {
          const payload: NotificationPayload = {
            item,
            oldPrice,
            newPrice,
            targetPrice: item.target_price || undefined,
            type: kind,
          };

          console.log(`  - ${kind === 'target_reached' ? 'Target price reached' : 'Price dropped'}! Sending notifications...`);
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

    } catch (error) {
      console.error(`  - Error: ${error}`);
      // 例外発生時も last_scraped_at と失敗ステータスを記録する。
      // ただし成功記録済み（statusRecorded=true）の場合は、後続処理の例外で
      // scrape_status='failed' に上書きしない。
      // この記録用UPDATE自体が失敗してもループ全体は止めない。
      if (!statusRecorded) {
        try {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
          db.prepare(`
            UPDATE items
            SET last_scraped_at = datetime('now'),
                scrape_status = 'failed',
                scrape_error = ?
            WHERE id = ?
          `).run(message, item.id);
        } catch (updateError) {
          console.error(`  - Failed to record scrape failure: ${updateError}`);
        }
      }
    } finally {
      // レートリミット対策で5秒待機（スキップ・エラー時も含め全アイテム間に適用）
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  const secrets = readCaptureSecrets();
  await refreshDueRakutenPrices(db, {
    credentials: secrets.rakutenAppId && secrets.rakutenAccessKey
      ? { applicationId: secrets.rakutenAppId, accessKey: secrets.rakutenAccessKey }
      : null,
    http: rakutenHttp,
    limiter: createRakutenLimiter(),
    pause: () => new Promise((resolve) => setTimeout(resolve, 1000)),
  });

  console.log(`[${new Date().toISOString()}] Price check completed`);
}

async function rakutenHttp(request: RakutenHttpRequest): Promise<RakutenHttpResponse> {
  const response = await fetch(request.url, {
    method: 'GET',
    headers: request.headers,
    signal: request.signal,
  });
  return { status: response.status, body: await response.text() };
}

checkPrices().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
