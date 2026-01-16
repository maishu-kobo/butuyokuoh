import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeWishlist } from '@/lib/wishlist-scraper';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = body;

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    // ほしいものリストをスクレイピング
    const result = await scrapeWishlist(url);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (result.items.length === 0) {
      return NextResponse.json({ 
        error: 'アイテムが見つかりませんでした。リストが公開されているか確認してください。' 
      }, { status: 400 });
    }

    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (name, url, image_url, current_price, original_price, source, source_name, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const priceHistoryStmt = db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)');

    let imported = 0;
    let skipped = 0;

    for (const item of result.items) {
      try {
        const existingItem = db.prepare('SELECT id FROM items WHERE url = ?').get(item.url);
        if (existingItem) {
          skipped++;
          continue;
        }

        const sourceName = result.source === 'amazon' ? 'Amazon' : '楽天市場';
        const insertResult = insertStmt.run(
          item.name,
          item.url,
          item.imageUrl,
          item.price,
          item.price,
          result.source,
          sourceName,
          3 // デフォルト優先度
        );

        if (insertResult.changes > 0 && item.price) {
          priceHistoryStmt.run(insertResult.lastInsertRowid, item.price);
        }

        if (insertResult.changes > 0) {
          imported++;
        }
      } catch (e) {
        console.error('Error inserting item:', e);
      }
    }

    return NextResponse.json({
      success: true,
      listName: result.listName,
      source: result.source,
      total: result.items.length,
      imported,
      skipped,
    });
  } catch (error) {
    console.error('Import wishlist error:', error);
    return NextResponse.json({ 
      error: 'インポートに失敗しました。URLが正しいか確認してください。' 
    }, { status: 500 });
  }
}
