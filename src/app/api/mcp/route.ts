import { NextRequest, NextResponse } from 'next/server';
import {
  handleMcpJsonRpc,
  mcpAuthFailureResponse,
  mcpCorsHeaders,
  mcpJsonResponse,
  MCP_PROTOCOL_VERSION,
} from '@/lib/agent-mcp';
import { guestErrorResponse } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/**
 * リモート MCP（Streamable HTTP, 2025-11-25 互換）。
 * Authorization: Bearer byoagt_…（PAT または OAuth アクセス・トークン）。
 * 未認証時は 401 + WWW-Authenticate（Protected Resource Metadata）。
 */
export async function POST(request: NextRequest) {
  const cors = mcpCorsHeaders(request);
  try {
    const accept = request.headers.get('accept') || '';
    // クライアントは application/json と text/event-stream の両方を受け入れる必要があるが、
    // 簡易クライアント向けに欠落も許容し、常に JSON で返す。
    void accept;

    let message: unknown;
    try {
      message = await request.json();
    } catch {
      return mcpJsonResponse(
        400,
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        cors,
        request.url,
      );
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return mcpJsonResponse(
        400,
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
        cors,
        request.url,
      );
    }

    const result = await handleMcpJsonRpc(request, message as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: unknown;
    });
    // 認証失敗は HTTP 401 + resource_metadata（MCP OAuth 発見）
    if (
      result.status === 401
      || (
        result.body
        && typeof result.body === 'object'
        && 'error' in result.body
        && (result.body as { error?: { data?: { httpStatus?: number } } }).error?.data?.httpStatus === 401
      )
    ) {
      return mcpAuthFailureResponse(request, result.body, cors);
    }
    return mcpJsonResponse(result.status, result.body, cors, request.url);
  } catch (error) {
    if (error instanceof GuestError) {
      if (error.status === 401) {
        return withCors(
          mcpJsonResponse(401, { error: error.message, code: error.code }, cors, request.url),
          cors,
        );
      }
      return withCors(guestErrorResponse(error), cors);
    }
    console.error('MCP POST error:', error);
    return mcpJsonResponse(
      500,
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
      cors,
      request.url,
    );
  }
}

/** サーバ起動メッセージ用 SSE は未対応。2025-11-25 の最小実装として 405。 */
export async function GET(request: NextRequest) {
  return new NextResponse(null, {
    status: 405,
    headers: {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      ...mcpCorsHeaders(request),
    },
  });
}

export async function DELETE(request: NextRequest) {
  return new NextResponse(null, {
    status: 405,
    headers: {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      ...mcpCorsHeaders(request),
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: mcpCorsHeaders(request),
  });
}

function withCors(response: NextResponse, cors: HeadersInit): NextResponse {
  for (const [key, value] of Object.entries(cors)) {
    response.headers.set(key, String(value));
  }
  return response;
}
