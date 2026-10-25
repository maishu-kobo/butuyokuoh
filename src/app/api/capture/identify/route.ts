import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { withCapture, withCaptureAi } from '@/lib/capture-flags';
import { readCaptureSecrets } from '@/lib/capture-secrets';
import { type CaptureErrorBody } from '@/lib/capture/contract';
import { readCapturePhoto } from '@/lib/capture/photo';
import { captureTestEnv, getCapturePorts, portsForRequest } from '@/lib/capture/ports';
import { identifyHttpBody, resolveProductIdentifier } from '@/lib/capture/workers-ai';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: CaptureErrorBody, status: number) {
  const http = identifyHttpBody({ ok: false, error, status });
  return NextResponse.json(http.body, { status: http.status });
}

// 推定へ渡すのは、縮めて位置情報を落とした JPEG だけ。元の写真は保存もログもしない。
async function handlePOST(request: NextRequest) {
  requireSameOrigin(request);
  const photo = await readCapturePhoto(request);
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
    env: captureTestEnv(),
  });
  const http = identifyHttpBody(await identifier.identify(photo.value));
  return NextResponse.json(http.body, { status: http.status });
}

export const POST = withCapture(withCaptureAi(withAccess(handlePOST)));
