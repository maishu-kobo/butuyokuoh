import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  
  const history = db.prepare(`
    SELECT * FROM price_history 
    WHERE item_id = ? 
    ORDER BY recorded_at ASC
  `).all(id);
  
  return NextResponse.json(history);
}
