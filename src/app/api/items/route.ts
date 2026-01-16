import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeUrl } from '@/lib/scraper';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  const items = db.prepare(`
    SELECT 
      i.*,
      cg.name as comparison_group_name,
      cg.priority as group_priority,
      cat.name as category_name,
      cat.color as category_color
    FROM items i
    LEFT JOIN comparison_groups cg ON i.comparison_group_id = cg.id
    LEFT JOIN categories cat ON i.category_id = cat.id
    WHERE i.is_purchased = 0 AND i.user_id = ?
    ORDER BY 
      COALESCE(cg.priority, i.priority) ASC,
      i.planned_purchase_date ASC NULLS LAST,
      i.created_at DESC
  `).all(user.id);
  
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { url, priority = 3, planned_purchase_date, notes, comparison_group_id, category_id } = body;

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  const db = getDb();

  // 重複チェック（同じユーザー内で）
  const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(user.id, url);
  if (existing) {
    return NextResponse.json({ error: 'このURLは既に登録されています' }, { status: 400 });
  }

  // スクレイピング
  const scraped = await scrapeUrl(url);

  const stmt = db.prepare(`
    INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source, source_name, priority, planned_purchase_date, comparison_group_id, category_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    user.id,
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
    category_id || null,
    notes || null
  );

  // 価格履歴に追加
  if (scraped.price) {
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(result.lastInsertRowid, scraped.price);
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(item, { status: 201 });
}
