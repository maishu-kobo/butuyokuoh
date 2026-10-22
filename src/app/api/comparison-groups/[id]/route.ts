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
  const body = await request.json();
  const { name, priority } = body ?? {};
  const hasBudget = Boolean(body) && typeof body === 'object' && !Array.isArray(body)
    && Object.prototype.hasOwnProperty.call(body, 'budgetItemId');
  const budgetItemId = hasBudget ? (body as { budgetItemId?: unknown }).budgetItemId : null;

  const db = getDb();

  // 所有権確認
  const group = db.prepare('SELECT * FROM comparison_groups WHERE id = ? AND user_id = ?').get(id, user.id) as { origin?: string | null } | undefined;
  if (!group) {
    return NextResponse.json({ error: '比較グループが見つかりません' }, { status: 404 });
  }

  if (hasBudget) {
    if (group.origin !== 'photo') {
      return NextResponse.json({ error: '写真から作ったグループだけ、数える候補を保存できます' }, { status: 400 });
    }
    if (budgetItemId !== null) {
      const candidateId = typeof budgetItemId === 'number' && Number.isInteger(budgetItemId) && budgetItemId > 0
        ? budgetItemId
        : null;
      const candidate = candidateId == null ? undefined : db.prepare(`
        SELECT id FROM items
        WHERE id = ? AND user_id = ? AND comparison_group_id = ? AND deleted_at IS NULL AND is_purchased = 0
      `).get(candidateId, user.id, id);
      if (!candidate) {
        return NextResponse.json({ error: 'このグループの候補ではありません' }, { status: 400 });
      }
    }
  }

  db.prepare(`
    UPDATE comparison_groups
    SET name = COALESCE(?, name),
        priority = COALESCE(?, priority),
        budget_item_id = CASE WHEN ? = 1 THEN ? ELSE budget_item_id END
    WHERE id = ? AND user_id = ?
  `).run(name ?? null, priority ?? null, hasBudget ? 1 : 0, budgetItemId ?? null, id, user.id);

  const updated = db.prepare('SELECT * FROM comparison_groups WHERE id = ?').get(id);
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
  const group = db.prepare('SELECT * FROM comparison_groups WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!group) {
    return NextResponse.json({ error: '比較グループが見つかりません' }, { status: 404 });
  }

  // 紐づくアイテムのcomparison_group_idのnull化とグループ削除を
  // 1トランザクションにまとめ、途中失敗による不整合を防ぐ
  const deleteGroup = db.transaction(() => {
    db.prepare('UPDATE items SET comparison_group_id = NULL WHERE comparison_group_id = ? AND user_id = ?').run(id, user.id);
    db.prepare('DELETE FROM comparison_groups WHERE id = ? AND user_id = ?').run(id, user.id);
  });
  deleteGroup();

  return NextResponse.json({ success: true });
}

export const PUT = withAccess(handlePUT, true);
export const DELETE = withAccess(handleDELETE, true);
