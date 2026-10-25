import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { annotateSpend, photoSpendDecisions, userSpendInput, type SpendDecision } from '@/lib/photo-spend';
import type { Item } from '@/types';

async function handleGET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const month = searchParams.get('month'); // YYYY-MM format

  const db = getDb();
  
  // 購入予定日が設定されているアイテム（ゴミ箱に入っていないもの）
  let query = `
    SELECT i.*, g.name AS comparison_group_name, g.origin AS group_origin,
      CASE WHEN g.origin = 'photo' THEN g.budget_item_id ELSE NULL END AS budget_selected_item_id
    FROM items i
    LEFT JOIN comparison_groups g ON g.id = i.comparison_group_id AND g.user_id = i.user_id
    WHERE i.is_purchased = 0
    AND i.user_id = ?
    AND i.deleted_at IS NULL
    AND i.planned_purchase_date IS NOT NULL
  `;
  const params: (string | number)[] = [user.id];

  if (month) {
    query += ` AND strftime('%Y-%m', i.planned_purchase_date) = ?`;
    params.push(month);
  }

  query += ` ORDER BY i.planned_purchase_date ASC`;

  const decisions = photoSpendDecisions(...userSpendInput(db, user.id));
  const items = annotateSpend(db.prepare(query).all(...params) as Item[], decisions);
  
  // 購入予定日が未設定のアイテム（購入時期未定）
  const undatedQuery = `
    SELECT i.*, g.name AS comparison_group_name, g.origin AS group_origin,
      CASE WHEN g.origin = 'photo' THEN g.budget_item_id ELSE NULL END AS budget_selected_item_id
    FROM items i
    LEFT JOIN comparison_groups g ON g.id = i.comparison_group_id AND g.user_id = i.user_id
    WHERE i.is_purchased = 0
    AND i.user_id = ?
    AND i.deleted_at IS NULL
    AND (i.planned_purchase_date IS NULL OR i.planned_purchase_date = '')
    ORDER BY i.priority ASC, i.created_at DESC
  `;
  const undatedItems = annotateSpend(db.prepare(undatedQuery).all(user.id) as Item[], decisions);
  
  // 月ごとにグループ化
  const byMonth: Record<string, { items: Item[], total: number }> = {};
  
  for (const item of items) {
    if (item.planned_purchase_date) {
      const monthKey = item.planned_purchase_date.substring(0, 7);
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { items: [], total: 0 };
      }
      byMonth[monthKey].items.push(item);
      byMonth[monthKey].total += countedAmount(item, decisions);
    }
  }

  // 購入時期未定のアイテムを追加
  if (undatedItems.length > 0) {
    const undatedTotal = undatedItems.reduce(
      (sum, item) => sum + countedAmount(item, decisions),
      0
    );
    byMonth['undated'] = { items: undatedItems, total: undatedTotal };
  }

  return NextResponse.json(byMonth);
}

function countedAmount(item: Item, decisions: Map<number, SpendDecision>): number {
  const decision = decisions.get(item.id);
  if (decision) return decision.amount;
  return (item.current_price || 0) * (item.quantity || 1);
}

export const GET = withAccess(handleGET, true);
