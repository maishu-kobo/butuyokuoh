import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizationServerMetadata } from '@/lib/agent-oauth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return NextResponse.json(buildAuthorizationServerMetadata(request.url), {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
