import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type Database from 'better-sqlite3';
import {
  AGENT_AUDIT_RETENTION_DAYS,
  AGENT_RATE_LIMITS,
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
  type AgentRateKind,
} from './agent-access-limits';
import { getDb } from './db';
import { GuestError } from './guest';

export {
  AGENT_AUDIT_RETENTION_DAYS,
  AGENT_RATE_LIMITS,
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
} from './agent-access-limits';
export type { AgentRateKind } from './agent-access-limits';

export const AGENT_TOKEN_PREFIX = 'byoagt_';

/** read/write はエージェント API、extension は Chrome 拡張の最小権限（#271） */
export type AgentScope = 'read' | 'write' | 'extension';

const ALLOWED_SCOPES: readonly AgentScope[] = ['read', 'write', 'extension'];

// add / add_url / read は直近1分の窓。add_day は「最初の追加から24時間」の固定窓
// （窓が切れるまで resets_at を動かさず、切れたら count を1に戻して新しい窓を始める）。
const RATE_WINDOW_MS: Record<AgentRateKind, number> = {
  read: 60_000,
  add: 60_000,
  add_url: 60_000,
  add_day: 86_400_000,
};

export interface AgentTokenRow {
  id: number;
  user_id: number;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface AgentTokenPublic {
  id: number;
  name: string;
  token_prefix: string;
  scopes: AgentScope[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  active: boolean;
  /** ゴミ箱へ一括移動できる件数（未削除・未購入のみ） */
  undoable_count: number;
}

export interface AgentAuthContext {
  token: AgentTokenRow;
  userId: number;
  scopes: AgentScope[];
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isAgentTokenPlaintext(value: string): boolean {
  return typeof value === 'string' && value.startsWith(AGENT_TOKEN_PREFIX) && value.length > AGENT_TOKEN_PREFIX.length + 8;
}

export function parseScopes(raw: unknown): AgentScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const scopes: AgentScope[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !(ALLOWED_SCOPES as readonly string[]).includes(entry)) {
      return null;
    }
    const scope = entry as AgentScope;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes.length ? scopes : null;
}

export function scopesFromStored(raw: string): AgentScope[] {
  try {
    return parseScopes(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

export function tokenHasScope(scopes: AgentScope[], required: AgentScope): boolean {
  return scopes.includes(required);
}

function utcPlusDays(days: number, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', ' ').replace('Z', '');
}

function isExpired(expiresAt: string, now = Date.now()): boolean {
  const normalized = expiresAt.includes('T') ? expiresAt : expiresAt.replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZone);
  return !Number.isFinite(ms) || ms <= now;
}

function publicToken(row: AgentTokenRow, db: Database.Database, now = Date.now()): AgentTokenPublic {
  const scopes = scopesFromStored(row.scopes);
  const active = !row.revoked_at && !isExpired(row.expires_at, now);
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    scopes,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    active,
    undoable_count: countActiveItemsAddedByAgent(row.user_id, row.id, db),
  };
}

export function pruneAgentAuditLog(db: Database.Database = getDb(), now = Date.now()): number {
  const cutoff = new Date(now - AGENT_AUDIT_RETENTION_DAYS * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', ' ')
    .replace('Z', '');
  return db.prepare('DELETE FROM agent_audit_log WHERE created_at < ?').run(cutoff).changes;
}

export function recordAgentAudit(
  tokenId: number,
  userId: number,
  action: string,
  meta?: Record<string, unknown> | null,
  db: Database.Database = getDb(),
): void {
  const safe: Record<string, unknown> = {};
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      const lower = key.toLowerCase();
      if (lower.includes('token') || lower.includes('secret') || lower.includes('authorization')) continue;
      if (typeof value === 'string' && isAgentTokenPlaintext(value)) continue;
      safe[key] = value;
    }
  }
  db.prepare(
    'INSERT INTO agent_audit_log (token_id, user_id, action, meta) VALUES (?, ?, ?, ?)',
  ).run(tokenId, userId, action, Object.keys(safe).length ? JSON.stringify(safe) : null);
  pruneAgentAuditLog(db);
}

export function clearAgentRateBuckets(tokenId: number, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM agent_rate_limits WHERE bucket LIKE ?').run(`agent:${tokenId}:%`);
}

export function createAgentToken(
  userId: number,
  input: { name: string; scopes: AgentScope[]; expiresInDays?: number },
  db: Database.Database = getDb(),
): { token: string; record: AgentTokenPublic } {
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw new GuestError(400, 'INVALID_INPUT', 'トークン名を100文字以内で入力してください');
  }
  const scopes = parseScopes(input.scopes);
  if (!scopes) {
    throw new GuestError(400, 'INVALID_INPUT', '権限は read / write / extension から選んでください');
  }
  const days = input.expiresInDays ?? AGENT_TOKEN_DEFAULT_DAYS;
  if (!Number.isSafeInteger(days) || days < 1 || days > AGENT_TOKEN_MAX_DAYS) {
    throw new GuestError(400, 'INVALID_INPUT', `有効期限は1〜${AGENT_TOKEN_MAX_DAYS}日です`);
  }

  const member = db.prepare(
    "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
  ).get(userId);
  if (!member) {
    throw new GuestError(403, 'MEMBER_REQUIRED', '会員のみエージェント用トークンを作成できます');
  }

  const secret = randomBytes(24).toString('base64url');
  const plaintext = `${AGENT_TOKEN_PREFIX}${secret}`;
  const tokenHash = hashToken(plaintext);
  const tokenPrefix = plaintext.slice(0, AGENT_TOKEN_PREFIX.length + 8);
  const expiresAt = utcPlusDays(days);

  const result = db.prepare(`
    INSERT INTO agent_tokens (user_id, name, token_prefix, token_hash, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, name, tokenPrefix, tokenHash, JSON.stringify(scopes), expiresAt);

  const id = Number(result.lastInsertRowid);
  const row = db.prepare('SELECT * FROM agent_tokens WHERE id = ?').get(id) as AgentTokenRow;
  recordAgentAudit(id, userId, 'token.create', { scopes, expires_in_days: days }, db);
  return { token: plaintext, record: publicToken(row, db) };
}

export function listAgentTokens(userId: number, db: Database.Database = getDb()): AgentTokenPublic[] {
  const rows = db.prepare(
    'SELECT * FROM agent_tokens WHERE user_id = ? ORDER BY id DESC',
  ).all(userId) as AgentTokenRow[];
  return rows.map((row) => publicToken(row, db));
}

export function revokeAgentToken(userId: number, tokenId: number, db: Database.Database = getDb()): boolean {
  const row = db.prepare(
    'SELECT * FROM agent_tokens WHERE id = ? AND user_id = ?',
  ).get(tokenId, userId) as AgentTokenRow | undefined;
  if (!row) return false;
  if (row.revoked_at) {
    clearAgentRateBuckets(tokenId, db);
    return true;
  }
  db.prepare(
    `UPDATE agent_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  ).run(tokenId, userId);
  clearAgentRateBuckets(tokenId, db);
  recordAgentAudit(tokenId, userId, 'token.revoke', null, db);
  return true;
}

export function revokeAllAgentTokens(userId: number, db: Database.Database = getDb()): number {
  const rows = db.prepare(
    'SELECT id FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL',
  ).all(userId) as { id: number }[];
  if (!rows.length) return 0;
  db.prepare(
    `UPDATE agent_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`,
  ).run(userId);
  for (const row of rows) {
    clearAgentRateBuckets(row.id, db);
    recordAgentAudit(row.id, userId, 'token.revoke_all', { reason: 'password_change' }, db);
  }
  return rows.length;
}

export function listAgentAuditLog(
  userId: number,
  tokenId: number,
  db: Database.Database = getDb(),
  limit = 100,
): { id: number; action: string; meta: string | null; created_at: string }[] {
  pruneAgentAuditLog(db);
  const owned = db.prepare(
    'SELECT id FROM agent_tokens WHERE id = ? AND user_id = ?',
  ).get(tokenId, userId);
  if (!owned) return [];
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  return db.prepare(
    `SELECT id, action, meta, created_at FROM agent_audit_log
     WHERE token_id = ? AND user_id = ?
     ORDER BY id DESC LIMIT ?`,
  ).all(tokenId, userId, safeLimit) as { id: number; action: string; meta: string | null; created_at: string }[];
}

export function findAgentTokenByPlaintext(
  plaintext: string,
  db: Database.Database = getDb(),
  now = Date.now(),
): AgentAuthContext | null {
  if (!isAgentTokenPlaintext(plaintext)) return null;
  const tokenHash = hashToken(plaintext);
  const row = db.prepare('SELECT * FROM agent_tokens WHERE token_hash = ?').get(tokenHash) as AgentTokenRow | undefined;
  if (!row || !hashesEqual(row.token_hash, tokenHash)) return null;
  if (row.revoked_at) return null;
  if (isExpired(row.expires_at, now)) return null;
  const member = db.prepare(
    "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
  ).get(row.user_id);
  if (!member) return null;
  const scopes = scopesFromStored(row.scopes);
  if (!scopes.length) return null;
  return { token: row, userId: row.user_id, scopes };
}

export function touchAgentToken(tokenId: number, db: Database.Database = getDb()): void {
  db.prepare(`UPDATE agent_tokens SET last_used_at = datetime('now') WHERE id = ?`).run(tokenId);
}

export function consumeAgentRate(
  tokenId: number,
  kind: AgentRateKind,
  db: Database.Database = getDb(),
  now = Date.now(),
): void {
  const limit = AGENT_RATE_LIMITS[kind];
  const windowMs = RATE_WINDOW_MS[kind];
  const bucket = `agent:${tokenId}:${kind}`;
  db.transaction(() => {
    const row = db.prepare('SELECT count, resets_at FROM agent_rate_limits WHERE bucket = ?')
      .get(bucket) as { count: number; resets_at: number } | undefined;
    if (row && row.resets_at > now && row.count >= limit) {
      throw new GuestError(
        429,
        'AGENT_RATE_LIMITED',
        '操作が集中しています。少し待ってからお試しください。',
        Math.max(1, Math.ceil((row.resets_at - now) / 1000)),
      );
    }
    if (!row || row.resets_at <= now) {
      // 新しい窓の開始。add_day もここで固定の24時間窓を切る。
      db.prepare(`INSERT INTO agent_rate_limits (bucket, count, resets_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET count = 1, resets_at = excluded.resets_at`)
        .run(bucket, now + windowMs);
    } else {
      db.prepare('UPDATE agent_rate_limits SET count = count + 1 WHERE bucket = ?').run(bucket);
    }
  }).immediate();
}

export function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token || null;
}

function normalizeRates(rate?: AgentRateKind | AgentRateKind[]): AgentRateKind[] {
  if (!rate) return [];
  return Array.isArray(rate) ? rate : [rate];
}

/**
 * エージェント用 Bearer を検証する。
 * 監査は拒否・レート制限・明示の auditAction（書き込みなど）だけ。成功した読み取りは記録しない。
 */
export async function requireAgentToken(
  request: NextRequest,
  scope: AgentScope,
  options?: {
    rate?: AgentRateKind | AgentRateKind[];
    auditAction?: string;
    auditMeta?: Record<string, unknown>;
  },
): Promise<AgentAuthContext> {
  const plaintext = extractBearerToken(request);
  if (!plaintext) {
    throw new GuestError(401, 'AGENT_TOKEN_REQUIRED', 'エージェント用トークンが必要です');
  }
  if (!isAgentTokenPlaintext(plaintext)) {
    throw new GuestError(401, 'AGENT_TOKEN_INVALID', '無効なエージェント用トークンです');
  }
  const db = getDb();
  const auth = findAgentTokenByPlaintext(plaintext, db);
  if (!auth) {
    throw new GuestError(401, 'AGENT_TOKEN_INVALID', '無効または期限切れのエージェント用トークンです');
  }
  if (!tokenHasScope(auth.scopes, scope)) {
    recordAgentAudit(auth.token.id, auth.userId, 'auth.scope_denied', { required: scope }, db);
    throw new GuestError(403, 'AGENT_SCOPE_DENIED', 'この操作に必要な権限がありません');
  }
  const rates = normalizeRates(options?.rate);
  for (const kind of rates) {
    try {
      consumeAgentRate(auth.token.id, kind, db);
    } catch (error) {
      if (error instanceof GuestError && error.code === 'AGENT_RATE_LIMITED') {
        recordAgentAudit(auth.token.id, auth.userId, 'auth.rate_limited', { kind }, db);
      }
      throw error;
    }
  }
  touchAgentToken(auth.token.id, db);
  // 成功した読み取りは記録しない。書き込みなどは呼び出し側が auditAction を渡す。
  if (options?.auditAction) {
    recordAgentAudit(
      auth.token.id,
      auth.userId,
      options.auditAction,
      { scope, ...(options.auditMeta ?? {}) },
      db,
    );
  }
  return auth;
}

export function markItemAddedByAgent(
  itemId: number,
  tokenId: number,
  userId: number,
  db: Database.Database = getDb(),
): number {
  return db.prepare(
    `UPDATE items
     SET added_by_agent_token_id = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  ).run(tokenId, itemId, userId).changes;
}

export function trashItemsAddedByAgent(
  userId: number,
  tokenId: number,
  db: Database.Database = getDb(),
): number {
  const owned = db.prepare(
    'SELECT id FROM agent_tokens WHERE id = ? AND user_id = ?',
  ).get(tokenId, userId);
  if (!owned) return 0;
  // 購入済みは履歴として残す。未削除かつ未購入だけをゴミ箱へ。
  const result = db.prepare(`
    UPDATE items
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ?
      AND added_by_agent_token_id = ?
      AND deleted_at IS NULL
      AND is_purchased = 0
  `).run(userId, tokenId);
  if (result.changes > 0) {
    recordAgentAudit(tokenId, userId, 'items.bulk_trash', { count: result.changes }, db);
  }
  return result.changes;
}

export function countActiveItemsAddedByAgent(
  userId: number,
  tokenId: number,
  db: Database.Database = getDb(),
): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM items
    WHERE user_id = ?
      AND added_by_agent_token_id = ?
      AND deleted_at IS NULL
      AND is_purchased = 0
  `).get(userId, tokenId) as { count: number };
  return row.count;
}
