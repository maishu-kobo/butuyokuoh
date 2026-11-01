import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { getAgentPriceHistory } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAgentToken(request, 'read', { rate: 'read' });
    const { id: raw } = await params;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
    }
    const history = getAgentPriceHistory(auth.userId, id);
    return NextResponse.json(withAgentNotice({ item_id: id, history }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
