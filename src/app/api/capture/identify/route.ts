import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { withCapture, withCaptureAi } from '@/lib/capture-flags';
import { type CaptureErrorBody } from '@/lib/capture/contract';
import { readCapturePhoto } from '@/lib/capture/photo';
import { portsForRequest } from '@/lib/capture/ports';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: CaptureErrorBody, status: number) {
  return NextResponse.json(error, { status });
}

// 再エンコードした JPEG だけを推定に渡す。元の写真は保存もログもしない。
async function handlePOST(request: NextRequest) {
  requireSameOrigin(request);
  const photo = await readCapturePhoto(request);
  if (!photo.ok) return errorResponse(photo.error, photo.status);
  const result = await portsForRequest(request.headers.get('x-capture-fake-scenario')).identifier.identify(photo.value);
  if (!result.ok) return errorResponse(result.error, result.status);
  return NextResponse.json(result.value);
}

export const POST = withCapture(withCaptureAi(withAccess(handlePOST)));
