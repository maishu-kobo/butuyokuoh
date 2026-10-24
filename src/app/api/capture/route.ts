import { captureFeatureResponse, captureStatusResponse } from '@/lib/capture-flags';

/** Public gate. Clients show the photo-capture entry only when `enabled` is true. */
export function GET() {
  return captureStatusResponse();
}

/** Feature calls stay rejected until CAPTURE_ENABLED=true. */
export function POST() {
  return captureFeatureResponse();
}
