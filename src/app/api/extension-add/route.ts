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
import {
  cleanedStoredItemUrlTaken,
  fetchServerItemMedia,
  normalizeItemName,
  sanitizeStoredItemUrl,
  SERVER_ITEM_MEDIA_TIMEOUT_MS,
} from '@/lib/item-input';
import { ITEM_URL_ERROR } from '@/lib/http-url';

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

    // 入力の形は認証より先に見る（#275 と同じ）。認可は resolveExtensionAuth だけ。
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

    const auth = resolveExtensionAuth(request, {
      bodyToken: token,
      // URL の有無でレート種別を変えない（user-controlled bypass を避ける）
      rate: ['add', 'add_url', 'add_day'],
    });
    const userId = auth.userId;
    if (!userId) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401, headers: corsHeaders }
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
