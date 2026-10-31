import { NextRequest, NextResponse } from 'next/server';
import { approveAuthorizePending, OAUTH_CSRF_COOKIE } from '@/lib/agent-oauth';
import { guestErrorResponse, requireSameOrigin } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

function parseConsentBody(
  body: { pending_id?: unknown; decision?: unknown; csrf?: unknown },
  csrfCookie: string,
): { pendingId: string; decision: 'approve' | 'deny'; csrf: string } {
  const pendingId = typeof body.pending_id === 'string' ? body.pending_id.trim() : '';
  const decision = body.decision === 'deny' ? 'deny' as const : body.decision === 'approve' ? 'approve' as const : null;
  const csrf = typeof body.csrf === 'string' ? body.csrf : '';
  if (pendingId.length < 8 || decision === null || csrf.length < 8) {
    throw new GuestError(400, 'INVALID_INPUT', 'pending_id と decision が必要です');
  }
  if (csrfCookie.length < 8 || csrfCookie !== csrf) {
    throw new GuestError(403, 'invalid_csrf', 'CSRF トークンが不正です');
  }
  return { pendingId, decision, csrf };
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await getCurrentUser();
    if (!user || user.account_type !== 'member') {
      throw new GuestError(401, 'MEMBER_REQUIRED', '会員ログインが必要です');
    }

    let body: { pending_id?: unknown; decision?: unknown; csrf?: unknown };
    try {
      body = await request.json();
    } catch {
      throw new GuestError(400, 'INVALID_INPUT', '入力内容を確認してください');
    }

    const csrfCookie = request.cookies.get(OAUTH_CSRF_COOKIE)?.value || '';
    const input = parseConsentBody(body, csrfCookie);
    const { redirectUrl } = approveAuthorizePending(input.pendingId, input.csrf, user.id, input.decision);
    const response = NextResponse.json({ redirect_url: redirectUrl }, {
      headers: { 'Cache-Control': 'no-store' },
    });
    response.cookies.set(OAUTH_CSRF_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    console.error('OAuth consent error:', error);
    return NextResponse.json({ error: '同意処理に失敗しました' }, { status: 500 });
  }
}
