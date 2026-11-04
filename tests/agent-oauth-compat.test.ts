import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { call, createMember, db } from './regression-harness';
import { buildAuthorizationServerMetadata, buildProtectedResourceMetadata, mcpResourceUrlFromHeaders, oauthIssuer, oauthWwwAuthenticate, pkceChallengeS256, resolveOAuthClient } from '../src/lib/agent-oauth';
import { POST as tokenPost } from '../src/app/api/oauth/token/route';

const origin = 'https://wishlist.example.test';
const resource = `${origin}/api/mcp`;
const clientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(43);

test('Claude OAuth compatibility keeps a single configured audience', async (t) => {
  const keys = ['MCP_PUBLIC_ORIGIN', 'AUTH_URL', 'NEXTAUTH_URL', 'GUEST_ALLOWED_ORIGINS'] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2035-01-01T00:00:00Z') });
  process.env.MCP_PUBLIC_ORIGIN = origin;
  process.env.AUTH_URL = 'https://login.example.test:8000';
  process.env.NEXTAUTH_URL = process.env.AUTH_URL;
  delete process.env.GUEST_ALLOWED_ORIGINS;

  await t.test('public MCP discovery and display do not change the login callback origin', () => {
    assert.equal(oauthIssuer(), origin);
    assert.equal(mcpResourceUrlFromHeaders(new Headers({ host: 'untrusted.example', 'x-forwarded-proto': 'http' })), resource);
    assert.equal(buildAuthorizationServerMetadata().token_endpoint, `${origin}/api/oauth/token`);
    assert.equal(buildProtectedResourceMetadata().resource, resource);
    assert.match(oauthWwwAuthenticate(), /https:\/\/wishlist\.example\.test\/\.well-known/);
    assert.equal(process.env.AUTH_URL, 'https://login.example.test:8000');
  });

  await t.test('invalid explicit public origins fail instead of falling back', () => {
    try {
      for (const value of ['not-a-url', `${origin}/path`, `${origin}?x=1`, `${origin}#fragment`, 'https://user:pass@example.test', 'ftp://example.test']) {
        process.env.MCP_PUBLIC_ORIGIN = value;
        assert.throws(() => oauthIssuer(), /MCP_PUBLIC_ORIGIN/);
      }
    } finally {
      process.env.MCP_PUBLIC_ORIGIN = origin;
    }
  });

  const database = await db();
  await createMember('claude-compat');
  let fetches = 0;
  await resolveOAuthClient(clientId, database, {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      fetches++;
      return { status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify({
        client_id: clientId, client_name: 'Claude', redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
      })) };
    },
  });
  assert.equal(fetches, 1);

  const authorizeParams = () => new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'read',
    code_challenge: pkceChallengeS256(verifier), code_challenge_method: 'S256',
  });
  const authorize = (params: URLSearchParams) => call('../src/app/oauth/authorize/route.ts', 'GET', '/oauth/authorize', undefined, undefined, undefined, `${origin}/oauth/authorize?${params}`);
  const token = (params: URLSearchParams) => tokenPost(new NextRequest(`${origin}/api/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  }));

  await t.test('explicit invalid resource values are rejected at authorization', async () => {
    for (const value of ['', 'https://other.example/api/mcp']) {
      const params = authorizeParams();
      params.set('resource', value);
      const response = await authorize(params);
      assert.match(response.headers.get('location') ?? response.text, /invalid_request|resource/);
      const row = database.prepare('SELECT COUNT(*) AS n FROM agent_oauth_pending').get() as { n: number };
      assert.equal(row.n, 0);
    }
  });

  await t.test('omitted resource supports consent, token exchange, MCP and refresh without weakening PKCE or audience checks', async () => {
    const response = await authorize(authorizeParams());
    assert.equal(response.status, 302, response.text);
    const consentUrl = new URL(response.headers.get('location')!);
    assert.equal(consentUrl.origin, origin);
    assert.equal(consentUrl.pathname, '/oauth/authorize/consent');
    const pending = consentUrl.searchParams.get('pending')!;
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const csrf = cookie.slice(cookie.indexOf('=') + 1);
    const wrongOrigin = await call('../src/app/api/oauth/consent/route.ts', 'POST', '/api/oauth/consent',
      { pending_id: pending, decision: 'approve', csrf }, undefined, { Origin: 'https://other.example', Cookie: cookie }, `${origin}/api/oauth/consent`);
    assert.equal(wrongOrigin.status, 403);
    const consent = await call('../src/app/api/oauth/consent/route.ts', 'POST', '/api/oauth/consent',
      { pending_id: pending, decision: 'approve', csrf }, undefined, { Origin: origin, Cookie: cookie }, `${origin}/api/oauth/consent`);
    assert.equal(consent.status, 200, consent.text);
    const code = new URL((consent.json as { redirect_url: string }).redirect_url).searchParams.get('code')!;
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier });
    for (const value of ['', 'https://other.example/api/mcp']) {
      const invalid = new URLSearchParams(form);
      invalid.set('resource', value);
      assert.equal((await token(invalid)).status, 400);
    }
    const duplicate = new URLSearchParams(form);
    duplicate.append('resource', resource);
    duplicate.append('resource', 'https://other.example/api/mcp');
    assert.equal((await token(duplicate)).status, 400);
    for (const invalidResource of [null, 42, [resource]]) {
      const invalidJson = await tokenPost(new NextRequest(`${origin}/api/oauth/token`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(form), resource: invalidResource }),
      }));
      assert.equal(invalidJson.status, 400);
    }
    const badPkce = new URLSearchParams(form);
    badPkce.set('code_verifier', 'x'.repeat(43));
    assert.equal((await token(badPkce)).status, 400);
    const issued = await token(form);
    assert.equal(issued.status, 200, await issued.clone().text());
    const tokens = await issued.json();
    assert.equal(tokens.scope, 'read');
    assert.equal((await token(form)).status, 400, 'authorization code cannot be reused');
    const stored = database.prepare('SELECT oauth_resource FROM agent_tokens WHERE oauth_client_id = ?').get(clientId) as { oauth_resource: string };
    assert.equal(stored.oauth_resource, resource);
    const mcp = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'compat-test', version: '1' } } }, undefined, { Authorization: `Bearer ${tokens.access_token}` }, `${origin}/api/mcp`);
    assert.equal(mcp.status, 200, mcp.text);
    const listed = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp',
      { jsonrpc: '2.0', id: 2, method: 'tools/list' }, undefined,
      { Authorization: `Bearer ${tokens.access_token}` }, `${origin}/api/mcp`);
    assert.equal(listed.status, 200, listed.text);
    process.env.MCP_PUBLIC_ORIGIN = 'https://different.example.test';
    try {
      const wrongServer = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp',
        { jsonrpc: '2.0', id: 3, method: 'tools/list' }, undefined,
        { Authorization: `Bearer ${tokens.access_token}` }, 'https://different.example.test/api/mcp');
      assert.equal(wrongServer.status, 401, wrongServer.text);
    } finally {
      process.env.MCP_PUBLIC_ORIGIN = origin;
    }
    const refresh = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token });
    const wrongAudience = new URLSearchParams(refresh);
    wrongAudience.set('resource', 'https://other.example/api/mcp');
    assert.equal((await token(wrongAudience)).status, 400);
    const refreshed = await token(refresh);
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    assert.notEqual((await refreshed.json()).access_token, tokens.access_token);
    assert.equal((await token(refresh)).status, 400, 'refresh tokens rotate');
  });

  await t.test('non-object token JSON is a client error', async () => {
    for (const body of [null, 42, [], 'resource']) {
      const response = await tokenPost(new NextRequest(`${origin}/api/oauth/token`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }));
      assert.equal(response.status, 400);
    }
  });
});
