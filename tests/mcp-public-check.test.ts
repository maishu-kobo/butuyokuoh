import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMcpPublicConfiguration } from '../scripts/check-mcp-public.mjs';

const origin = 'https://wishlist.example.test';
const resource = `${origin}/api/mcp`;
const prmPath = '/.well-known/oauth-protected-resource/api/mcp';
const asPath = '/.well-known/oauth-authorization-server';

function fixture(advertised = origin) {
  return new Map<string, { status: number; body: unknown; headers?: Record<string, string> }>([
    [prmPath, { status: 200, body: { resource: `${advertised}/api/mcp`, authorization_servers: [advertised] } }],
    [asPath, { status: 200, body: {
      issuer: advertised, authorization_endpoint: `${advertised}/oauth/authorize`,
      token_endpoint: `${advertised}/api/oauth/token`, registration_endpoint: `${advertised}/api/oauth/register`,
      revocation_endpoint: `${advertised}/api/oauth/revoke`, code_challenge_methods_supported: ['S256'],
    } }],
    ['/api/mcp', { status: 401, body: {}, headers: { 'www-authenticate': `Bearer resource_metadata="${advertised}${prmPath}"` } }],
    ['/help/agents', { status: 200, body: `<code title="${advertised}/api/mcp">${advertised}/api/mcp</code>` }],
  ]);
}

function transport(rows = fixture()) {
  return async (url: string | URL | Request, options?: RequestInit) => {
    const target = new URL(String(url));
    assert.equal(target.origin, origin, 'never follow an advertised third-party origin');
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal, 'each request has a timeout');
    assert.equal(new Headers(options?.headers).has('authorization'), false);
    assert.equal(options?.method, target.pathname === '/api/mcp' ? 'POST' : 'GET');
    const row = rows.get(target.pathname)!;
    assert.ok(row, target.pathname);
    return new Response(typeof row.body === 'string' ? row.body : JSON.stringify(row.body), {
      status: row.status, headers: row.headers,
    });
  };
}

test('public MCP check passes without cookies or tokens and checks a registered client URL', async () => {
  const result = await checkMcpPublicConfiguration(origin, { fetchImpl: transport(), clientUrls: [resource] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.checks.length >= 10);
});

test('all discovery documents consistently advertising the old port still fail', async () => {
  const result = await checkMcpPublicConfiguration(origin, { fetchImpl: transport(fixture(`${origin}:8000`)) });
  assert.equal(result.ok, false);
  assert.ok(result.checks.filter((c) => !c.ok).length >= 6);
});

test('each advertised endpoint and the displayed URL must independently match the expected public origin', async (t) => {
  const fields = ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint'];
  for (const field of fields) {
    await t.test(field, async () => {
      const rows = fixture();
      (rows.get(asPath)!.body as Record<string, unknown>)[field] = 'https://wrong.example.test:8000';
      assert.equal((await checkMcpPublicConfiguration(origin, { fetchImpl: transport(rows) })).ok, false);
    });
  }
  for (const path of [prmPath, '/api/mcp', '/help/agents']) {
    const rows = fixture();
    rows.set(path, fixture('https://wrong.example.test').get(path)!);
    assert.equal((await checkMcpPublicConfiguration(origin, { fetchImpl: transport(rows) })).ok, false);
  }
});

test('a healthy server does not conceal a stale Claude Code registration', async () => {
  for (const url of [`${origin}:8000/api/mcp`, `${origin}/wrong`, 'https://other.example.test/api/mcp']) {
    const result = await checkMcpPublicConfiguration(origin, { fetchImpl: transport(), clientUrls: [url] });
    assert.equal(result.ok, false);
    assert.equal(result.checks.find((c) => c.name === 'client URL 1')?.ok, false);
  }
});

test('unreachable, redirected, invalid JSON and unexpected status responses fail without leaking bodies', async () => {
  const secret = 'private-response-content';
  for (const response of [
    () => { throw new Error(secret); },
    () => new Response(secret, { status: 502 }),
    () => new Response(secret, { status: 302, headers: { location: 'https://other.example.test' } }),
    () => new Response(secret, { status: 200 }),
    () => Response.json(null),
  ]) {
    const result = await checkMcpPublicConfiguration(origin, { fetchImpl: response });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('help scripts mentioning the correct URL cannot conceal a wrong visible connection URL', async () => {
  const rows = fixture();
  rows.get('/help/agents')!.body = `<script>${resource}</script><code>${origin}:8000/api/mcp</code>`;
  assert.equal((await checkMcpPublicConfiguration(origin, { fetchImpl: transport(rows) })).ok, false);
});

test('unsafe or ambiguous expected origins are rejected before network access', async () => {
  for (const value of ['http://example.test', `${origin}/path`, `${origin}?query=1`, 'https://user:secret@example.test', 'invalid']) {
    await assert.rejects(checkMcpPublicConfiguration(value, { fetchImpl: () => { throw new Error('must not fetch'); } }), /public origin/);
  }
});
