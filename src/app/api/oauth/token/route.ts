import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeAuthorizationCode,
  readFormBody,
  refreshAccessToken,
} from '@/lib/agent-oauth';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

function tokenEndpointError(status: number, code: string, description: string) {
  return NextResponse.json(
    { error: code, error_description: description },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}

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

    const grantType = params.get('grant_type');
    const clientId = params.get('client_id');
    if (!clientId) return tokenEndpointError(400, 'invalid_request', 'client_id が必要です');
    const clientSecret = params.get('client_secret');

    if (grantType === 'authorization_code') {
      const code = params.get('code');
      const redirectUri = params.get('redirect_uri');
      const codeVerifier = params.get('code_verifier');
      const resource = params.get('resource');
      if (!code || !redirectUri || !codeVerifier || !resource) {
        return tokenEndpointError(400, 'invalid_request', 'code / redirect_uri / code_verifier / resource が必要です');
      }
      const tokens = exchangeAuthorizationCode(
        {
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
          resource,
          client_secret: clientSecret,
        },
        undefined,
        request.url,
      );
      return NextResponse.json(tokens, {
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.get('refresh_token');
      const resource = params.get('resource');
      if (!refreshToken || !resource) {
        return tokenEndpointError(400, 'invalid_request', 'refresh_token と resource が必要です');
      }
      const tokens = refreshAccessToken(
        {
          refresh_token: refreshToken,
          client_id: clientId,
          resource,
          client_secret: clientSecret,
          scope: params.get('scope'),
        },
        undefined,
        request.url,
      );
      return NextResponse.json(tokens, {
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return tokenEndpointError(400, 'unsupported_grant_type', 'grant_type が不正です');
  } catch (error) {
    if (error instanceof GuestError) {
      const code = error.code.includes('_') && !error.code.startsWith('AGENT_')
        ? error.code
        : error.status === 401
          ? 'invalid_client'
          : 'invalid_grant';
      return tokenEndpointError(error.status === 403 ? 400 : error.status, code, error.message);
    }
    console.error('OAuth token error:', error);
    return tokenEndpointError(500, 'server_error', 'トークン発行に失敗しました');
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
