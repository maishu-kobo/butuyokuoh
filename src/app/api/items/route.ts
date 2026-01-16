import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeUrl } from '@/lib/scraper';
import type { Item } from '@/types';

export async function GET() {
  const db = getDb();
  const items = db.prepare(`
    SELECT 
      i.*,
      cg.name as comparison_group_name,
      cg.priority as group_priority
    FROM items i
    LEFT JOIN comparison_groups cg ON i.comparison_group_id = cg.id
    WHERE i.is_purchased = 0
    ORDER BY 
      COALESCE(cg.priority, i.priority) ASC,
      i.planned_purchase_date ASC NULLS LAST,
      i.created_at DESC
  `).all();
  
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url, priority = 3, planned_purchase_date, notes, comparison_group_id } = body;

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  const db = getDb();

  // 重複チェック
  const existing = db.prepare('SELECT id FROM items WHERE url = ?').get(url);
  if (existing) {
    return NextResponse.json({ error: 'このURLは既に登録されています' }, { status: 400 });
  }

  // スクレイピング
  const scraped = await scrapeUrl(url);

  const stmt = db.prepare(`
    INSERT INTO items (name, url, image_url, current_price, original_price, source, source_name, priority, planned_purchase_date, comparison_group_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    scraped.name,
    url,
    scraped.imageUrl,
    scraped.price,
    scraped.price,
    scraped.source,
    scraped.sourceName,
    priority,
    planned_purchase_date || null,
    comparison_group_id || null,
    notes || null
  );

  // 価格履歴に追加
  if (scraped.price) {
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(result.lastInsertRowid, scraped.price);
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(item, { status: 201 });
}
