import { NextRequest, NextResponse } from 'next/server';
import { registerDynamicClient } from '@/lib/agent-oauth';
import { guestErrorResponse } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/** OAuth 2.0 Dynamic Client Registration (RFC 7591) — 公開クライアント向け */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new GuestError(400, 'invalid_client_metadata', 'JSON 本文が必要です');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new GuestError(400, 'invalid_client_metadata', 'JSON オブジェクトが必要です');
    }
    const registered = registerDynamicClient(body as Record<string, unknown>);
    return NextResponse.json(registered, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    if (error instanceof GuestError) {
      const response = guestErrorResponse(error);
      response.headers.set('Access-Control-Allow-Origin', '*');
      // DCR は OAuth エラーコードをトップレベルに出す
      const json = await response.json() as { error?: string; code?: string };
      return NextResponse.json(
        { error: json.code || 'invalid_client_metadata', error_description: json.error },
        { status: error.status, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
      );
    }
    console.error('OAuth register error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: '登録に失敗しました' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
