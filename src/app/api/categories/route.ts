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
  const categories = db.prepare(`
    SELECT c.*, COUNT(i.id) as item_count
    FROM categories c
    LEFT JOIN items i ON c.id = i.category_id AND i.user_id = c.user_id AND i.is_purchased = 0 AND i.deleted_at IS NULL
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `).all(user.id);

  return NextResponse.json(categories);
}

async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { name, color = '#6b7280', icon } = await request.json();

  if (!name || !name.trim()) {
    return NextResponse.json({ error: 'カテゴリ名は必須です' }, { status: 400 });
  }

  const db = getDb();

  return db.transaction(() => {
    assertGuestCapacity(user, 'categories', db);
    // 重複チェック
    const existing = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(user.id, name.trim());
    if (existing) {
      return NextResponse.json({ error: '同じ名前のカテゴリが既に存在します' }, { status: 400 });
    }

    // sort_orderを取得
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM categories WHERE user_id = ?').get(user.id) as { max: number | null };
    const sortOrder = (maxOrder?.max ?? -1) + 1;

    const result = db.prepare(`
      INSERT INTO categories (user_id, name, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, name.trim(), color, icon || null, sortOrder);

    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(category, { status: 201 });
  }).immediate();
}

export const GET = withAccess(handleGET, true);
export const POST = withAccess(handlePOST, true);
