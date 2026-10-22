import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { getDb } from './db';
import { auth } from '@/auth';
import { findGuest, guestEnabled, GUEST_COOKIE, type GuestUser } from './guest';
import { MEMBER_TOKEN_COOKIE, memberTokenCookieOptions } from './cookie-policy';

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
  sessionGeneration?: number;
}

// 主張が無いトークンは世代 0。列の既定値と同じなので、世代を進める前の正常なログインは残る。
export function sessionGenerationMatches(claimed: unknown, stored: number | null | undefined): boolean {
  const actual = stored ?? 0;
  if (claimed === undefined) return actual === 0;
  return typeof claimed === 'number' && Number.isInteger(claimed) && claimed >= 0 && claimed === actual;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// bcrypt の await 中に Google 連携が確定すると、検証に使った hash はもうその会員のものではない。
// パスワードが合ったあとに hash と世代を一度だけ読み、hash が消えているか変わっていれば拒否する。
// 署名に使ってよいのは、その同じ読み取りの世代だけ。
let afterPasswordConfirmed: (() => void) | undefined;

export async function confirmVerifiedPassword(
  userId: number,
  password: string,
  passwordHash: string,
): Promise<number | null> {
  const valid = await verifyPassword(password, passwordHash);
  if (!valid) return null;
  const row = getDb().prepare(
    `SELECT password_hash, session_generation
     FROM users
     WHERE id = ? AND account_type = 'member'`
  ).get(userId) as { password_hash: string | null; session_generation: number } | undefined;
  if (!row || row.password_hash == null || row.password_hash !== passwordHash) return null;
  const sessionGeneration = row.session_generation ?? 0;
  if (process.env.NODE_ENV !== 'production') afterPasswordConfirmed?.();
  return sessionGeneration;
}

function currentSessionGeneration(userId: number): number {
  const row = getDb().prepare(
    "SELECT session_generation FROM users WHERE id = ? AND account_type = 'member'"
  ).get(userId) as { session_generation: number } | undefined;
  return row?.session_generation ?? 0;
}

export function generateToken(user: User, sessionGeneration?: number): string {
  if (user.account_type !== 'member') throw new Error('Member account required');
  const generation = sessionGeneration ?? currentSessionGeneration(user.id);
  if (!Number.isInteger(generation) || generation < 0) {
    throw new Error('Invalid session generation');
  }
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      sessionGeneration: generation,
    } as JWTPayload,
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
type AuthCookieOptions = ReturnType<typeof memberTokenCookieOptions>;

type TestCookieWriter = {
  set: (name: string, value: string, options?: AuthCookieOptions) => void;
  delete: (name: string, options?: AuthCookieOptions) => void;
  get?: (name: string) => string | undefined;
};

type TestSession = { user?: { id?: string; sessionGeneration?: number } } | null;

let testCurrentUser: { user: CurrentUser | null } | undefined;
let testCookies: TestCookieWriter | null = null;
let testSession: TestSession | undefined;

export function installAuthTestHooks(hooks: null | {
  user?: CurrentUser | null;
  cookies?: TestCookieWriter | null;
  session?: TestSession;
  afterPasswordConfirmed?: () => void;
}): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Auth test hooks are unavailable in production');
  }
  if (hooks === null) {
    testCurrentUser = undefined;
    testCookies = null;
    testSession = undefined;
    afterPasswordConfirmed = undefined;
    return;
  }
  if ('user' in hooks) testCurrentUser = { user: hooks.user ?? null };
  if ('cookies' in hooks) testCookies = hooks.cookies ?? null;
  if ('session' in hooks) testSession = hooks.session ?? null;
  if ('afterPasswordConfirmed' in hooks) afterPasswordConfirmed = hooks.afterPasswordConfirmed;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (process.env.NODE_ENV !== 'production' && testCurrentUser) return testCurrentUser.user;
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    throw new Error('AUTH_SECRET or NEXTAUTH_SECRET is required in production');
  }
  const db = getDb();
  const member = (id: number) => db.prepare(
    "SELECT id, email, name, created_at, account_type, session_generation FROM users WHERE id = ? AND account_type = 'member'"
  ).get(id) as (User & { session_generation: number }) | undefined;
  const accept = (row: (User & { session_generation: number }) | undefined, claimed: unknown): User | null => {
    if (!row || !sessionGenerationMatches(claimed, row.session_generation)) return null;
    return {
      id: row.id,
      account_type: row.account_type,
      email: row.email,
      name: row.name,
      created_at: row.created_at,
    };
  };
  // Configuration failures must not silently turn a member into a guest.
  const session = process.env.NODE_ENV !== 'production' && testSession !== undefined
    ? testSession
    : await auth();
  if (session?.user?.id) {
    const user = accept(member(Number(session.user.id)), session.user.sessionGeneration);
    if (user) return user;
  }
  let token: string | undefined;
  let guestCookie: string | undefined;
  if (process.env.NODE_ENV !== 'production' && testCookies?.get) {
    token = testCookies.get(MEMBER_TOKEN_COOKIE);
    guestCookie = testCookies.get(GUEST_COOKIE);
  } else {
    const cookieStore = await cookies();
    token = cookieStore.get(MEMBER_TOKEN_COOKIE)?.value;
    guestCookie = cookieStore.get(GUEST_COOKIE)?.value;
  }
  if (token) {
    const payload = verifyToken(token);
    const user = payload && accept(member(payload.userId), payload.sessionGeneration);
    if (user) return user;
  }
  return guestEnabled() ? findGuest(guestCookie, db) : null;
}

export async function setAuthCookie(token: string): Promise<void> {
  const options = memberTokenCookieOptions();
  if (process.env.NODE_ENV !== 'production' && testCookies) {
    testCookies.set(MEMBER_TOKEN_COOKIE, token, options);
    return;
  }
  const cookieStore = await cookies();
  cookieStore.set(MEMBER_TOKEN_COOKIE, token, options);
}

export async function clearAuthCookie(): Promise<void> {
  // 発行と同じ名前と属性で消す。Max-Age を 7 日のまま渡すと Next が期限を延ばして残る。
  const options = { ...memberTokenCookieOptions(), maxAge: 0 };
  if (process.env.NODE_ENV !== 'production' && testCookies) {
    testCookies.delete(MEMBER_TOKEN_COOKIE, options);
    return;
  }
  const cookieStore = await cookies();
  cookieStore.delete({ name: MEMBER_TOKEN_COOKIE, ...options });
}

export function getUserIdFromToken(token: string): number | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  const member = getDb().prepare(
    "SELECT id, session_generation FROM users WHERE id = ? AND account_type = 'member'"
  ).get(payload.userId) as { id: number; session_generation: number } | undefined;
  if (!member || !sessionGenerationMatches(payload.sessionGeneration, member.session_generation)) return null;
  return member.id;
}
