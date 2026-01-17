import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// 復元
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').get(id, user.id);
  if (!item) {
    return NextResponse.json({ error: 'アイテムが見つかりません' }, { status: 404 });
  }

  db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}

// 完全削除
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

  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').get(id, user.id);
  if (!item) {
    return NextResponse.json({ error: 'アイテムが見つかりません' }, { status: 404 });
  }

  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
