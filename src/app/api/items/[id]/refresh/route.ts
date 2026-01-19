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
  
  // スクレイピング結果を更新（商品名、価格、画像）
  const updates: string[] = [];
  const values: unknown[] = [];

  // 商品名が取得できた場合のみ更新（エラーメッセージでない場合）
  if (scraped.name && !scraped.name.includes('取得できません') && !scraped.name.includes('不明な商品')) {
    updates.push('name = ?');
    values.push(scraped.name);
  }

  // 価格が取得できた場合
  if (scraped.price) {
    updates.push('current_price = ?');
    values.push(scraped.price);
    
    // 価格が変わった場合のみ履歴に追加
    if (scraped.price !== item.current_price) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(id, scraped.price);
    }
  }

  // 画像が取得できた場合
  if (scraped.imageUrl) {
    updates.push('image_url = ?');
    values.push(scraped.imageUrl);
  }

  // 更新がある場合のみ実行
  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown>;
  return NextResponse.json({ ...updated, note: scraped.note });
}
