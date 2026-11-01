import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import {
  addAgentItem,
  listAgentItems,
  type AgentItemStatus,
} from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAgentToken(request, 'read', { rate: 'read' });
    const { searchParams } = request.nextUrl;
    const status = (searchParams.get('status') || 'active') as AgentItemStatus;
    if (!['active', 'trashed', 'purchased', 'all'].includes(status)) {
      throw new GuestError(400, 'INVALID_INPUT', 'status が不正です');
    }
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');
    const result = listAgentItems(auth.userId, {
      q: searchParams.get('q') || undefined,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return NextResponse.json(withAgentNotice(result), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}

/** 項目を指定して追加（価格・画像はサーバ取得。クライアント値は無視）。 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAgentToken(request, 'write', {
      rate: ['add', 'add_day'],
      auditAction: 'items.add',
    });
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON ボディが必要です');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON オブジェクトが必要です');
    }
    const result = await addAgentItem(auth, body);
    return NextResponse.json(withAgentNotice(result), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
