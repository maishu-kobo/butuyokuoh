import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const groups = db.prepare(`
    SELECT 
      cg.*,
      COUNT(i.id) as item_count
    FROM comparison_groups cg
    LEFT JOIN items i ON i.comparison_group_id = cg.id
    GROUP BY cg.id
    ORDER BY cg.priority ASC, cg.created_at DESC
  `).all();
  
  return NextResponse.json(groups);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, priority = 3 } = body;

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare('INSERT INTO comparison_groups (name, priority) VALUES (?, ?)').run(name, priority);
  
  const group = db.prepare('SELECT * FROM comparison_groups WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(group, { status: 201 });
}
