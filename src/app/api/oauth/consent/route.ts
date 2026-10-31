import { NextRequest, NextResponse } from 'next/server';
import { approveAuthorizePending, OAUTH_CSRF_COOKIE } from '@/lib/agent-oauth';
import { guestErrorResponse, requireSameOrigin } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

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

    const pendingId = typeof body.pending_id === 'string' ? body.pending_id : '';
    const decision = body.decision === 'deny' ? 'deny' : body.decision === 'approve' ? 'approve' : null;
    const csrfCookie = request.cookies.get(OAUTH_CSRF_COOKIE)?.value || '';
    const csrfBody = typeof body.csrf === 'string' ? body.csrf : '';
    // codeql[js/user-controlled-bypass] — 空入力の 400。許可は CSRF と会員セッションの後。
    if (!pendingId || !decision) {
      throw new GuestError(400, 'INVALID_INPUT', 'pending_id と decision が必要です');
    }
    if (!csrfCookie || csrfCookie !== csrfBody) {
      throw new GuestError(403, 'invalid_csrf', 'CSRF トークンが不正です');
    }

    const { redirectUrl } = approveAuthorizePending(pendingId, csrfBody, user.id, decision);
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
