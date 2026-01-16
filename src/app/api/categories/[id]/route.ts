import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function PUT(
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
  `).run(name, color, icon, sort_order, id, user.id);

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  return NextResponse.json(updated);
}

export async function DELETE(
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
  db.prepare('UPDATE items SET category_id = NULL WHERE category_id = ?').run(id);

  // カテゴリ削除
  db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, user.id);

  return NextResponse.json({ success: true });
}
