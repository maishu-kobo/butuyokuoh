import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { withCapture, withCaptureAi } from '@/lib/capture-flags';
import { amazonAssociateTag, readCaptureSecrets } from '@/lib/capture-secrets';
import { type CaptureErrorBody } from '@/lib/capture/contract';
import { readCapturePhoto } from '@/lib/capture/photo';
import { captureTestEnv, getCapturePorts, portsForRequest } from '@/lib/capture/ports';
import { identifyHttpBody, resolveProductIdentifier } from '@/lib/capture/workers-ai';
import { modelIdFromEnv } from '@/lib/capture/ai-variants';
import { geminiIdentifierForEnv } from '@/lib/capture/gemini';
import { llama4GeminiActors, productionLadderSearch, runGeminiFallback } from '@/lib/capture/gemini-fallback';
import { identifyGroundedVariant } from '@/lib/capture/grounded-variant';
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
  // 既定は Workers AI。根拠の確認と並べ替えは、選んだ variant だけ。
  const testEnv = captureTestEnv();
  const grounded = await identifyGroundedVariant({
    photo: photo.value,
    hooked,
    fake: ports.identifier,
    env: testEnv,
    accountId: secrets.cloudflareAccountId,
    apiToken: secrets.cloudflareApiToken,
    userId,
    search: (product) => productionLadderSearch(product, {
      yahooAppId: secrets.yahooAppId,
      rakutenAppId: secrets.rakutenAppId,
      rakutenAccessKey: secrets.rakutenAccessKey,
      rakutenAffiliateId: secrets.rakutenAffiliateId,
      userId,
      origin: request.headers.get('origin'),
      associateTag: amazonAssociateTag(),
    }),
  });
  if (grounded) {
    const http = identifyHttpBody(grounded);
    return NextResponse.json(http.body, { status: http.status });
  }
  const actors = llama4GeminiActors({
    hooked,
    fake: ports.identifier,
    env: testEnv,
    accountId: secrets.cloudflareAccountId,
    apiToken: secrets.cloudflareApiToken,
    userId,
  });
  if (actors?.kind === 'fake') {
    const http = identifyHttpBody(await actors.identify.identify(photo.value));
    return NextResponse.json(http.body, { status: http.status });
  }
  if (actors?.kind === 'live') {
    const outcome = await runGeminiFallback({
      photo: photo.value,
      primary: actors.primary,
      gemini: actors.gemini,
      search: (product) => productionLadderSearch(product, {
        yahooAppId: secrets.yahooAppId,
        rakutenAppId: secrets.rakutenAppId,
        rakutenAccessKey: secrets.rakutenAccessKey,
        rakutenAffiliateId: secrets.rakutenAffiliateId,
        userId,
        origin: request.headers.get('origin'),
        associateTag: amazonAssociateTag(),
      }),
    });
    const http = identifyHttpBody(outcome.guess);
    return NextResponse.json(http.body, { status: http.status });
  }
  const gemini = geminiIdentifierForEnv({
    hooked,
    fake: ports.identifier,
    env: testEnv,
  });
  const identifier = gemini ?? resolveProductIdentifier({
    hooked,
    accountId: secrets.cloudflareAccountId,
    apiToken: secrets.cloudflareApiToken,
    userId,
    fake: ports.identifier,
    env: testEnv,
    model: modelIdFromEnv(),
  });
  const http = identifyHttpBody(await identifier.identify(photo.value));
  return NextResponse.json(http.body, { status: http.status });
}

export const POST = withCapture(withCaptureAi(withAccess(handlePOST)));
