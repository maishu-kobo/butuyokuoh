import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { addAgentItemByUrl, countAgentUrlAddUnits } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
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

    // 認証を先に。店 URL 件数分をまとめて消費し、上限超えは保存前に 429。
    const rateUnits = countAgentUrlAddUnits(body);
    const auth = await requireAgentToken(request, 'write', {
      rate: ['add', 'add_url', 'add_day'],
      rateUnits,
      auditAction: 'items.add_url',
      auditMeta: { url_count: rateUnits },
    });
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
