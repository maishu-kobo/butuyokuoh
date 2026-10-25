import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

async function handlePUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const { name, color, icon, sort_order } = await request.json();

  const db = getDb();

  // 所有権確認
  const category = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!category) {
    return NextResponse.json({ error: 'カテゴリが見つかりません' }, { status: 404 });
  }

  db.prepare(`
    UPDATE categories
    SET name = COALESCE(?, name),
        color = COALESCE(?, color),
        icon = COALESCE(?, icon),
        sort_order = COALESCE(?, sort_order)
    WHERE id = ? AND user_id = ?
  `).run(name ?? null, color ?? null, icon ?? null, sort_order ?? null, id, user.id);

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  return NextResponse.json(updated);
}

async function handleDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  // 所有権確認
  const category = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!category) {
    return NextResponse.json({ error: 'カテゴリが見つかりません' }, { status: 404 });
  }

  // アイテムのcategory_idをnullに
  db.prepare('UPDATE items SET category_id = NULL WHERE category_id = ? AND user_id = ?').run(id, user.id);

  // カテゴリ削除
  db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, user.id);

  return NextResponse.json({ success: true });
}

export const PUT = withAccess(handlePUT, true);
export const DELETE = withAccess(handleDELETE, true);
