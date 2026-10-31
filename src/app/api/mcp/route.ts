import { NextRequest, NextResponse } from 'next/server';
import {
  handleMcpJsonRpc,
  mcpCorsHeaders,
  mcpJsonResponse,
  MCP_PROTOCOL_VERSION,
} from '@/lib/agent-mcp';
import { guestErrorResponse } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

/**
 * リモート MCP（Streamable HTTP, 2025-11-25 互換）。
 * Authorization: Bearer byoagt_… のみ（OAuth は #272）。
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
      );
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return mcpJsonResponse(
        400,
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
        cors,
      );
    }

    const result = await handleMcpJsonRpc(request, message as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: unknown;
    });
    return mcpJsonResponse(result.status, result.body, cors);
  } catch (error) {
    if (error instanceof GuestError) return withCors(guestErrorResponse(error), cors);
    console.error('MCP POST error:', error);
    return mcpJsonResponse(
      500,
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
      cors,
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
