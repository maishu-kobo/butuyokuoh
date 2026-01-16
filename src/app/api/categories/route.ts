import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  const categories = db.prepare(`
    SELECT c.*, COUNT(i.id) as item_count
    FROM categories c
    LEFT JOIN items i ON c.id = i.category_id AND i.is_purchased = 0
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `).all(user.id);

  return NextResponse.json(categories);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { name, color = '#6b7280', icon } = await request.json();

  if (!name || !name.trim()) {
    return NextResponse.json({ error: 'カテゴリ名は必須です' }, { status: 400 });
  }

  const db = getDb();

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
}
