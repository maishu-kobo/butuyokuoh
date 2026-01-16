import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  
  // 購入済みアイテムを取得
  const items = db.prepare(`
    SELECT 
      i.*,
      cat.name as category_name,
      cat.color as category_color
    FROM items i
    LEFT JOIN categories cat ON i.category_id = cat.id
    WHERE i.is_purchased = 1 AND i.user_id = ?
    ORDER BY i.purchased_at DESC
  `).all(user.id);

  // 月別集計
  const monthlySummary = db.prepare(`
    SELECT 
      strftime('%Y-%m', purchased_at) as month,
      COUNT(*) as count,
      SUM(current_price) as total
    FROM items
    WHERE is_purchased = 1 AND user_id = ? AND purchased_at IS NOT NULL
    GROUP BY strftime('%Y-%m', purchased_at)
    ORDER BY month DESC
    LIMIT 12
  `).all(user.id);

  // 全体集計
  const totalStats = db.prepare(`
    SELECT 
      COUNT(*) as count,
      SUM(current_price) as total
    FROM items
    WHERE is_purchased = 1 AND user_id = ?
  `).get(user.id) as { count: number; total: number | null };

  return NextResponse.json({
    items,
    monthlySummary,
    totalStats: {
      count: totalStats.count,
      total: totalStats.total || 0,
    },
  });
}
