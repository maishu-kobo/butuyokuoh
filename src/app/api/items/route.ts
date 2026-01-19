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
      cat.color as category_color,
      (
        SELECT price FROM price_history 
        WHERE item_id = i.id 
        ORDER BY recorded_at DESC 
        LIMIT 1 OFFSET 1
      ) as previous_price
    FROM items i
    LEFT JOIN comparison_groups cg ON i.comparison_group_id = cg.id
    LEFT JOIN categories cat ON i.category_id = cat.id
    WHERE i.is_purchased = 0 AND i.user_id = ? AND i.deleted_at IS NULL
    ORDER BY 
      COALESCE(cg.priority, i.priority) ASC,
      i.sort_order ASC,
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
  const { 
    url, 
    priority = 3, 
    planned_purchase_date, 
    notes, 
    comparison_group_id, 
    category_id, 
    quantity = 1,
    // 手動追加用フィールド
    manual = false,
    name: manualName,
    price: manualPrice,
    image_url: manualImageUrl,
  } = body;

  const db = getDb();

  // 手動追加モード
  if (manual) {
    if (!manualName) {
      return NextResponse.json({ error: '商品名は必須です' }, { status: 400 });
    }

    const stmt = db.prepare(`
      INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source, priority, planned_purchase_date, comparison_group_id, category_id, notes, quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const manualUrl = url || `manual://${Date.now()}`; // URLなしの場合はダミーURL
    const result = stmt.run(
      user.id,
      manualName,
      manualUrl,
      manualImageUrl || null,
      manualPrice || null,
      manualPrice || null,
      'other',
      priority,
      planned_purchase_date || null,
      comparison_group_id || null,
      category_id || null,
      notes || null,
      quantity
    );

    if (manualPrice) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(result.lastInsertRowid, manualPrice);
    }

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(item, { status: 201 });
  }

  // URLベースの追加（通常モード）
  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  // 重複チェック（同じユーザー内で）
  const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(user.id, url);
  if (existing) {
    return NextResponse.json({ error: 'このURLは既に登録されています' }, { status: 400 });
  }

  // スクレイピング
  const scraped = await scrapeUrl(url);

  const stmt = db.prepare(`
    INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source, source_name, priority, planned_purchase_date, comparison_group_id, category_id, notes, quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    notes || null,
    quantity
  );

  // 価格履歴に追加
  if (scraped.price) {
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(result.lastInsertRowid, scraped.price);
  }

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;
  
  // スクレイピング結果に注意メッセージがあれば含める
  const response = { ...item, scrapeNote: scraped.note || null };
  return NextResponse.json(response, { status: 201 });
}
