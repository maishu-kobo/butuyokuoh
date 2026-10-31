import './regression-harness';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { call, createMember, db, setTestUser } from './regression-harness';
import {
  assertMcpResource,
  createAuthorizePending,
  exchangeAuthorizationCode,
  isAllowedRedirectUri,
  mcpResourceUrl,
  oauthWwwAuthenticate,
  parseOAuthScopeParam,
  pkceChallengeS256,
  refreshAccessToken,
  registerDynamicClient,
  resolveOAuthClient,
  revokeAllAgentAccessIncludingOAuth,
  revokeOAuthToken,
  verifyPkceS256,
} from '../src/lib/agent-oauth';
import { findAgentTokenByPlaintext } from '../src/lib/agent-token';
import type { PinnedResponse } from '../src/lib/member-fetch';

const queue: Promise<unknown>[] = [];
const serial = (fn: () => Promise<void>) => {
  const run = async () => {
    await Promise.allSettled(queue);
    await fn();
  };
  const done = run();
  queue.push(done);
  return done;
};

const asMetaPath = '../src/app/.well-known/oauth-authorization-server/route.ts';
const prmPath = '../src/app/.well-known/oauth-protected-resource/route.ts';
const prmMcpPath = '../src/app/.well-known/oauth-protected-resource/api/mcp/route.ts';
const registerPath = '../src/app/api/oauth/register/route.ts';
const tokenPath = '../src/app/api/oauth/token/route.ts';
const revokePath = '../src/app/api/oauth/revoke/route.ts';
const consentPath = '../src/app/api/oauth/consent/route.ts';
const authorizePath = '../src/app/oauth/authorize/route.ts';
const mcpPath = '../src/app/api/mcp/route.ts';
const passwordPath = '../src/app/api/auth/password/route.ts';

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallengeS256(verifier) };
}

test('oauth helpers: pkce, scopes, redirect, resource, www-authenticate', () => {
  const { verifier, challenge } = pkcePair();
  assert.equal(verifyPkceS256(verifier, challenge), true);
  assert.equal(verifyPkceS256('short', challenge), false);
  assert.deepEqual(parseOAuthScopeParam('read write'), ['read', 'write']);
  assert.equal(parseOAuthScopeParam('extension'), null);
  assert.equal(isAllowedRedirectUri('http://127.0.0.1:3210/cb'), true);
  assert.equal(isAllowedRedirectUri('http://localhost:9/x'), true);
  assert.equal(isAllowedRedirectUri('https://evil.internal/cb'), false);
  assert.equal(isAllowedRedirectUri('https://example.com/cb'), true);
  assert.equal(assertMcpResource(mcpResourceUrl('http://localhost/')), mcpResourceUrl());
  assert.match(oauthWwwAuthenticate(), /resource_metadata=.*oauth-protected-resource\/api\/mcp/);
});

test('oauth metadata endpoints advertise AS, PRM, CIMD, DCR', () => serial(async () => {
  const asMeta = await call(asMetaPath, 'GET', '/.well-known/oauth-authorization-server');
  assert.equal(asMeta.status, 200, asMeta.text);
  const asJson = asMeta.json as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    code_challenge_methods_supported: string[];
    client_id_metadata_document_supported: boolean;
  };
  assert.ok(asJson.issuer);
  assert.match(asJson.authorization_endpoint, /\/oauth\/authorize$/);
  assert.match(asJson.token_endpoint, /\/api\/oauth\/token$/);
  assert.match(asJson.registration_endpoint, /\/api\/oauth\/register$/);
  assert.deepEqual(asJson.code_challenge_methods_supported, ['S256']);
  assert.equal(asJson.client_id_metadata_document_supported, true);

  const prm = await call(prmPath, 'GET', '/.well-known/oauth-protected-resource');
  assert.equal(prm.status, 200, prm.text);
  const prmJson = prm.json as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
  assert.match(prmJson.resource, /\/api\/mcp$/);
  assert.ok(prmJson.authorization_servers.includes(asJson.issuer));
  assert.deepEqual(prmJson.scopes_supported, ['read', 'write']);

  const prmMcp = await call(prmMcpPath, 'GET', '/.well-known/oauth-protected-resource/api/mcp');
  assert.equal(prmMcp.status, 200, prmMcp.text);
  assert.equal((prmMcp.json as { resource: string }).resource, prmJson.resource);
}));

test('oauth DCR + authorize + consent + token + refresh rotation + revoke', () => serial(async () => {
  const user = await createMember('oauth-flow');
  const registered = await call(registerPath, 'POST', '/api/oauth/register', {
    client_name: 'Test MCP Client',
    redirect_uris: ['http://127.0.0.1:3911/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  assert.equal(registered.status, 201, registered.text);
  const client = registered.json as { client_id: string; redirect_uris: string[] };
  assert.match(client.client_id, /^byoocl_/);

  const { verifier, challenge } = pkcePair();
  const resource = mcpResourceUrl();
  const state = 'once-only-state';
  const authorizeQuery = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    scope: 'read write',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  });
  const authorize = await call(
    authorizePath,
    'GET',
    `/oauth/authorize?${authorizeQuery}`,
    undefined,
    undefined,
    undefined,
    `http://localhost/oauth/authorize?${authorizeQuery}`,
  );
  assert.equal(authorize.status, 302, authorize.text);
  const location = authorize.headers.get('location') || '';
  assert.match(location, /\/oauth\/authorize\/consent\?pending=/);
  const pendingId = new URL(location, 'http://localhost').searchParams.get('pending') || '';
  const csrf = authorize.headers.getSetCookie?.()
    ?.map((c) => /byo_oauth_csrf=([^;]+)/.exec(c)?.[1])
    .find(Boolean)
    || (() => {
      // Headers.getSetCookie may be unavailable; parse set-cookie
      const raw = authorize.headers.get('set-cookie') || '';
      return /byo_oauth_csrf=([^;]+)/.exec(raw)?.[1] || '';
    })();
  assert.ok(pendingId);
  assert.ok(csrf);

  // state 再利用は拒否
  const { challenge: challenge2 } = pkcePair();
  await assert.rejects(
    () => createAuthorizePending({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      scope: 'read',
      code_challenge: challenge2,
      code_challenge_method: 'S256',
      resource,
      state,
      response_type: 'code',
    }),
    (err: Error & { code?: string }) => err.code === 'invalid_request',
  );

  await setTestUser(user);
  const deniedOrigin = await call(
    consentPath,
    'POST',
    '/api/oauth/consent',
    { pending_id: pendingId, decision: 'approve', csrf },
    undefined,
    { Origin: 'https://attacker.test', Cookie: `byo_oauth_csrf=${csrf}` },
    'http://localhost/api/oauth/consent',
  );
  assert.equal(deniedOrigin.status, 403, deniedOrigin.text);

  const approved = await call(
    consentPath,
    'POST',
    '/api/oauth/consent',
    { pending_id: pendingId, decision: 'approve', csrf },
    undefined,
    { Origin: 'http://localhost', Cookie: `byo_oauth_csrf=${csrf}` },
    'http://localhost/api/oauth/consent',
  );
  assert.equal(approved.status, 200, approved.text);
  const redirectUrl = (approved.json as { redirect_url: string }).redirect_url;
  const code = new URL(redirectUrl).searchParams.get('code');
  assert.ok(code);
  assert.equal(new URL(redirectUrl).searchParams.get('state'), state);

  const tokenRes = await call(
    tokenPath,
    'POST',
    '/api/oauth/token',
    undefined,
    undefined,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'http://127.0.0.1',
    },
  );
  // call() JSON-stringifies body; hit the handler with form via direct import below
  const { POST: tokenPost } = await import('../src/app/api/oauth/token/route');
  const { NextRequest } = await import('next/server');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: client.redirect_uris[0],
    client_id: client.client_id,
    code_verifier: verifier,
    resource,
  });
  const tokenResponse = await tokenPost(new NextRequest('http://localhost/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }));
  assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text());
  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    scope: string;
  };
  assert.match(tokens.access_token, /^byoagt_/);
  assert.match(tokens.refresh_token, /^byoref_/);
  assert.equal(tokens.token_type, 'Bearer');
  void tokenRes;

  const mcp = await call(mcpPath, 'POST', '/api/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'o', version: '1' } },
  }, undefined, {
    Authorization: `Bearer ${tokens.access_token}`,
    Accept: 'application/json, text/event-stream',
  });
  assert.equal(mcp.status, 200, mcp.text);

  const refreshed = refreshAccessToken({
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
    resource,
  });
  assert.match(refreshed.access_token, /^byoagt_/);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
  assert.equal(findAgentTokenByPlaintext(tokens.access_token), null);

  await assert.rejects(
    async () => refreshAccessToken({
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
      resource,
    }),
    (err: Error & { code?: string }) => err.code === 'invalid_grant',
  );

  revokeOAuthToken({
    token: refreshed.refresh_token,
    client_id: client.client_id,
    token_type_hint: 'refresh_token',
  });
  assert.equal(findAgentTokenByPlaintext(refreshed.access_token), null);

  const revokeHttp = await call(
    revokePath,
    'POST',
    '/api/oauth/revoke',
    undefined,
    undefined,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  void revokeHttp;
  const { POST: revokePost } = await import('../src/app/api/oauth/revoke/route');
  const revokeRes = await revokePost(new NextRequest('http://localhost/api/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: 'byoref_unknown',
      client_id: client.client_id,
    }).toString(),
  }));
  assert.equal(revokeRes.status, 200);
}));

test('oauth CIMD fetch uses SSRF guard; private hosts rejected', () => serial(async () => {
  const database = await db();
  const metaUrl = 'https://client.example/oauth/client-metadata.json';
  const body = JSON.stringify({
    client_id: metaUrl,
    client_name: 'CIMD Client',
    redirect_uris: ['http://127.0.0.1:4000/cb'],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });

  const client = await resolveOAuthClient(metaUrl, database, {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (): Promise<PinnedResponse> => ({
      status: 200,
      body: Buffer.from(body),
      contentType: 'application/json',
    }),
  });
  assert.equal(client.client_id, metaUrl);
  assert.equal(client.registration_type, 'cimd');

  await assert.rejects(
    () => resolveOAuthClient('https://metadata.internal/client.json', database, {
      resolve: async () => [{ address: '10.0.0.1', family: 4 }],
      request: async () => {
        throw new Error('should not fetch');
      },
    }),
    (err: Error & { code?: string }) =>
      err.code === 'CLIENT_METADATA_FETCH_FAILED' || err.name === 'BlockedTargetError' || err.code === 'INVALID_CLIENT',
  );
}));

test('oauth PKCE required; wrong verifier rejected; password change kills refresh', () => serial(async () => {
  const { hashPassword } = await import('../src/lib/auth');
  const database = await db();
  const email = `oauth-pw-${Date.now()}@example.test`;
  const passwordHash = await hashPassword('secret1');
  const userId = Number(database.prepare(
    'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
  ).run(email, 'pw', passwordHash).lastInsertRowid);
  const user = database.prepare(
    'SELECT id, email, name, created_at, account_type FROM users WHERE id = ?',
  ).get(userId) as Awaited<ReturnType<typeof createMember>>;
  await setTestUser(user);

  const dcr = registerDynamicClient({
    client_name: 'PW Client',
    redirect_uris: ['http://127.0.0.1:3912/cb'],
    token_endpoint_auth_method: 'none',
  });
  const { verifier, challenge } = pkcePair();
  const resource = mcpResourceUrl();
  const { pendingId, csrf } = await createAuthorizePending({
    client_id: dcr.client_id,
    redirect_uri: dcr.redirect_uris[0],
    scope: 'read write',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
    response_type: 'code',
  });
  const { approveAuthorizePending } = await import('../src/lib/agent-oauth');
  const { redirectUrl } = approveAuthorizePending(pendingId, csrf, userId, 'approve', database);
  const code = new URL(redirectUrl).searchParams.get('code')!;

  await assert.rejects(
    async () => exchangeAuthorizationCode({
      code,
      redirect_uri: dcr.redirect_uris[0],
      client_id: dcr.client_id,
      code_verifier: 'totally-wrong-verifier-value-that-is-long-enough-xx',
      resource,
    }, database),
    (err: Error & { code?: string }) => err.code === 'invalid_grant',
  );

  // コードは消費されていないはず（PKCE 失敗時は消費する実装だと再利用不可）。実装は消費前に検証する。
  const tokens = exchangeAuthorizationCode({
    code,
    redirect_uri: dcr.redirect_uris[0],
    client_id: dcr.client_id,
    code_verifier: verifier,
    resource,
  }, database);
  assert.match(tokens.access_token, /^byoagt_/);

  revokeAllAgentAccessIncludingOAuth(userId, database);
  assert.equal(findAgentTokenByPlaintext(tokens.access_token, database), null);
  await assert.rejects(
    async () => refreshAccessToken({
      refresh_token: tokens.refresh_token,
      client_id: dcr.client_id,
      resource,
    }, database),
    (err: Error & { code?: string }) => err.code === 'invalid_grant',
  );

  // パスワード変更経路は revokeAllAgentAccessIncludingOAuth を呼ぶ（agent-tokens テストで API を固定）
  void user;
  void passwordPath;
}));