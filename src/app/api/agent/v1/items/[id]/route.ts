import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { getAgentItem, updateAgentItem } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  return id;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAgentToken(request, 'read', { rate: 'read' });
    const { id: raw } = await params;
    const item = getAgentItem(auth.userId, parseId(raw));
    return NextResponse.json(withAgentNotice(item), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAgentToken(request, 'write', {
      auditAction: 'items.update',
    });
    const { id: raw } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON ボディが必要です');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON オブジェクトが必要です');
    }
    const item = updateAgentItem(auth, parseId(raw), body);
    return NextResponse.json(withAgentNotice(item), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
