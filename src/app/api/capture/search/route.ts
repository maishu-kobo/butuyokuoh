import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { CaptureMessages, parseSearchQuery, type CaptureErrorBody } from '@/lib/capture/contract';
import { searchWithPorts } from '@/lib/capture/fakes';
import { getCapturePorts } from '@/lib/capture/ports';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: CaptureErrorBody, status: number) {
  return NextResponse.json(error, { status });
}

async function handlePOST(request: NextRequest) {
  requireSameOrigin(request);
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 8192) {
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.searchInput }, 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.searchInput }, 400);
  }
  const parsed = parseSearchQuery(body);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  const result = await searchWithPorts(parsed.value, getCapturePorts(), process.env.AMAZON_ASSOCIATE_TAG);
  if (!result.ok) return errorResponse(result.error, result.status);
  return NextResponse.json(result.value);
}

export const POST = withAccess(handlePOST);
