import { guestErrorResponse } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  applyExtensionAuthHeaders,
  extensionCorsHeaders,
  resolveExtensionAuth,
} from '@/lib/extension-auth';
import { recordAgentAudit } from '@/lib/agent-token';
import { requireExtensionImportItems } from '@/lib/extension-item-input';
import { prepareWishlistImport } from '@/lib/wishlist-import';

// 一括 import はクライアントの価格・画像を保存しない（#276 / #267）。
// 件数が多いとサーバ取得はタイムアウトしやすいので、価格・画像は空で登録する。
// 価格は既存の定期 check-prices が埋める。画像は check-prices では更新されないので、
// 手動の再取得（/api/items/[id]/refresh）まで空のまま（#267 の取得失敗時と同じ）。

const corsHeaders = extensionCorsHeaders('POST, OPTIONS');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, items, token } = body as { source?: unknown; items: unknown; token?: string };

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

    if (typeof source !== 'string' || !source.trim()) {
      throw new GuestError(400, 'INVALID_INPUT', 'インポート元を指定してください');
    }
    const importItems = requireExtensionImportItems(items);

    const db = getDb();
    const { imported, skipped } = db.transaction(() => {
      const save = prepareWishlistImport(db, userId, auth.agent?.token.id);
      let imported = 0;
      let skipped = 0;
      for (const item of importItems) {
        const result = save(item, source);
        if (result.status === 'added' || result.status === 'restored') imported++;
        else skipped++;
      }
      return { imported, skipped };
    }).immediate();

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
