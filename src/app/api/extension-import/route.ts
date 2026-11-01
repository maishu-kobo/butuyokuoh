import { validateMemberInput, guestErrorResponse } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  applyExtensionAuthHeaders,
  extensionCorsHeaders,
  resolveExtensionAuth,
} from '@/lib/extension-auth';
import { markItemAddedByAgent, recordAgentAudit } from '@/lib/agent-token';
import { requireExtensionImportItems } from '@/lib/extension-item-input';
import { cleanedStoredItemUrlTaken, normalizeItemName, sanitizeStoredItemUrl } from '@/lib/item-input';

// 既知の課題: 一括 import はまだクライアントの価格・画像を保存する。
// サーバ取得に揃えると件数・タイムアウトの影響が大きいため、別 Issue で扱う（PR #275）。

const corsHeaders = extensionCorsHeaders('POST, OPTIONS');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, items, token } = body as { source: string; items: unknown; token?: string };

    // 認証を先に通す（偽造トークンは 401）。
    const auth = resolveExtensionAuth(request, {
      bodyToken: token,
      rate: ['add', 'add_day'],
    });
    const userId = auth.userId;
    if (!userId) {
      return NextResponse.json(
        { error: '無効なトークンです' },
        { status: 401, headers: corsHeaders }
      );
    }

    const importItems = requireExtensionImportItems(items);

    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (user_id, name, url, image_url, current_price, original_price, source, source_name, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const priceHistoryStmt = db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)');

    let imported = 0;
    let skipped = 0;

    const sourceName = source === 'amazon' ? 'Amazon' : source === 'rakuten' ? '楽天市場' : source;

    for (const item of importItems) {
      try {
        const url = typeof item.url === 'string' ? sanitizeStoredItemUrl(item.url) : null;
        const name = typeof item.name === 'string' ? normalizeItemName(item.name) : null;
        if (!url || !name) {
          skipped++;
          continue;
        }

        const fields: Record<string, unknown> = { url, name };
        if (item.price !== undefined) fields.price = item.price;
        if (item.imageUrl !== undefined) fields.image_url = item.imageUrl;
        validateMemberInput(fields, 'POST');

        // 既存チェック（トラッキング付きの保存 URL もクリーン後で同じならスキップ）
        if (cleanedStoredItemUrlTaken(db, userId, url)) {
          skipped++;
          continue;
        }

        const result = insertStmt.run(
          userId,
          name,
          url,
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
          if (auth.agent) {
            markItemAddedByAgent(Number(result.lastInsertRowid), auth.agent.token.id, userId, db);
          }
        }
      } catch (e) {
        if (e instanceof GuestError) {
          skipped++;
          continue;
        }
        console.error('Error inserting item:', e);
      }
    }

    const headers = { ...corsHeaders };
    applyExtensionAuthHeaders(headers, auth);
    const payload: Record<string, unknown> = {
      success: true,
      total: importItems.length,
      imported,
      skipped,
    };
    if (auth.legacyDeprecated) {
      payload.auth_warning = 'legacy_jwt_deprecated';
    }
    if (auth.agent && imported > 0) {
      recordAgentAudit(auth.agent.token.id, userId, 'extension.import', {
        scope: 'extension',
        imported,
        skipped,
      }, db);
    }

    return NextResponse.json(payload, { headers });
  } catch (error) {
    if (error instanceof GuestError) {
      const response = guestErrorResponse(error);
      for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      return response;
    }
    console.error('Extension import error:', error);
    return NextResponse.json(
      { error: 'インポートに失敗しました' },
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
