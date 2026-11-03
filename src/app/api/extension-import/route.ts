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

// 一括 import はクライアントの価格・画像を保存しない（#276 / #267）。
// 件数が多いとサーバ取得はタイムアウトしやすいので、価格・画像は空で登録する。
// 価格は既存の定期 check-prices が埋める。画像は check-prices では更新されないので、
// 手動の再取得（/api/items/[id]/refresh）まで空のまま（#267 の取得失敗時と同じ）。

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

        // 価格・画像はクライアント値を渡さない（#267）。
        validateMemberInput({ url, name }, 'POST');

        // 既存チェック（トラッキング付きの保存 URL もクリーン後で同じならスキップ）
        if (cleanedStoredItemUrlTaken(db, userId, url)) {
          skipped++;
          continue;
        }

        const result = insertStmt.run(
          userId,
          name,
          url,
          null,
          null,
          null,
          source,
          sourceName,
          3 // デフォルト優先度
        );

        if (result.changes > 0) {
          imported++;
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
