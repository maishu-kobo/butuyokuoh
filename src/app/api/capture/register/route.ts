import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { withCapture } from '@/lib/capture-flags';
import { CaptureMessages, type CaptureErrorBody } from '@/lib/capture/contract';
import { registerCapturedCandidates } from '@/lib/capture/register';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

const MAX_REGISTER_BODY_BYTES = 8192;

function errorResponse(error: CaptureErrorBody, status: number) {
  return NextResponse.json(error, { status });
}

// Content-Length は送り手が書ける。宣言が無くても、実際に読んだバイト数で止める。
async function readRegisterBody(request: NextRequest): Promise<unknown | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_REGISTER_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

async function handlePOST(request: NextRequest) {
  requireSameOrigin(request);
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_REGISTER_BODY_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.registerInput }, 400);
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const body = await readRegisterBody(request);
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
