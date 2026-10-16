import { withAccess } from '@/lib/api-access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

async function handleGET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  
  // Guest cleanup uses the session deadline; member trash retains its 7-day policy.
  if (user.account_type === 'member') {
    db.transaction(() => {
      for (const table of ['price_history', 'notification_settings']) {
        db.prepare(`DELETE FROM ${table} WHERE item_id IN (SELECT id FROM items WHERE user_id = ? AND deleted_at IS NOT NULL AND datetime(deleted_at, '+7 days') < datetime('now'))`).run(user.id);
      }
      db.prepare("DELETE FROM items WHERE user_id = ? AND deleted_at IS NOT NULL AND datetime(deleted_at, '+7 days') < datetime('now')").run(user.id);
    }).immediate();
  }

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
async function handleDELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();

  const result = db.transaction(() => {
    for (const table of ['price_history', 'notification_settings']) {
      db.prepare(`DELETE FROM ${table} WHERE item_id IN (SELECT id FROM items WHERE user_id = ? AND deleted_at IS NOT NULL)`).run(user.id);
    }
    return db.prepare('DELETE FROM items WHERE user_id = ? AND deleted_at IS NOT NULL').run(user.id);
  }).immediate();

  return NextResponse.json({ success: true, deleted: result.changes });
}

export const GET = withAccess(handleGET, true);
export const DELETE = withAccess(handleDELETE, true);
