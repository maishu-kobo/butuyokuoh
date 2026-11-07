import { NextRequest, NextResponse } from 'next/server';
import { buildProtectedResourceMetadata } from '@/lib/agent-oauth';

export const runtime = 'nodejs';

/** RFC 9728: パス付きリソース用の well-known（/api/mcp） */
export async function GET(request: NextRequest) {
  return NextResponse.json(buildProtectedResourceMetadata(request.url), {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
