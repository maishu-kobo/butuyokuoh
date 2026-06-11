import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  // 所有権チェック: 自分のアイテムでなければ404
  const item = db.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  const history = db.prepare(`
    SELECT * FROM price_history 
    WHERE item_id = ? 
    ORDER BY recorded_at ASC
  `).all(id);
  
  return NextResponse.json(history);
}
