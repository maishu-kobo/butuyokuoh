import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { withCapture } from '@/lib/capture-flags';
import { CaptureMessages, parseSearchQuery, type CaptureErrorBody } from '@/lib/capture/contract';
import { searchWithPorts } from '@/lib/capture/fakes';
import { httpsReferer, resolveSearchPorts, saveSearchCandidates } from '@/lib/capture/live-search';
import { portsForRequest } from '@/lib/capture/ports';
import { amazonAssociateTag, readCaptureSecrets } from '@/lib/capture-secrets';
import { searchAttribution } from '@/lib/capture/search-attribution';
import { getDb } from '@/lib/db';
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
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  // 開発サーバのテストは偽物の候補のまま。本番の NODE_ENV ではヘッダーを見ない。
  const useFakes = process.env.NODE_ENV !== 'production' && process.env.CAPTURE_TEST_HOOKS === '1';
  const secrets = readCaptureSecrets();
  const ports = useFakes
    ? portsForRequest(request.headers.get('x-capture-fake-scenario'))
    : resolveSearchPorts({
        yahooAppId: secrets.yahooAppId,
        rakutenAppId: secrets.rakutenAppId,
        rakutenAccessKey: secrets.rakutenAccessKey,
        rakutenAffiliateId: secrets.rakutenAffiliateId,
        userId: String(user.id),
        referer: httpsReferer(request.headers.get('origin')),
      });
  const result = await searchWithPorts(parsed.value, ports, amazonAssociateTag());
  const attribution = searchAttribution(result);
  if (!result.ok) return NextResponse.json({ ...result.error, attribution }, { status: result.status });
  const saved = saveSearchCandidates(getDb(), user.id, parsed.value, result.value);
  if (!saved) return NextResponse.json({ ...result.value, attribution });
  return NextResponse.json({
    ...result.value,
    attribution,
    captureId: saved.captureId,
    candidates: result.value.candidates.map((candidate, index) => ({
      ...candidate,
      candidateId: saved.storedIds[index],
    })),
  });
}

export const POST = withCapture(withAccess(handlePOST));
