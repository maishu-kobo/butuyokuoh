import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { purgeTrashedItem } from '@/lib/item-input';

// 復元
async function handlePOST(
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

// 完全削除（1件）。所有者かつゴミ箱内の行だけ。エージェントの purge_item と同じ関数（#381）。
async function handleDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const result = purgeTrashedItem(getDb(), user.id, Number(id));
  if (result.kind !== 'purged') {
    // 存在しない・他人・ゴミ箱に無い行は、従来どおりまとめて 404
    return NextResponse.json({ error: 'アイテムが見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export const POST = withAccess(handlePOST, true);
export const DELETE = withAccess(handleDELETE, true);
