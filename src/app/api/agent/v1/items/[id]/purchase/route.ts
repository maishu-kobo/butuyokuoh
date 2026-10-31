import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { purchaseAgentItem } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAgentToken(request, 'write', {
      auditAction: 'items.purchase',
    });
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
    }
    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON ボディが不正です');
    }
    const item = purchaseAgentItem(auth, id, body);
    return NextResponse.json(withAgentNotice(item), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
