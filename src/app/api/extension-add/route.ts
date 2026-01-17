import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getUserIdFromToken } from '@/lib/auth';

interface AddItemRequest {
  token: string;
  item: {
    name: string;
    url: string;
    price: number | null;
    imageUrl: string | null;
    priority: number;
    categoryId: string | null;
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AddItemRequest;
    const { token, item } = body;

    // トークンからユーザーIDを取得
    if (!token) {
      return NextResponse.json(
        { error: '認証トークンが必要です' },
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = getUserIdFromToken(token);
    if (!userId) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401, headers: corsHeaders }
      );
    }

    if (!item || !item.name || !item.url) {
      return NextResponse.json(
        { error: '商品名とURLは必須です' },
        { status: 400, headers: corsHeaders }
      );
    }

    const db = getDb();

    // 重複チェック
    const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ? AND deleted_at IS NULL').get(userId, item.url) as { id: number } | undefined;
    if (existing) {
      return NextResponse.json(
        { error: 'この商品はすでに登録されています' },
        { status: 409, headers: corsHeaders }
      );
    }

    // ソースを判定
    let source = 'other';
    let sourceName = 'その他';
    if (item.url.includes('amazon.co.jp') || item.url.includes('amazon.com')) {
      source = 'amazon';
      sourceName = 'Amazon';
    } else if (item.url.includes('rakuten.co.jp')) {
      source = 'rakuten';
      sourceName = '楽天市場';
    }

    // アイテムを追加
    const result = db.prepare(`
      INSERT INTO items (
        user_id, name, url, image_url, current_price, original_price,
        source, source_name, priority, category_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      item.name,
      item.url,
      item.imageUrl,
      item.price,
      item.price,
      source,
      sourceName,
      item.priority || 3,
      item.categoryId || null
    );

    // 価格履歴を記録
    if (item.price && result.lastInsertRowid) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(
        result.lastInsertRowid,
        item.price
      );
    }

    return NextResponse.json(
      {
        success: true,
        id: result.lastInsertRowid,
        message: '追加しました',
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Extension add error:', error);
    return NextResponse.json(
      { error: '追加に失敗しました' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
