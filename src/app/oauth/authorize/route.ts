import { NextRequest, NextResponse } from 'next/server';
import {
  createAuthorizePending,
  OAUTH_CSRF_COOKIE,
  oauthIssuer,
} from '@/lib/agent-oauth';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/**
 * 認可エンドポイント。クエリを検証して pending を作り、同意 UI へ内部リダイレクトする。
 * GET /oauth/authorize?... → 302 /oauth/authorize/consent?pending=...
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const responseType = url.searchParams.get('response_type') || '';
  const scope = url.searchParams.get('scope') || 'read write';
  const state = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';
  const resource = url.searchParams.get('resource') || '';

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
  ].join('; ');

  const errorHeaders = {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  };

  try {
    // codeql[js/user-controlled-bypass] — resource 欠落の 400。認可コードは同意と PKCE の後。
    if (!resource) {
      throw new GuestError(400, 'invalid_request', 'resource パラメータが必要です');
    }
    const { pendingId, csrf } = await createAuthorizePending(
      {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        resource,
        state,
        response_type: responseType,
      },
      undefined,
      undefined,
      request.url,
    );

    const consent = new URL('/oauth/authorize/consent', oauthIssuer(request.url));
    consent.searchParams.set('pending', pendingId);
    const response = NextResponse.redirect(consent, 302);
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(OAUTH_CSRF_COOKIE, csrf, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 15 * 60,
    });
    return response;
  } catch (error) {
    // redirect_uri が信頼できるときだけそこに error を返す。そうでなければ HTML。
    if (
      error instanceof GuestError
      && redirectUri
      && clientId
      && responseType === 'code'
    ) {
      try {
        const { getDb } = await import('@/lib/db');
        const oauth = await import('@/lib/agent-oauth');
        const db = getDb();
        const client = db.prepare('SELECT * FROM agent_oauth_clients WHERE client_id = ?').get(clientId) as
          | import('@/lib/agent-oauth').OAuthClientRow
          | undefined;
        if (client && !client.revoked_at && oauth.clientAllowsRedirect(client, redirectUri)) {
          const target = new URL(redirectUri);
          target.searchParams.set('error', error.code === 'unsupported_response_type' ? error.code : 'invalid_request');
          target.searchParams.set('error_description', error.message);
          if (state) target.searchParams.set('state', state);
          const response = NextResponse.redirect(target.toString(), 302);
          response.headers.set('Content-Security-Policy', csp);
          response.headers.set('Cache-Control', 'no-store');
          return response;
        }
      } catch {
        /* fall through to HTML */
      }
    }

    const message = error instanceof GuestError ? error.message : '認可リクエストが不正です';
    return new NextResponse(
      `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>認可エラー</title></head><body><h1>認可エラー</h1><p>${escapeHtml(message)}</p></body></html>`,
      { status: 400, headers: { ...errorHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
