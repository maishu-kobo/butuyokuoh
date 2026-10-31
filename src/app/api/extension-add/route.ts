import { assertOwnedRelations, guestErrorResponse, validateMemberInput } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getUserIdFromToken } from '@/lib/auth';
import { fetchServerItemMedia, normalizeItemName, sanitizeStoredItemUrl } from '@/lib/item-input';
import { ITEM_URL_ERROR } from '@/lib/http-url';

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

    if (!item || typeof item.name !== 'string' || typeof item.url !== 'string') {
      return NextResponse.json(
        { error: '商品名とURLは必須です' },
        { status: 400, headers: corsHeaders }
      );
    }

    const name = normalizeItemName(item.name);
    const url = sanitizeStoredItemUrl(item.url);
    if (!name || !url) {
      return NextResponse.json(
        { error: !url ? ITEM_URL_ERROR : '商品名とURLは必須です' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 価格と画像はクライアント値を使わない（サーバ取得を優先）。優先度などだけ検証する。
    const fields: Record<string, unknown> = { name, url };
    if (item.priority !== undefined) fields.priority = item.priority;
    validateMemberInput(fields, 'POST');

    const db = getDb();
    assertOwnedRelations(db, userId, { category_id: item.categoryId ? Number(item.categoryId) : null });

    // 重複チェック
    // ゴミ箱の行も UNIQUE(user_id, url) に残る。ここを外すと INSERT が 500 になる。
    const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(userId, url) as { id: number } | undefined;
    if (existing) {
      return NextResponse.json(
        { error: 'この商品はすでに登録されています' },
        { status: 409, headers: corsHeaders }
      );
    }

    const media = await fetchServerItemMedia(url);
    const priority = item.priority || 3;

    // アイテムを追加（価格・画像はサーバ取得のみ。取れなければ空）
    const result = db.prepare(`
      INSERT INTO items (
        user_id, name, url, image_url, current_price, original_price,
        source, source_name, priority, category_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      name,
      url,
      media.imageUrl,
      media.price,
      media.price,
      media.source,
      media.sourceName,
      priority,
      item.categoryId || null
    );

    // 価格履歴を記録
    if (media.price && result.lastInsertRowid) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(
        result.lastInsertRowid,
        media.price
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
    if (error instanceof GuestError) {
      const response = guestErrorResponse(error);
      for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      return response;
    }
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
