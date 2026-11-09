import { parseDecimalRouteId, withAccess } from '@/lib/api-access';
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
  // 10進の数字だけを id として受ける。"0x1f" のような表記で別の行を指させない。
  const itemId = parseDecimalRouteId(id);
  const result = itemId == null ? { kind: 'not_found' as const } : purgeTrashedItem(getDb(), user.id, itemId);
  if (result.kind !== 'purged') {
    // 不正な id・存在しない・他人・ゴミ箱に無い行は、従来どおりまとめて 404
    return NextResponse.json({ error: 'アイテムが見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

export const POST = withAccess(handlePOST, true);
export const DELETE = withAccess(handleDELETE, true);
