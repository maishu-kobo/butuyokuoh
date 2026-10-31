import { NextRequest, NextResponse } from 'next/server';
import { readFormBody, revokeOAuthToken } from '@/lib/agent-oauth';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/** RFC 7009: 成功時は常に 200（トークン不明でも） */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let params: URLSearchParams;
    if (contentType.includes('application/json')) {
      const body = await request.json() as Record<string, unknown>;
      params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') params.set(key, value);
      }
    } else {
      params = await readFormBody(request);
    }

    const token = params.get('token');
    const clientId = params.get('client_id');
    if (!token || !clientId) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'token と client_id が必要です' },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
      );
    }

    revokeOAuthToken({
      token,
      client_id: clientId,
      client_secret: params.get('client_secret'),
      token_type_hint: params.get('token_type_hint'),
    });

    return new NextResponse(null, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    if (error instanceof GuestError && error.status === 401) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: error.message },
        { status: 401, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
      );
    }
    // 不明なトークンは成功扱い
    return new NextResponse(null, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
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
