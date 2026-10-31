import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { addAgentItemByUrl } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/** URL で追加。価格・画像はサーバ取得のみ。失敗時は名前と URL だけ。 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAgentToken(request, 'write', {
      rate: ['add', 'add_url', 'add_day'],
      auditAction: 'items.add_url',
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
    const result = await addAgentItemByUrl(auth, body);
    return NextResponse.json(withAgentNotice(result), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
