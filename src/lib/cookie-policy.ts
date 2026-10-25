export const MEMBER_TOKEN_COOKIE = 'butuyokuoh_token';
export const MEMBER_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function secureCookie(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'production';
}

export function memberTokenCookieOptions(nodeEnv?: string) {
  return {
    httpOnly: true as const,
    secure: secureCookie(nodeEnv),
    sameSite: 'lax' as const,
    maxAge: MEMBER_TOKEN_MAX_AGE_SECONDS,
    path: '/',
  };
}

export function guestSessionCookieOptions(expiresAt: string | number, nodeEnv?: string) {
  return {
    httpOnly: true as const,
    secure: secureCookie(nodeEnv),
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(expiresAt),
  };
}

export function clearGuestCookieOptions(nodeEnv?: string) {
  return {
    maxAge: 0,
    httpOnly: true as const,
    secure: secureCookie(nodeEnv),
    sameSite: 'lax' as const,
    path: '/',
  };
}
