import { NextResponse } from 'next/server';

/** Photo capture stays off unless the variable is exactly "true". */
export const CAPTURE_AI_DISABLED_MESSAGE = '写真からの自動の判定は使えません。商品名を入れて探してください';

const FEATURE_DISABLED_MESSAGE = 'この機能は利用できません';

export class CaptureDisabledError extends Error {
  readonly status = 404 as const;
  readonly code = 'CAPTURE_DISABLED' as const;

  constructor() {
    super(FEATURE_DISABLED_MESSAGE);
    this.name = 'CaptureDisabledError';
  }
}

export type CaptureFlags = {
  /** Whole photo-capture feature. The entry is shown only when this is true. */
  enabled: boolean;
  /** Photo identification. Name search stays available when this is false. */
  aiEnabled: boolean;
};

export type CaptureDenial = {
  status: 404 | 503;
  code: 'CAPTURE_DISABLED' | 'CAPTURE_AI_DISABLED';
  error: string;
  fallback: 'manual-entry' | null;
};

// Dynamic lookup so the kill switch is read at runtime. A direct
// `process.env.CAPTURE_ENABLED` access is inlined at build time.
function envFlag(name: string): boolean {
  return process.env[name] === 'true';
}

export function captureFlags(): CaptureFlags {
  const enabled = envFlag('CAPTURE_ENABLED');
  return { enabled, aiEnabled: enabled && envFlag('CAPTURE_AI_ENABLED') };
}

export function denyCaptureFeature(): CaptureDenial | null {
  if (captureFlags().enabled) return null;
  return {
    status: 404,
    code: 'CAPTURE_DISABLED',
    error: FEATURE_DISABLED_MESSAGE,
    fallback: null,
  };
}

export function denyCaptureAi(): CaptureDenial | null {
  const feature = denyCaptureFeature();
  if (feature) return feature;
  if (captureFlags().aiEnabled) return null;
  return {
    status: 503,
    code: 'CAPTURE_AI_DISABLED',
    error: CAPTURE_AI_DISABLED_MESSAGE,
    fallback: 'manual-entry',
  };
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function deniedResponse(denied: CaptureDenial, includeFallback: boolean) {
  const body: Record<string, unknown> = { error: denied.error, code: denied.code };
  if (includeFallback) body.fallback = denied.fallback;
  return noStore(body, denied.status);
}

export function withCapture<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const denied = denyCaptureFeature();
    if (denied) return deniedResponse(denied, false);
    return handler(...args);
  };
}

export function withCaptureAi<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const denied = denyCaptureAi();
    if (denied) return deniedResponse(denied, true);
    return handler(...args);
  };
}

export function captureStatusResponse() {
  return noStore(captureFlags());
}

export function captureFeatureResponse() {
  const denied = denyCaptureFeature();
  if (denied) return deniedResponse(denied, false);
  return noStore(captureFlags());
}
