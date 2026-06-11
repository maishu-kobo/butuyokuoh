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
  const { name, priority } = await request.json();

  const db = getDb();

  // 所有権確認
  const group = db.prepare('SELECT * FROM comparison_groups WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!group) {
    return NextResponse.json({ error: '比較グループが見つかりません' }, { status: 404 });
  }

  db.prepare(`
    UPDATE comparison_groups
    SET name = COALESCE(?, name),
        priority = COALESCE(?, priority)
    WHERE id = ? AND user_id = ?
  `).run(name, priority, id, user.id);

  const updated = db.prepare('SELECT * FROM comparison_groups WHERE id = ?').get(id);
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
  const group = db.prepare('SELECT * FROM comparison_groups WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!group) {
    return NextResponse.json({ error: '比較グループが見つかりません' }, { status: 404 });
  }

  // 紐づくアイテムのcomparison_group_idをnullに
  db.prepare('UPDATE items SET comparison_group_id = NULL WHERE comparison_group_id = ? AND user_id = ?').run(id, user.id);

  // 比較グループ削除
  db.prepare('DELETE FROM comparison_groups WHERE id = ? AND user_id = ?').run(id, user.id);

  return NextResponse.json({ success: true });
}
