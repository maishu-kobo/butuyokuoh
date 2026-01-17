import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import type { Item } from '@/types';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const month = searchParams.get('month'); // YYYY-MM format

  const db = getDb();
  
  let query = `
    SELECT * FROM items 
    WHERE is_purchased = 0 
    AND user_id = ?
    AND planned_purchase_date IS NOT NULL
  `;
  const params: (string | number)[] = [user.id];

  if (month) {
    query += ` AND strftime('%Y-%m', planned_purchase_date) = ?`;
    params.push(month);
  }

  query += ` ORDER BY planned_purchase_date ASC`;

  const items = db.prepare(query).all(...params) as Item[];
  
  // 月ごとにグループ化
  const byMonth: Record<string, { items: Item[], total: number }> = {};
  
  for (const item of items) {
    if (item.planned_purchase_date) {
      const monthKey = item.planned_purchase_date.substring(0, 7);
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { items: [], total: 0 };
      }
      byMonth[monthKey].items.push(item);
      byMonth[monthKey].total += (item.current_price || 0) * (item.quantity || 1);
    }
  }

  return NextResponse.json(byMonth);
}
