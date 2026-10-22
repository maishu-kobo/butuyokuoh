import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { withCapture, withCaptureAi } from '@/lib/capture-flags';
import { readCaptureSecrets } from '@/lib/capture-secrets';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages, decodeCapturePhoto, type CaptureErrorBody } from '@/lib/capture/contract';
import { getCapturePorts, portsForRequest } from '@/lib/capture/ports';
import { identifyHttpBody, resolveProductIdentifier } from '@/lib/capture/workers-ai';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: CaptureErrorBody, status: number) {
  const http = identifyHttpBody({ ok: false, error, status });
  return NextResponse.json(http.body, { status: http.status });
}

// 5MBを超えた本文を流したまま切る処理は #92。ここでは上限を超えるファイルを読まない。
async function handlePOST(request: NextRequest) {
  requireSameOrigin(request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.onePhoto }, 400);
  }
  const files = form.getAll('photo').filter((part): part is File => typeof part !== 'string');
  if (files.length !== 1) return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.onePhoto }, 400);
  const file = files[0];
  if (file.size > CAPTURE_PHOTO_MAX_BYTES) {
    return errorResponse({ code: 'PHOTO_TOO_LARGE', error: CaptureMessages.photoTooLarge }, 413);
  }
  const photo = decodeCapturePhoto([{ mediaType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }]);
  if (!photo.ok) return errorResponse(photo.error, photo.status);
  const ports = portsForRequest(request.headers.get('x-capture-fake-scenario'));
  const secrets = readCaptureSecrets();
  const hooked = ports !== getCapturePorts();
  let userId = '';
  if (!hooked && secrets.cloudflareAccountId && secrets.cloudflareApiToken) {
    const user = await getCurrentUser();
    if (user?.account_type === 'member') userId = String(user.id);
  }
  const identifier = resolveProductIdentifier({
    hooked,
    accountId: secrets.cloudflareAccountId,
    apiToken: secrets.cloudflareApiToken,
    userId,
    fake: ports.identifier,
  });
  const http = identifyHttpBody(await identifier.identify(photo.value));
  return NextResponse.json(http.body, { status: http.status });
}

export const POST = withCapture(withCaptureAi(withAccess(handlePOST)));
