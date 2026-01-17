import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();

  // 全体統計
  const overview = db.prepare(`
    SELECT 
      COUNT(*) as total_items,
      SUM(CASE WHEN is_purchased = 0 AND deleted_at IS NULL THEN 1 ELSE 0 END) as wishlist_count,
      SUM(CASE WHEN is_purchased = 1 THEN 1 ELSE 0 END) as purchased_count,
      SUM(CASE WHEN is_purchased = 0 AND deleted_at IS NULL THEN current_price ELSE 0 END) as wishlist_total,
      SUM(CASE WHEN is_purchased = 1 THEN current_price ELSE 0 END) as purchased_total
    FROM items
    WHERE user_id = ?
  `).get(user.id) as {
    total_items: number;
    wishlist_count: number;
    purchased_count: number;
    wishlist_total: number | null;
    purchased_total: number | null;
  };

  // カテゴリ別集計
  const byCategory = db.prepare(`
    SELECT 
      COALESCE(c.name, '未分類') as category_name,
      COALESCE(c.color, '#6b7280') as category_color,
      COUNT(*) as count,
      SUM(i.current_price) as total
    FROM items i
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.user_id = ? AND i.is_purchased = 0 AND i.deleted_at IS NULL
    GROUP BY i.category_id
    ORDER BY total DESC
  `).all(user.id);

  // 優先度別集計
  const byPriority = db.prepare(`
    SELECT 
      priority,
      COUNT(*) as count,
      SUM(current_price) as total
    FROM items
    WHERE user_id = ? AND is_purchased = 0 AND deleted_at IS NULL
    GROUP BY priority
    ORDER BY priority ASC
  `).all(user.id);

  // 月別購入履歴（12ヶ月）
  const monthlyPurchased = db.prepare(`
    SELECT 
      strftime('%Y-%m', purchased_at) as month,
      COUNT(*) as count,
      SUM(current_price) as total
    FROM items
    WHERE user_id = ? AND is_purchased = 1 AND purchased_at IS NOT NULL
    GROUP BY strftime('%Y-%m', purchased_at)
    ORDER BY month DESC
    LIMIT 12
  `).all(user.id);

  // ソース別集計（Amazon/楽天/その他）
  const bySource = db.prepare(`
    SELECT 
      source,
      COUNT(*) as count,
      SUM(current_price) as total
    FROM items
    WHERE user_id = ? AND is_purchased = 0 AND deleted_at IS NULL
    GROUP BY source
    ORDER BY count DESC
  `).all(user.id);

  // 価格帯分布
  const priceRanges = db.prepare(`
    SELECT 
      CASE 
        WHEN current_price < 1000 THEN '~¥1,000'
        WHEN current_price < 5000 THEN '¥1,000~¥5,000'
        WHEN current_price < 10000 THEN '¥5,000~¥10,000'
        WHEN current_price < 30000 THEN '¥10,000~¥30,000'
        WHEN current_price < 50000 THEN '¥30,000~¥50,000'
        ELSE '¥50,000~'
      END as range,
      COUNT(*) as count
    FROM items
    WHERE user_id = ? AND is_purchased = 0 AND deleted_at IS NULL AND current_price IS NOT NULL
    GROUP BY range
    ORDER BY MIN(current_price) ASC
  `).all(user.id);

  return NextResponse.json({
    overview: {
      wishlistCount: overview.wishlist_count,
      purchasedCount: overview.purchased_count,
      wishlistTotal: overview.wishlist_total || 0,
      purchasedTotal: overview.purchased_total || 0,
    },
    byCategory,
    byPriority,
    monthlyPurchased,
    bySource,
    priceRanges,
  });
}
