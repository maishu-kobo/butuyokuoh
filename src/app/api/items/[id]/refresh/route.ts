import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeUrl } from '@/lib/scraper';
import { getCurrentUser } from '@/lib/auth';

interface DbItem {
  id: number;
  url: string;
  current_price: number | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, user.id) as DbItem | undefined;
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  // 再スクレイピング
  const scraped = await scrapeUrl(item.url);
  
  // 価格が変わった場合のみ更新
  if (scraped.price && scraped.price !== item.current_price) {
    db.prepare(`
      UPDATE items 
      SET current_price = ?, image_url = COALESCE(?, image_url), updated_at = datetime('now')
      WHERE id = ?
    `).run(scraped.price, scraped.imageUrl, id);
    
    // 価格履歴に追加
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(id, scraped.price);
  }

  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  return NextResponse.json(updated);
}
