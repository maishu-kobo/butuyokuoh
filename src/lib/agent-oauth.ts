/**
 * エージェント向け OAuth 2.1（PKCE 必須）。
 * アクセス・トークンは既存の byoagt_（agent_tokens）を再利用する。
 * 権限・失効・操作ログ・レート制限は agent-token.ts 側の仕組みを使う。
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
// createHash は PKCE S256（仕様で SHA-256）のみ。照合ハッシュは scrypt。
import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import {
  AGENT_TOKEN_DEFAULT_DAYS,
  AGENT_TOKEN_MAX_DAYS,
} from './agent-access-limits';
import {
  createAgentToken,
  findAgentTokenByPlaintext,
  parseScopes,
  recordAgentAudit,
  revokeAgentToken,
  revokeAllAgentTokens,
  type AgentAuthContext,
  type AgentScope,
} from './agent-token';
import { getDb } from './db';
import { GuestError } from './guest';
import {
  BlockedTargetError,
  HttpError,
  requestPinned,
  resolvedPublicAddress,
  type MemberFetchDeps,
  type PinnedRequest,
} from './member-fetch';
import { isPublicAddress, type PageResolver } from './public-page';
import { isIP } from 'node:net';

export const OAUTH_SCOPES = ['read', 'write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_PENDING_TTL_MS = 15 * 60 * 1000;
export const OAUTH_REFRESH_DEFAULT_DAYS = AGENT_TOKEN_DEFAULT_DAYS;
export const OAUTH_REFRESH_MAX_DAYS = AGENT_TOKEN_MAX_DAYS;
export const OAUTH_CIMD_MAX_BYTES = 64 * 1024;
export const OAUTH_CSRF_COOKIE = 'byo_oauth_csrf';

const REFRESH_PREFIX = 'byoref_';

export type OAuthClientRow = {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string;
  grant_types: string;
  response_types: string;
  token_endpoint_auth_method: string;
  registration_type: string;
  metadata_url: string | null;
  metadata_json: string | null;
  metadata_fetched_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type OAuthPendingRow = {
  id: string;
  client_id: string;
  redirect_uri: string;
  scopes: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  state: string | null;
  state_hash: string | null;
  csrf_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

/**
 * OAuth の不透明値（code / refresh / CSRF / client_secret / state）の照合用。
 * ユーザーパスワード用ではないが、CodeQL の password-hash 判定を避けるため scrypt を使う。
 */
function hashOpaque(value: string, purpose: string): string {
  return scryptSync(value, `butuyokuoh-oauth-${purpose}-v1`, 32).toString('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function utcPlusMs(ms: number, now = Date.now()): string {
  return new Date(now + ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', ' ')
    .replace('Z', '');
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

export function oauthIssuer(requestUrl?: string): string {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_URL（または NEXTAUTH_URL）が必要です');
  }
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      /* fall through */
    }
  }
  // テストやローカルで AUTH_URL 未設定のとき。既存テストの Origin（localhost）に合わせる。
  return 'http://localhost';
}

export function mcpResourceUrl(requestUrl?: string): string {
  return `${oauthIssuer(requestUrl)}/api/mcp`;
}

export function normalizeResource(value: string): string {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.href;
}

export function assertMcpResource(resource: string, requestUrl?: string): string {
  let normalized: string;
  try {
    normalized = normalizeResource(resource);
  } catch {
    throw new GuestError(400, 'INVALID_RESOURCE', 'resource が不正です');
  }
  const expected = normalizeResource(mcpResourceUrl(requestUrl));
  if (normalized !== expected) {
    throw new GuestError(400, 'INVALID_RESOURCE', 'このリソース向けのトークンではありません');
  }
  return normalized;
}

export function buildAuthorizationServerMetadata(requestUrl?: string) {
  const issuer = oauthIssuer(requestUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    resource_indicator_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

export function buildProtectedResourceMetadata(requestUrl?: string) {
  const issuer = oauthIssuer(requestUrl);
  const resource = mcpResourceUrl(requestUrl);
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: `${issuer}/help/agents`,
  };
}

export function oauthWwwAuthenticate(requestUrl?: string): string {
  const meta = `${oauthIssuer(requestUrl)}/.well-known/oauth-protected-resource/api/mcp`;
  return `Bearer realm="mcp", resource_metadata="${meta}", scope="read write"`;
}

export function parseOAuthScopeParam(raw: unknown): OAuthScope[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parts = raw.trim().split(/\s+/);
  const scopes: OAuthScope[] = [];
  for (const part of parts) {
    if (!(OAUTH_SCOPES as readonly string[]).includes(part)) return null;
    const scope = part as OAuthScope;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes.length ? scopes : null;
}

export function scopesToParam(scopes: readonly string[]): string {
  return scopes.join(' ');
}

/** loopback と https の公開ホストのみ。完全一致検証用に正規化はしない。 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol === 'http:') {
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  }
  if (url.protocol !== 'https:') return false;
  if (!host.includes('.') && !isIP(host)) return false;
  if (/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return false;
  if (isIP(host) && !isPublicAddress(host)) return false;
  return true;
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

export function pkceChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  const computed = pkceChallengeS256(verifier);
  return hashesEqual(computed, challenge);
}

function isHttpsClientIdUrl(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' && url.pathname.length > 1 && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type CimdFetchDeps = {
  resolve?: PageResolver;
  request?: PinnedRequest;
  now?: number;
};

async function fetchJsonDocument(
  url: URL,
  deps: CimdFetchDeps = {},
): Promise<{ json: unknown; bodyText: string }> {
  const address = await resolvedPublicAddress(url, deps.resolve);
  const signal = AbortSignal.timeout(10_000);
  const request = deps.request ?? requestPinned;
  const result = await request(
    url,
    address,
    {
      Accept: 'application/json',
      'User-Agent': 'Butuyokuoh-OAuth/1.0',
      'Accept-Encoding': 'identity',
    },
    signal,
  );
  if (result.status < 200 || result.status >= 300) {
    throw new GuestError(400, 'CLIENT_METADATA_FETCH_FAILED', 'クライアント情報を取得できませんでした');
  }
  if (result.body.byteLength > OAUTH_CIMD_MAX_BYTES) {
    throw new GuestError(400, 'CLIENT_METADATA_TOO_LARGE', 'クライアント情報が大きすぎます');
  }
  const bodyText = result.body.toString('utf8');
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'クライアント情報が JSON ではありません');
  }
  return { json, bodyText };
}

function validateClientMetadataShape(
  json: unknown,
  expectedClientId: string,
): {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
} {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'クライアント情報が不正です');
  }
  const doc = json as Record<string, unknown>;
  if (doc.client_id !== expectedClientId) {
    throw new GuestError(400, 'CLIENT_METADATA_MISMATCH', 'client_id がメタデータの URL と一致しません');
  }
  if (typeof doc.client_name !== 'string' || !doc.client_name.trim() || doc.client_name.length > 200) {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'client_name が不正です');
  }
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'redirect_uris が必要です');
  }
  const redirectUris: string[] = [];
  for (const entry of doc.redirect_uris) {
    if (typeof entry !== 'string' || !isAllowedRedirectUri(entry)) {
      throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'redirect_uris に許可されない URI があります');
    }
    redirectUris.push(entry);
  }
  const grantTypes = Array.isArray(doc.grant_types)
    ? doc.grant_types.filter((g): g is string => typeof g === 'string')
    : ['authorization_code'];
  if (!grantTypes.includes('authorization_code')) {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'authorization_code が必要です');
  }
  const responseTypes = Array.isArray(doc.response_types)
    ? doc.response_types.filter((g): g is string => typeof g === 'string')
    : ['code'];
  if (!responseTypes.includes('code')) {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'response_type code が必要です');
  }
  const authMethod =
    typeof doc.token_endpoint_auth_method === 'string'
      ? doc.token_endpoint_auth_method
      : 'none';
  if (authMethod !== 'none' && authMethod !== 'client_secret_post') {
    throw new GuestError(400, 'CLIENT_METADATA_INVALID', 'token_endpoint_auth_method が不正です');
  }
  return {
    client_id: expectedClientId,
    client_name: doc.client_name.trim(),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: authMethod,
  };
}

export async function resolveOAuthClient(
  clientId: string,
  db: Database.Database = getDb(),
  deps: CimdFetchDeps = {},
): Promise<OAuthClientRow> {
  if (!clientId || clientId.length > 2048) {
    throw new GuestError(400, 'INVALID_CLIENT', 'client_id が不正です');
  }

  const existing = db.prepare('SELECT * FROM agent_oauth_clients WHERE client_id = ?').get(clientId) as
    | OAuthClientRow
    | undefined;
  if (existing) {
    if (existing.revoked_at) {
      throw new GuestError(400, 'INVALID_CLIENT', 'このクライアントは無効です');
    }
    return existing;
  }

  if (!isHttpsClientIdUrl(clientId)) {
    throw new GuestError(400, 'INVALID_CLIENT', '未登録の client_id です');
  }

  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new GuestError(400, 'INVALID_CLIENT', 'client_id が不正です');
  }
  if (url.protocol !== 'https:') {
    throw new GuestError(400, 'INVALID_CLIENT', 'クライアントメタデータは https のみです');
  }
  // SSRF: 公開アドレスのみ。ポート付きや内部ホストは resolvedPublicAddress で拒否。
  try {
    const { json, bodyText } = await fetchJsonDocument(url, deps);
    const meta = validateClientMetadataShape(json, clientId);
    const now = deps.now ?? Date.now();
    db.prepare(`
      INSERT INTO agent_oauth_clients (
        client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, registration_type, metadata_url, metadata_json, metadata_fetched_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, 'cimd', ?, ?, datetime('now'))
    `).run(
      meta.client_id,
      meta.client_name,
      JSON.stringify(meta.redirect_uris),
      JSON.stringify(meta.grant_types),
      JSON.stringify(meta.response_types),
      meta.token_endpoint_auth_method,
      clientId,
      bodyText.slice(0, OAUTH_CIMD_MAX_BYTES),
    );
    void now;
    return db.prepare('SELECT * FROM agent_oauth_clients WHERE client_id = ?').get(clientId) as OAuthClientRow;
  } catch (error) {
    if (error instanceof GuestError) throw error;
    if (error instanceof BlockedTargetError || error instanceof HttpError) {
      throw new GuestError(400, 'CLIENT_METADATA_FETCH_FAILED', 'クライアント情報を取得できませんでした');
    }
    throw new GuestError(400, 'CLIENT_METADATA_FETCH_FAILED', 'クライアント情報を取得できませんでした');
  }
}

export function registerDynamicClient(
  input: {
    client_name?: unknown;
    redirect_uris?: unknown;
    grant_types?: unknown;
    response_types?: unknown;
    token_endpoint_auth_method?: unknown;
  },
  db: Database.Database = getDb(),
): {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
} {
  const name =
    typeof input.client_name === 'string' && input.client_name.trim()
      ? input.client_name.trim().slice(0, 200)
      : 'OAuth Client';
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    throw new GuestError(400, 'invalid_client_metadata', 'redirect_uris が必要です');
  }
  const redirectUris: string[] = [];
  for (const entry of input.redirect_uris) {
    if (typeof entry !== 'string' || !isAllowedRedirectUri(entry)) {
      throw new GuestError(400, 'invalid_redirect_uri', 'redirect_uris が不正です');
    }
    redirectUris.push(entry);
  }
  const grantTypes = Array.isArray(input.grant_types)
    ? input.grant_types.filter((g): g is string => typeof g === 'string')
    : ['authorization_code', 'refresh_token'];
  if (!grantTypes.includes('authorization_code')) {
    throw new GuestError(400, 'invalid_client_metadata', 'authorization_code が必要です');
  }
  const responseTypes = Array.isArray(input.response_types)
    ? input.response_types.filter((g): g is string => typeof g === 'string')
    : ['code'];
  if (!responseTypes.includes('code')) {
    throw new GuestError(400, 'invalid_client_metadata', 'response_types に code が必要です');
  }
  const authMethod =
    typeof input.token_endpoint_auth_method === 'string'
      ? input.token_endpoint_auth_method
      : 'none';
  if (authMethod !== 'none' && authMethod !== 'client_secret_post') {
    throw new GuestError(400, 'invalid_client_metadata', 'token_endpoint_auth_method が不正です');
  }

  const clientId = `byoocl_${randomBytes(18).toString('base64url')}`;
  let clientSecret: string | undefined;
  let secretHash: string | null = null;
  if (authMethod === 'client_secret_post') {
    clientSecret = randomBytes(24).toString('base64url');
    secretHash = hashOpaque(clientSecret, 'client');
  }

  db.prepare(`
    INSERT INTO agent_oauth_clients (
      client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types,
      token_endpoint_auth_method, registration_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'dcr')
  `).run(
    clientId,
    secretHash,
    name,
    JSON.stringify(redirectUris),
    JSON.stringify(grantTypes.includes('refresh_token') ? grantTypes : [...grantTypes, 'refresh_token']),
    JSON.stringify(responseTypes),
    authMethod,
  );

  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: grantTypes.includes('refresh_token') ? grantTypes : [...grantTypes, 'refresh_token'],
    response_types: responseTypes,
    token_endpoint_auth_method: authMethod,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

export function clientAllowsRedirect(client: OAuthClientRow, redirectUri: string): boolean {
  return parseJsonStringArray(client.redirect_uris).includes(redirectUri);
}

export function authenticateOAuthClient(
  client: OAuthClientRow,
  presentedSecret: string | null | undefined,
): void {
  if (client.token_endpoint_auth_method === 'none') {
    if (presentedSecret) {
      throw new GuestError(401, 'invalid_client', 'このクライアントはシークレットを使いません');
    }
    return;
  }
  if (!client.client_secret_hash || typeof presentedSecret !== 'string' || !presentedSecret) {
    throw new GuestError(401, 'invalid_client', 'client_secret が必要です');
  }
  if (!hashesEqual(client.client_secret_hash, hashOpaque(presentedSecret, 'client'))) {
    throw new GuestError(401, 'invalid_client', 'client_secret が違います');
  }
}

export async function createAuthorizePending(
  input: {
    client_id: string;
    redirect_uri: string;
    scope: string;
    code_challenge: string;
    code_challenge_method: string;
    resource: string;
    state?: string | null;
    response_type: string;
  },
  db: Database.Database = getDb(),
  deps: CimdFetchDeps = {},
  requestUrl?: string,
): Promise<{ pendingId: string; csrf: string; client: OAuthClientRow; scopes: OAuthScope[] }> {
  if (input.response_type !== 'code') {
    throw new GuestError(400, 'unsupported_response_type', 'response_type は code のみです');
  }
  if (input.code_challenge_method !== 'S256') {
    throw new GuestError(400, 'invalid_request', 'code_challenge_method は S256 のみです');
  }
  if (!input.code_challenge || input.code_challenge.length < 43 || input.code_challenge.length > 128) {
    throw new GuestError(400, 'invalid_request', 'code_challenge が不正です');
  }
  if (!isAllowedRedirectUri(input.redirect_uri)) {
    throw new GuestError(400, 'invalid_request', 'redirect_uri が不正です');
  }
  const scopes = parseOAuthScopeParam(input.scope) ?? [...OAUTH_SCOPES];
  const resource = assertMcpResource(input.resource, requestUrl);
  const client = await resolveOAuthClient(input.client_id, db, deps);
  if (!clientAllowsRedirect(client, input.redirect_uri)) {
    throw new GuestError(400, 'invalid_request', 'redirect_uri が登録と一致しません');
  }

  const state = input.state ?? null;
  if (state !== null && state.length > 512) {
    throw new GuestError(400, 'invalid_request', 'state が長すぎます');
  }
  const stateHash = state ? hashOpaque(`${client.client_id}:${state}`, 'state') : null;
  if (stateHash) {
    const dup = db.prepare(`
      SELECT id FROM agent_oauth_pending
      WHERE client_id = ? AND state_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')
    `).get(client.client_id, stateHash);
    if (dup) {
      throw new GuestError(400, 'invalid_request', 'state は1回限りです');
    }
  }

  const pendingId = randomBytes(24).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  db.prepare(`
    INSERT INTO agent_oauth_pending (
      id, client_id, redirect_uri, scopes, code_challenge, code_challenge_method,
      resource, state, state_hash, csrf_hash, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pendingId,
    client.client_id,
    input.redirect_uri,
    JSON.stringify(scopes),
    input.code_challenge,
    'S256',
    resource,
    state,
    stateHash,
    hashOpaque(csrf, 'csrf'),
    utcPlusMs(OAUTH_PENDING_TTL_MS),
  );

  return { pendingId, csrf, client, scopes };
}

export function getAuthorizePending(
  pendingId: string,
  db: Database.Database = getDb(),
): OAuthPendingRow | null {
  const row = db.prepare('SELECT * FROM agent_oauth_pending WHERE id = ?').get(pendingId) as
    | OAuthPendingRow
    | undefined;
  if (!row || row.consumed_at || isExpired(row.expires_at)) return null;
  return row;
}

export function approveAuthorizePending(
  pendingId: string,
  csrf: string,
  userId: number,
  decision: 'approve' | 'deny',
  db: Database.Database = getDb(),
): { redirectUrl: string } {
  const pending = getAuthorizePending(pendingId, db);
  if (!pending) {
    throw new GuestError(400, 'invalid_request', '認可リクエストの有効期限が切れています');
  }
  if (!hashesEqual(pending.csrf_hash, hashOpaque(csrf, 'csrf'))) {
    throw new GuestError(403, 'invalid_csrf', 'CSRF トークンが不正です');
  }

  const member = db.prepare(
    "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
  ).get(userId);
  if (!member) {
    throw new GuestError(403, 'MEMBER_REQUIRED', '会員のみ認可できます');
  }

  db.prepare(`UPDATE agent_oauth_pending SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL`)
    .run(pendingId);

  const redirect = new URL(pending.redirect_uri);
  if (pending.state) redirect.searchParams.set('state', pending.state);

  if (decision === 'deny') {
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'user_denied');
    return { redirectUrl: redirect.toString() };
  }

  const code = randomBytes(32).toString('base64url');
  db.prepare(`
    INSERT INTO agent_oauth_auth_codes (
      code_hash, client_id, user_id, redirect_uri, scopes, code_challenge,
      code_challenge_method, resource, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    hashOpaque(code, 'code'),
    pending.client_id,
    userId,
    pending.redirect_uri,
    pending.scopes,
    pending.code_challenge,
    pending.code_challenge_method,
    pending.resource,
    utcPlusMs(OAUTH_CODE_TTL_MS),
  );

  redirect.searchParams.set('code', code);
  return { redirectUrl: redirect.toString() };
}

function issueRefreshToken(
  agentTokenId: number,
  userId: number,
  clientId: string,
  resource: string,
  scopes: AgentScope[],
  db: Database.Database,
  days = OAUTH_REFRESH_DEFAULT_DAYS,
): string {
  const plaintext = `${REFRESH_PREFIX}${randomBytes(32).toString('base64url')}`;
  db.prepare(`
    INSERT INTO agent_oauth_refresh_tokens (
      token_hash, agent_token_id, client_id, user_id, resource, scopes, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    hashOpaque(plaintext, 'refresh'),
    agentTokenId,
    clientId,
    userId,
    resource,
    JSON.stringify(scopes),
    utcPlusDays(Math.min(days, OAUTH_REFRESH_MAX_DAYS)),
  );
  return plaintext;
}

function bindOAuthFields(
  tokenId: number,
  clientId: string,
  resource: string,
  db: Database.Database,
): void {
  db.prepare(
    `UPDATE agent_tokens SET oauth_client_id = ?, oauth_resource = ? WHERE id = ?`,
  ).run(clientId, resource, tokenId);
}

export function exchangeAuthorizationCode(
  input: {
    code: string;
    redirect_uri: string;
    client_id: string;
    code_verifier: string;
    resource: string;
    client_secret?: string | null;
  },
  db: Database.Database = getDb(),
  requestUrl?: string,
): {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
} {
  const client = db.prepare('SELECT * FROM agent_oauth_clients WHERE client_id = ?').get(input.client_id) as
    | OAuthClientRow
    | undefined;
  if (!client || client.revoked_at) {
    throw new GuestError(401, 'invalid_client', 'client_id が不正です');
  }
  authenticateOAuthClient(client, input.client_secret);
  const resource = assertMcpResource(input.resource, requestUrl);

  const codeHash = hashOpaque(input.code, 'code');
  const row = db.prepare('SELECT * FROM agent_oauth_auth_codes WHERE code_hash = ?').get(codeHash) as {
    code_hash: string;
    client_id: string;
    user_id: number;
    redirect_uri: string;
    scopes: string;
    code_challenge: string;
    code_challenge_method: string;
    resource: string;
    expires_at: string;
    consumed_at: string | null;
  } | undefined;

  if (!row || !hashesEqual(row.code_hash, codeHash)) {
    throw new GuestError(400, 'invalid_grant', '認可コードが不正です');
  }
  if (row.consumed_at || isExpired(row.expires_at)) {
    throw new GuestError(400, 'invalid_grant', '認可コードの有効期限が切れています');
  }
  if (row.client_id !== input.client_id || row.redirect_uri !== input.redirect_uri) {
    throw new GuestError(400, 'invalid_grant', 'redirect_uri または client_id が一致しません');
  }
  if (normalizeResource(row.resource) !== resource) {
    throw new GuestError(400, 'invalid_grant', 'resource が一致しません');
  }
  if (row.code_challenge_method !== 'S256' || !verifyPkceS256(input.code_verifier, row.code_challenge)) {
    throw new GuestError(400, 'invalid_grant', 'PKCE 検証に失敗しました');
  }

  db.prepare(`UPDATE agent_oauth_auth_codes SET consumed_at = datetime('now') WHERE code_hash = ? AND consumed_at IS NULL`)
    .run(codeHash);

  const scopes = (parseScopes(JSON.parse(row.scopes)) ?? []).filter(
    (s): s is OAuthScope => s === 'read' || s === 'write',
  );
  if (!scopes.length) {
    throw new GuestError(400, 'invalid_grant', 'スコープが不正です');
  }

  const { token, record } = createAgentToken(
    row.user_id,
    {
      name: `OAuth: ${client.client_name}`.slice(0, 100),
      scopes,
      expiresInDays: AGENT_TOKEN_DEFAULT_DAYS,
    },
    db,
  );
  bindOAuthFields(record.id, client.client_id, resource, db);
  const refresh = issueRefreshToken(record.id, row.user_id, client.client_id, resource, scopes, db);
  recordAgentAudit(record.id, row.user_id, 'oauth.token', { grant: 'authorization_code' }, db);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: AGENT_TOKEN_DEFAULT_DAYS * 86_400,
    refresh_token: refresh,
    scope: scopesToParam(scopes),
  };
}

export function refreshAccessToken(
  input: {
    refresh_token: string;
    client_id: string;
    resource: string;
    client_secret?: string | null;
    scope?: string | null;
  },
  db: Database.Database = getDb(),
  requestUrl?: string,
): {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
} {
  const client = db.prepare('SELECT * FROM agent_oauth_clients WHERE client_id = ?').get(input.client_id) as
    | OAuthClientRow
    | undefined;
  if (!client || client.revoked_at) {
    throw new GuestError(401, 'invalid_client', 'client_id が不正です');
  }
  authenticateOAuthClient(client, input.client_secret);
  const resource = assertMcpResource(input.resource, requestUrl);

  if (!input.refresh_token.startsWith(REFRESH_PREFIX)) {
    throw new GuestError(400, 'invalid_grant', 'refresh_token が不正です');
  }
  const tokenHash = hashOpaque(input.refresh_token, 'refresh');
  const row = db.prepare('SELECT * FROM agent_oauth_refresh_tokens WHERE token_hash = ?').get(tokenHash) as {
    id: number;
    token_hash: string;
    agent_token_id: number;
    client_id: string;
    user_id: number;
    resource: string;
    scopes: string;
    expires_at: string;
    revoked_at: string | null;
  } | undefined;

  if (!row || !hashesEqual(row.token_hash, tokenHash) || row.revoked_at || isExpired(row.expires_at)) {
    throw new GuestError(400, 'invalid_grant', 'refresh_token が無効です');
  }
  if (row.client_id !== input.client_id || normalizeResource(row.resource) !== resource) {
    throw new GuestError(400, 'invalid_grant', 'client_id または resource が一致しません');
  }

  let scopes = (parseScopes(JSON.parse(row.scopes)) ?? []).filter(
    (s): s is OAuthScope => s === 'read' || s === 'write',
  );
  if (input.scope) {
    const requested = parseOAuthScopeParam(input.scope);
    if (!requested || requested.some((s) => !scopes.includes(s))) {
      throw new GuestError(400, 'invalid_scope', '要求スコープが許可を超えています');
    }
    scopes = requested;
  }
  if (!scopes.length) {
    throw new GuestError(400, 'invalid_grant', 'スコープが不正です');
  }

  // ローテーション: 旧 refresh と旧 access を失効し、新しい組を発行する。
  db.prepare(`UPDATE agent_oauth_refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(row.id);
  revokeAgentToken(row.user_id, row.agent_token_id, db);

  const { token, record } = createAgentToken(
    row.user_id,
    {
      name: `OAuth: ${client.client_name}`.slice(0, 100),
      scopes,
      expiresInDays: AGENT_TOKEN_DEFAULT_DAYS,
    },
    db,
  );
  bindOAuthFields(record.id, client.client_id, resource, db);
  const refresh = issueRefreshToken(record.id, row.user_id, client.client_id, resource, scopes, db);
  const newRefreshId = Number(
    (db.prepare('SELECT id FROM agent_oauth_refresh_tokens WHERE token_hash = ?').get(hashOpaque(refresh, 'refresh')) as { id: number }).id,
  );
  db.prepare(`UPDATE agent_oauth_refresh_tokens SET replaced_by_id = ? WHERE id = ?`).run(newRefreshId, row.id);
  recordAgentAudit(record.id, row.user_id, 'oauth.token', { grant: 'refresh_token' }, db);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: AGENT_TOKEN_DEFAULT_DAYS * 86_400,
    refresh_token: refresh,
    scope: scopesToParam(scopes),
  };
}

export function revokeOAuthToken(
  input: {
    token: string;
    client_id: string;
    client_secret?: string | null;
    token_type_hint?: string | null;
  },
  db: Database.Database = getDb(),
): void {
  const client = db.prepare('SELECT * FROM agent_oauth_clients WHERE client_id = ?').get(input.client_id) as
    | OAuthClientRow
    | undefined;
  if (!client || client.revoked_at) {
    throw new GuestError(401, 'invalid_client', 'client_id が不正です');
  }
  authenticateOAuthClient(client, input.client_secret);

  const hint = input.token_type_hint;
  const tryRefresh = () => {
    if (!input.token.startsWith(REFRESH_PREFIX)) return false;
    const row = db.prepare('SELECT * FROM agent_oauth_refresh_tokens WHERE token_hash = ?').get(hashOpaque(input.token, 'refresh')) as {
      id: number;
      client_id: string;
      user_id: number;
      agent_token_id: number;
      revoked_at: string | null;
    } | undefined;
    if (!row || row.client_id !== client.client_id) return false;
    if (!row.revoked_at) {
      db.prepare(`UPDATE agent_oauth_refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(row.id);
      revokeAgentToken(row.user_id, row.agent_token_id, db);
    }
    return true;
  };
  const tryAccess = () => {
    const auth = findAgentTokenByPlaintext(input.token, db);
    if (!auth) return false;
    const row = db.prepare('SELECT oauth_client_id FROM agent_tokens WHERE id = ?').get(auth.token.id) as {
      oauth_client_id: string | null;
    } | undefined;
    if (row?.oauth_client_id !== client.client_id) return false;
    revokeAgentToken(auth.userId, auth.token.id, db);
    db.prepare(`
      UPDATE agent_oauth_refresh_tokens
      SET revoked_at = datetime('now')
      WHERE agent_token_id = ? AND revoked_at IS NULL
    `).run(auth.token.id);
    return true;
  };

  if (hint === 'refresh_token') {
    if (!tryRefresh()) tryAccess();
    return;
  }
  if (hint === 'access_token') {
    if (!tryAccess()) tryRefresh();
    return;
  }
  if (!tryAccess()) tryRefresh();
}

/** パスワード変更時など。アクセスは revokeAllAgentTokens、refresh もまとめて失効。 */
export function revokeAllOAuthRefreshTokens(userId: number, db: Database.Database = getDb()): number {
  const result = db.prepare(`
    UPDATE agent_oauth_refresh_tokens
    SET revoked_at = datetime('now')
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(userId);
  return result.changes;
}

export function revokeAllAgentAccessIncludingOAuth(
  userId: number,
  db: Database.Database = getDb(),
): number {
  revokeAllOAuthRefreshTokens(userId, db);
  return revokeAllAgentTokens(userId, db);
}

export function assertAccessTokenResource(
  auth: AgentAuthContext,
  requestUrl?: string,
  db: Database.Database = getDb(),
): void {
  const row = db.prepare('SELECT oauth_resource FROM agent_tokens WHERE id = ?').get(auth.token.id) as {
    oauth_resource: string | null;
  } | undefined;
  if (!row?.oauth_resource) return; // PAT はそのまま
  const expected = normalizeResource(mcpResourceUrl(requestUrl));
  if (normalizeResource(row.oauth_resource) !== expected) {
    throw new GuestError(401, 'INVALID_TOKEN_RESOURCE', 'このトークンの宛先が違います');
  }
}

export function readFormBody(request: NextRequest): Promise<URLSearchParams> {
  return request.text().then((text) => new URLSearchParams(text));
}

export type { MemberFetchDeps };
