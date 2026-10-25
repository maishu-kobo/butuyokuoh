import { assertGuestCapacity } from '@/lib/guest';
import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

async function handleGET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  const groups = db.prepare(`
    SELECT 
      cg.*,
      COUNT(i.id) as item_count
    FROM comparison_groups cg
    LEFT JOIN items i ON i.comparison_group_id = cg.id AND i.user_id = cg.user_id AND i.deleted_at IS NULL AND i.is_purchased = 0
    WHERE cg.user_id = ?
    GROUP BY cg.id
    ORDER BY cg.priority ASC, cg.created_at DESC
  `).all(user.id);
  
  return NextResponse.json(groups);
}

async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { name, priority = 3 } = body;

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const db = getDb();
  return db.transaction(() => {
    assertGuestCapacity(user, 'comparison_groups', db);
    const result = db.prepare('INSERT INTO comparison_groups (user_id, name, priority) VALUES (?, ?, ?)').run(user.id, name, priority);
  
    const group = db.prepare('SELECT * FROM comparison_groups WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(group, { status: 201 });
  }).immediate();
}

export const GET = withAccess(handleGET, true);
export const POST = withAccess(handlePOST, true);
