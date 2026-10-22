import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { getDb } from './db';
import { auth } from '@/auth';
import { findGuest, guestEnabled, GUEST_COOKIE, type GuestUser } from './guest';

const TOKEN_COOKIE_NAME = 'butuyokuoh_token';

// 開発モード専用のフォールバック鍵。リポジトリに公開されている値のため、
// 本番でこの鍵を使うとトークンを偽造される。本番では JWT_SECRET の設定を必須とする。
const DEV_FALLBACK_SECRET = 'butuyokuoh-secret-key-change-in-production';

// 署名・検証鍵は呼び出し時に評価する（フェイルファスト）。
// モジュールトップレベルで throw すると Next.js のビルド（NODE_ENV=production）が
// 落ちる恐れがあるため、トークン発行/検証のタイミングで検証する。
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET environment variable must be set in production. Generate one with: openssl rand -base64 32'
    );
  }
  return DEV_FALLBACK_SECRET;
}

export interface User {
  id: number;
  account_type: 'member';
  email: string;
  name: string | null;
  created_at: string;
}

export interface JWTPayload {
  userId: number;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(user: User): string {
  if (user.account_type !== 'member') throw new Error('Member account required');
  return jwt.sign(
    { userId: user.id, email: user.email } as JWTPayload,
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): JWTPayload | null {
  // 鍵の取得は try の外で行う。本番で JWT_SECRET 未設定の場合に
  // 設定エラーを null（検証失敗）として握りつぶさず、明確に throw させる。
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret) as JWTPayload;
  } catch {
    return null;
  }
}

export type CurrentUser = User | GuestUser;

// ルートをリクエストの外から呼ぶための注入点。next/headers の cookies() は
// リクエストの外では例外になる。本番では使えない。定期実行や通常のAPIはここを通らない。
type TestCookieWriter = {
  set: (name: string, value: string, options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    maxAge?: number;
    path?: string;
  }) => void;
  delete: (name: string) => void;
};

let testCurrentUser: { user: CurrentUser | null } | undefined;
let testCookies: TestCookieWriter | null = null;

export function installAuthTestHooks(hooks: null | {
  user?: CurrentUser | null;
  cookies?: TestCookieWriter | null;
}): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Auth test hooks are unavailable in production');
  }
  if (hooks === null) {
    testCurrentUser = undefined;
    testCookies = null;
    return;
  }
  if ('user' in hooks) testCurrentUser = { user: hooks.user ?? null };
  if ('cookies' in hooks) testCookies = hooks.cookies ?? null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (process.env.NODE_ENV !== 'production' && testCurrentUser) return testCurrentUser.user;
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    throw new Error('AUTH_SECRET or NEXTAUTH_SECRET is required in production');
  }
  const db = getDb();
  const member = (id: number) => db.prepare(
    "SELECT id, email, name, created_at, account_type FROM users WHERE id = ? AND account_type = 'member'"
  ).get(id) as User | undefined;
  // Configuration failures must not silently turn a member into a guest.
  const session = await auth();
  if (session?.user?.id) {
    const user = member(Number(session.user.id));
    if (user) return user;
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE_NAME)?.value;
  if (token) {
    const payload = verifyToken(token);
    const user = payload && member(payload.userId);
    if (user) return user;
  }
  return guestEnabled() ? findGuest(cookieStore.get(GUEST_COOKIE)?.value, db) : null;
}

export async function setAuthCookie(token: string): Promise<void> {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/',
  };
  if (process.env.NODE_ENV !== 'production' && testCookies) {
    testCookies.set(TOKEN_COOKIE_NAME, token, options);
    return;
  }
  const cookieStore = await cookies();
  cookieStore.set(TOKEN_COOKIE_NAME, token, options);
}

export async function clearAuthCookie(): Promise<void> {
  if (process.env.NODE_ENV !== 'production' && testCookies) {
    testCookies.delete(TOKEN_COOKIE_NAME);
    return;
  }
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_COOKIE_NAME);
}

export function getUserIdFromToken(token: string): number | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  const member = getDb().prepare("SELECT id FROM users WHERE id = ? AND account_type = 'member'").get(payload.userId);
  return member ? payload.userId : null;
}
