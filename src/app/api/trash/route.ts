import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  
  // 7日以上経過したアイテムを完全削除
  db.prepare(`
    DELETE FROM items 
    WHERE user_id = ? 
      AND deleted_at IS NOT NULL 
      AND datetime(deleted_at, '+7 days') < datetime('now')
  `).run(user.id);

  // ゴミ箱内のアイテムを取得
  const items = db.prepare(`
    SELECT 
      i.*,
      cat.name as category_name,
      cat.color as category_color,
      CAST((julianday(datetime(deleted_at, '+7 days')) - julianday('now')) AS INTEGER) as days_left
    FROM items i
    LEFT JOIN categories cat ON i.category_id = cat.id
    WHERE i.user_id = ? AND i.deleted_at IS NOT NULL
    ORDER BY i.deleted_at DESC
  `).all(user.id);

  return NextResponse.json(items);
}

// ゴミ箱を空にする（自ユーザーのゴミ箱内アイテムを全件ハード削除）
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();

  // user_id を必ず条件に含め、他ユーザーのアイテムには触れない
  // 削除パターンは trash/[id] の個別完全削除（items のみ DELETE）と整合
  const result = db.prepare(`
    DELETE FROM items
    WHERE user_id = ? AND deleted_at IS NOT NULL
  `).run(user.id);

  return NextResponse.json({ success: true, deleted: result.changes });
}
