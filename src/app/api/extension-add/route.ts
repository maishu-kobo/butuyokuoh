import { assertOwnedRelations, guestErrorResponse, validateMemberInput } from '@/lib/api-access';
import { consumeGuestRate, GuestError } from '@/lib/guest';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getUserIdFromToken } from '@/lib/auth';
import {
  fetchServerItemMedia,
  normalizeItemName,
  sanitizeStoredItemUrl,
  SERVER_ITEM_MEDIA_TIMEOUT_MS,
} from '@/lib/item-input';
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

function extensionAddsPerMinute(): number {
  const raw = process.env.EXTENSION_ADDS_PER_MINUTE;
  if (!raw) return 20;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 20;
  return parsed;
}

function urlAlreadyStored(db: ReturnType<typeof getDb>, userId: number, cleanedUrl: string): boolean {
  if (db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(userId, cleanedUrl)) {
    return true;
  }
  // 保存済みの汚い URL もクリーン後で同じなら重複とみなす。
  const rows = db.prepare('SELECT url FROM items WHERE user_id = ?').all(userId) as { url: string }[];
  return rows.some((row) => sanitizeStoredItemUrl(row.url) === cleanedUrl);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AddItemRequest;
    const { token, item } = body;

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

    const fields: Record<string, unknown> = { name, url };
    if (item.priority !== undefined) fields.priority = item.priority;
    validateMemberInput(fields, 'POST');

    const db = getDb();
    const user = db.prepare(
      'SELECT id, account_type FROM users WHERE id = ?'
    ).get(userId) as { id: number; account_type: 'member' | 'guest' } | undefined;
    if (!user) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401, headers: corsHeaders }
      );
    }

    try {
      consumeGuestRate(`extension-add:${userId}`, extensionAddsPerMinute(), db);
    } catch (error) {
      if (error instanceof GuestError && error.code === 'GUEST_RATE_LIMITED' && user.account_type === 'member') {
        throw new GuestError(
          429,
          'RATE_LIMITED',
          '追加が集中しています。少し待ってからお試しください。',
          error.retryAfter,
        );
      }
      throw error;
    }

    assertOwnedRelations(db, userId, { category_id: item.categoryId ? Number(item.categoryId) : null });

    // ゴミ箱の行も UNIQUE(user_id, url) に残る。ここを外すと INSERT が 500 になる。
    if (urlAlreadyStored(db, userId, url)) {
      return NextResponse.json(
        { error: 'この商品はすでに登録されています' },
        { status: 409, headers: corsHeaders }
      );
    }

    const media = await fetchServerItemMedia(url, {
      userId,
      accountType: user.account_type,
      timeoutMs: SERVER_ITEM_MEDIA_TIMEOUT_MS,
    });
    const priority = item.priority || 3;

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
