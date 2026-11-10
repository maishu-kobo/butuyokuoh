import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { addAgentItemByUrl, assertAgentUrlAddPreflight } from '@/lib/agent-items';
import { withMemoFollowUp } from '@/lib/agent-memo';
import { withAgentNotice } from '@/lib/agent-response';
import { consumeAgentRates, recordAgentAudit, requireAgentToken, touchAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/** URL で追加。複数 URL または既存品目への店追加は写真グループにまとめる。価格・画像はサーバ取得のみ。 */
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON ボディが必要です');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new GuestError(400, 'INVALID_INPUT', 'JSON オブジェクトが必要です');
    }

    // 認証だけ先に。件数・attach 検査のあと、全バケットをまとめて消費する。
    const auth = await requireAgentToken(request, 'write');
    const { units } = assertAgentUrlAddPreflight(auth.userId, body);
    consumeAgentRates(auth.token.id, ['add', 'add_url', 'add_day'], units);
    touchAgentToken(auth.token.id);
    recordAgentAudit(auth.token.id, auth.userId, 'items.add_url', {
      scope: 'write',
      url_count: units,
    });

    const result = await addAgentItemByUrl(auth, body);
    return NextResponse.json(withAgentNotice(withMemoFollowUp(result, {
      kind: 'add',
      requestedNotes: body.notes,
    })), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
