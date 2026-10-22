import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages, decodeCapturePhoto, type CaptureErrorBody } from '@/lib/capture/contract';
import { getCapturePorts } from '@/lib/capture/ports';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: CaptureErrorBody, status: number) {
  return NextResponse.json(error, { status });
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
  const files = form.getAll('photo').filter((part): part is File => part instanceof File);
  if (files.length !== 1) return errorResponse({ code: 'INVALID_INPUT', error: CaptureMessages.onePhoto }, 400);
  const file = files[0];
  if (file.size > CAPTURE_PHOTO_MAX_BYTES) {
    return errorResponse({ code: 'PHOTO_TOO_LARGE', error: CaptureMessages.photoTooLarge }, 413);
  }
  const photo = decodeCapturePhoto([{ mediaType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }]);
  if (!photo.ok) return errorResponse(photo.error, photo.status);
  const result = await getCapturePorts().identifier.identify(photo.value);
  if (!result.ok) return errorResponse(result.error, result.status);
  return NextResponse.json(result.value);
}

export const POST = withAccess(handlePOST);
