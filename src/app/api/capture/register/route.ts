import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { withCapture } from '@/lib/capture-flags';
import { CaptureMessages, type CaptureErrorBody } from '@/lib/capture/contract';
import { registerCapturedCandidates } from '@/lib/capture/register';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: CaptureErrorBody, status: number) {
  return NextResponse.json(error, { status });
}

async function handlePOST(request: NextRequest) {
  requireSameOrigin(request);
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > 8192) {
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.registerInput }, 400);
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.registerInput }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.registerInput }, 400);
  }
  const result = registerCapturedCandidates(getDb(), user.id, (body as { candidateIds?: unknown }).candidateIds);
  if (!result.ok) return NextResponse.json(result.error, { status: result.status });
  return NextResponse.json({
    comparisonGroupId: result.comparisonGroupId,
    itemIds: result.itemIds,
    skipped: result.skipped,
  }, { status: result.created ? 201 : 200 });
}

export const POST = withCapture(withAccess(handlePOST));
