import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse, parseDecimalRouteId } from '@/lib/api-access';
import { purgeAgentItem, trashAgentItem } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

// ゴミ箱へ移す（ソフトデリート）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAgentToken(request, 'write', {
      auditAction: 'items.trash',
    });
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
    }
    const item = trashAgentItem(auth, id);
    return NextResponse.json(withAgentNotice({ item }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}

// ゴミ箱内の品目 1 件を完全削除（#381）。MCP の purge_item と同じ関数。
// ゴミ箱に無い品目は 409 ITEM_NOT_TRASHED で、何も消さない。ゴミ箱全件の削除は無い。
// パスの id は10進の数字だけ。items.purge の操作ログは purgeAgentItem が削除と同じトランザクションで書く。
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAgentToken(request, 'write');
    const { id: raw } = await params;
    const id = parseDecimalRouteId(raw);
    if (id == null) {
      throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
    }
    return NextResponse.json(withAgentNotice(purgeAgentItem(auth, id)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
