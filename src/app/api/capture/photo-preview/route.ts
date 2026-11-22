import { NextRequest, NextResponse } from 'next/server';
import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { readCapturePhoto } from '@/lib/capture/photo';

// A device that cannot decode its own HEIC still gets a preview without starting an AI search.
async function preview(request: NextRequest) {
  requireSameOrigin(request);
  const result = await readCapturePhoto(request);
  if (!result.ok) return NextResponse.json(result.error,{status:result.status});
  return new Response(new Uint8Array(result.value.bytes),{headers:{'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff'}});
}
export const POST = withAccess(preview);
