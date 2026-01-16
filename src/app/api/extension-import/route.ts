import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

interface ImportItem {
  name: string;
  url: string;
  price: number | null;
  imageUrl: string | null;
}

export async function POST(request: NextRequest) {
  // CORSヘッダー
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json();
    const { source, items } = body as { source: string; items: ImportItem[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'インポートするアイテムがありません' },
        { status: 400, headers }
      );
    }

    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (name, url, image_url, current_price, original_price, source, source_name, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const priceHistoryStmt = db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)');

    let imported = 0;
    let skipped = 0;

    const sourceName = source === 'amazon' ? 'Amazon' : source === 'rakuten' ? '楽天市場' : source;

    for (const item of items) {
      try {
        // 既存チェック
        const existing = db.prepare('SELECT id FROM items WHERE url = ?').get(item.url);
        if (existing) {
          skipped++;
          continue;
        }

        const result = insertStmt.run(
          item.name,
          item.url,
          item.imageUrl,
          item.price,
          item.price,
          source,
          sourceName,
          3 // デフォルト優先度
        );

        if (result.changes > 0) {
          imported++;
          if (item.price) {
            priceHistoryStmt.run(result.lastInsertRowid, item.price);
          }
        }
      } catch (e) {
        console.error('Error inserting item:', e);
      }
    }

    return NextResponse.json(
      {
        success: true,
        total: items.length,
        imported,
        skipped,
      },
      { headers }
    );
  } catch (error) {
    console.error('Extension import error:', error);
    return NextResponse.json(
      { error: 'インポートに失敗しました' },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
