import { assertOwnedRelations, guestErrorResponse, validateMemberInput } from '@/lib/api-access';
import { consumeGuestRate, GuestError } from '@/lib/guest';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  applyExtensionAuthHeaders,
  extensionCorsHeaders,
  resolveExtensionAuth,
} from '@/lib/extension-auth';
import { markItemAddedByAgent, recordAgentAudit } from '@/lib/agent-token';
import { requireExtensionAddItem } from '@/lib/extension-item-input';
import {
  cleanedStoredItemUrlTaken,
  fetchServerItemMedia,
  SERVER_ITEM_MEDIA_TIMEOUT_MS,
} from '@/lib/item-input';

interface AddItemRequest {
  token?: string;
  item: {
    name: string;
    url: string;
    price: number | null;
    imageUrl: string | null;
    priority: number;
    categoryId: string | null;
  };
}

const corsHeaders = extensionCorsHeaders('POST, OPTIONS');

function extensionAddsPerMinute(): number {
  const raw = process.env.EXTENSION_ADDS_PER_MINUTE;
  if (!raw) return 20;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 20;
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AddItemRequest;
    const { token, item } = body;

    // 認証を先に通す（偽造トークンは 401。e2e / #275 と同じ順序）。
    const auth = resolveExtensionAuth(request, {
      bodyToken: token,
      rate: ['add', 'add_url', 'add_day'],
    });
    const userId = auth.userId;
    if (!userId) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401, headers: corsHeaders }
      );
    }

    const parsed = requireExtensionAddItem(item);
    const { name, url, priority, categoryId } = parsed;

    const fields: Record<string, unknown> = { name, url };
    if (item?.priority !== undefined) fields.priority = item.priority;
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

    assertOwnedRelations(db, userId, { category_id: categoryId ? Number(categoryId) : null });

    // ゴミ箱の行も UNIQUE(user_id, url) に残る。汚い保存 URL もクリーン後で見る。
    if (cleanedStoredItemUrlTaken(db, userId, url)) {
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
      priority || 3,
      categoryId || null
    );

    if (media.price && result.lastInsertRowid) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(
        result.lastInsertRowid,
        media.price
      );
    }

    if (auth.agent && result.lastInsertRowid) {
      const itemId = Number(result.lastInsertRowid);
      markItemAddedByAgent(itemId, auth.agent.token.id, userId, db);
      recordAgentAudit(auth.agent.token.id, userId, 'extension.add', {
        scope: 'extension',
        item_id: itemId,
      }, db);
    }

    const headers = { ...corsHeaders };
    applyExtensionAuthHeaders(headers, auth);
    const payload: Record<string, unknown> = {
      success: true,
      id: result.lastInsertRowid,
      message: '追加しました',
    };
    if (auth.legacyDeprecated) {
      payload.auth_warning = 'legacy_jwt_deprecated';
    }

    return NextResponse.json(payload, { headers });
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
