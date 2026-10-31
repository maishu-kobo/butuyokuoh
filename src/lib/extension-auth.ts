import type { NextRequest } from 'next/server';
import { getUserIdFromToken } from './auth';
import {
  type AgentAuthContext,
  type AgentRateKind,
  extractBearerToken,
  findAgentTokenByPlaintext,
  isAgentTokenPlaintext,
  recordAgentAudit,
  consumeAgentRate,
  tokenHasScope,
  touchAgentToken,
} from './agent-token';
import { getDb } from './db';
import { GuestError } from './guest';

/**
 * ログイン用 JWT を拡張 API で受け付ける移行期間の終了日時（UTC）。
 * env `EXTENSION_LEGACY_JWT_UNTIL`（ISO 8601）で上書きできる。未設定時はこの定数。
 * 終了後は古い JWT を拒否する（#271）。
 */
export const EXTENSION_LEGACY_JWT_DEFAULT_UNTIL = '2026-11-30T00:00:00.000Z';

export const EXTENSION_AUTH_HEADER = 'X-Butuyokuoh-Auth';
export const EXTENSION_AUTH_LEGACY_VALUE = 'legacy-jwt';

export type ExtensionAuthKind = 'extension_token' | 'legacy_jwt';

export interface ExtensionAuthResult {
  userId: number;
  kind: ExtensionAuthKind;
  agent: AgentAuthContext | null;
  /** 移行期間中に古い JWT を使っているとき true */
  legacyDeprecated: boolean;
}

function normalizeRates(rate?: AgentRateKind | AgentRateKind[]): AgentRateKind[] {
  if (!rate) return [];
  return Array.isArray(rate) ? rate : [rate];
}

export function getExtensionLegacyJwtUntilMs(): number {
  const raw = process.env.EXTENSION_LEGACY_JWT_UNTIL?.trim();
  if (raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.parse(EXTENSION_LEGACY_JWT_DEFAULT_UNTIL);
}

export function isExtensionLegacyJwtAllowed(now = Date.now()): boolean {
  return now < getExtensionLegacyJwtUntilMs();
}

export function pickExtensionToken(
  request: NextRequest,
  bodyToken?: string | null,
): string | null {
  const bearer = extractBearerToken(request);
  if (bearer) return bearer;
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim();
  return null;
}

/**
 * Chrome 拡張 API 用の認証。
 * - byoagt_ + scope `extension` を本命とする
 * - 移行期間中のみログイン用 JWT（getUserIdFromToken）も受け付ける
 * - read/write だけのエージェント用トークンは拡張 API では拒否する
 */
export function resolveExtensionAuth(
  request: NextRequest,
  options?: {
    bodyToken?: string | null;
    rate?: AgentRateKind | AgentRateKind[];
    auditAction?: string;
    auditMeta?: Record<string, unknown>;
    now?: number;
  },
): ExtensionAuthResult {
  const plaintext = pickExtensionToken(request, options?.bodyToken);
  if (!plaintext) {
    throw new GuestError(401, 'EXTENSION_TOKEN_REQUIRED', '認証トークンが必要です');
  }

  const now = options?.now ?? Date.now();

  if (isAgentTokenPlaintext(plaintext)) {
    const db = getDb();
    const auth = findAgentTokenByPlaintext(plaintext, db, now);
    if (!auth) {
      throw new GuestError(401, 'EXTENSION_TOKEN_INVALID', '無効または期限切れのトークンです');
    }
    if (!tokenHasScope(auth.scopes, 'extension')) {
      recordAgentAudit(auth.token.id, auth.userId, 'auth.scope_denied', { required: 'extension' }, db);
      throw new GuestError(
        403,
        'AGENT_SCOPE_DENIED',
        '拡張機能には extension 権限のトークンが必要です',
      );
    }
    const rates = normalizeRates(options?.rate);
    for (const kind of rates) {
      try {
        consumeAgentRate(auth.token.id, kind, db, now);
      } catch (error) {
        if (error instanceof GuestError && error.code === 'AGENT_RATE_LIMITED') {
          recordAgentAudit(auth.token.id, auth.userId, 'auth.rate_limited', { kind }, db);
        }
        throw error;
      }
    }
    touchAgentToken(auth.token.id, db);
    if (options?.auditAction) {
      recordAgentAudit(
        auth.token.id,
        auth.userId,
        options.auditAction,
        { scope: 'extension', ...(options.auditMeta ?? {}) },
        db,
      );
    }
    return {
      userId: auth.userId,
      kind: 'extension_token',
      agent: auth,
      legacyDeprecated: false,
    };
  }

  if (!isExtensionLegacyJwtAllowed(now)) {
    throw new GuestError(
      401,
      'EXTENSION_LEGACY_JWT_EXPIRED',
      '古いログイン用トークンは使えません。設定画面で拡張用トークンを作成してください',
    );
  }

  const userId = getUserIdFromToken(plaintext);
  if (!userId) {
    throw new GuestError(401, 'EXTENSION_TOKEN_INVALID', '無効なトークンです');
  }

  return {
    userId,
    kind: 'legacy_jwt',
    agent: null,
    legacyDeprecated: true,
  };
}

export function applyExtensionAuthHeaders(
  headers: Headers | Record<string, string>,
  auth: ExtensionAuthResult,
): void {
  if (!auth.legacyDeprecated) return;
  if (headers instanceof Headers) {
    headers.set(EXTENSION_AUTH_HEADER, EXTENSION_AUTH_LEGACY_VALUE);
    return;
  }
  headers[EXTENSION_AUTH_HEADER] = EXTENSION_AUTH_LEGACY_VALUE;
}

export function extensionCorsHeaders(methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': EXTENSION_AUTH_HEADER,
  };
}
