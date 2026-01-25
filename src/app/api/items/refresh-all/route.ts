import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeUrl } from '@/lib/scraper';
import { getCurrentUser } from '@/lib/auth';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  
  // ユーザーの未購入アイテムを取得
  const items = db.prepare(`
    SELECT id, url, current_price, stock_status
    FROM items
    WHERE user_id = ? AND is_purchased = 0 AND deleted_at IS NULL
  `).all(user.id) as { id: number; url: string; current_price: number | null; stock_status: string | null }[];

  const results = {
    total: items.length,
    updated: 0,
    failed: 0,
    priceChanges: [] as { id: number; name: string; oldPrice: number | null; newPrice: number | null }[],
    stockChanges: [] as { id: number; name: string; oldStatus: string | null; newStatus: string }[],
  };

  for (const item of items) {
    try {
      // manual:// で始まるURLはスキップ
      if (item.url.startsWith('manual://')) {
        continue;
      }

      const scraped = await scrapeUrl(item.url);
      
      // 価格と在庫状態を更新
      db.prepare(`
        UPDATE items 
        SET current_price = COALESCE(?, current_price),
            stock_status = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(scraped.price, scraped.stockStatus, item.id);

      // 価格履歴に追加
      if (scraped.price) {
        db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(item.id, scraped.price);
      }

      // 変更を記録
      if (item.current_price !== scraped.price && scraped.price !== null) {
        const itemName = db.prepare('SELECT name FROM items WHERE id = ?').get(item.id) as { name: string };
        results.priceChanges.push({
          id: item.id,
          name: itemName.name,
          oldPrice: item.current_price,
          newPrice: scraped.price,
        });
      }

      if (item.stock_status !== scraped.stockStatus) {
        const itemName = db.prepare('SELECT name FROM items WHERE id = ?').get(item.id) as { name: string };
        results.stockChanges.push({
          id: item.id,
          name: itemName.name,
          oldStatus: item.stock_status,
          newStatus: scraped.stockStatus,
        });
      }

      results.updated++;

      // レートリミット対策
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error(`Failed to refresh item ${item.id}:`, error);
      results.failed++;
    }
  }

  return NextResponse.json(results);
}
