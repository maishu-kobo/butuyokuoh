import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getUserIdFromToken } from '@/lib/auth';

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const body = await request.json();
    const { source, items, token } = body as { source: string; items: ImportItem[]; token?: string };

    // トークンからユーザーIDを取得
    if (!token) {
      return NextResponse.json(
        { error: '認証トークンが必要です' },
        { status: 401, headers }
      );
    }

    const userId = getUserIdFromToken(token);
    if (!userId) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401, headers }
      );
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'インポートするアイテムがありません' },
        { status: 400, headers }
      );
    }

    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (user_id, name, url, image_url, current_price, original_price, source, source_name, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const priceHistoryStmt = db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)');

    let imported = 0;
    let skipped = 0;

    const sourceName = source === 'amazon' ? 'Amazon' : source === 'rakuten' ? '楽天市場' : source;

    for (const item of items) {
      try {
        // 既存チェック
        const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(userId, item.url);
        if (existing) {
          skipped++;
          continue;
        }

        const result = insertStmt.run(
          userId,
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
