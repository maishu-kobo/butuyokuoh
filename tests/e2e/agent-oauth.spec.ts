import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const origin = 'http://localhost:3107';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return { verifier, challenge };
}

test('agent oauth: metadata, DCR, consent CSP, code+PKCE token, MCP 401 challenge', async () => {
  const api = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    const asMeta = await api.get('/.well-known/oauth-authorization-server');
    expect(asMeta.status()).toBe(200);
    const asJson = await asMeta.json();
    expect(asJson.client_id_metadata_document_supported).toBe(true);
    expect(asJson.code_challenge_methods_supported).toContain('S256');
    expect(asJson.authorization_endpoint).toContain('/oauth/authorize');

    const prm = await api.get('/.well-known/oauth-protected-resource/api/mcp');
    expect(prm.status()).toBe(200);
    const prmJson = await prm.json();
    expect(prmJson.resource).toBe(`${origin}/api/mcp`);

    const mcpUnauth = await api.post('/api/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      },
    });
    expect(mcpUnauth.status()).toBe(401);
    expect(mcpUnauth.headers()['www-authenticate'] || '').toContain('resource_metadata=');

    const dcr = await api.post('/api/oauth/register', {
      data: {
        client_name: 'E2E MCP',
        redirect_uris: ['http://127.0.0.1:3920/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    });
    expect(dcr.status()).toBe(201);
    const client = await dcr.json();

    const db = new Database(process.env.E2E_DB_PATH!);
    const email = `oauth-e2e-${Date.now()}@example.test`;
    const hash = bcrypt.hashSync('secret1', 4);
    const userId = Number(db.prepare(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
    ).run(email, 'oauth-e2e', hash).lastInsertRowid);
    db.close();

    const login = await api.post('/api/auth/login', {
      data: { email, password: 'secret1' },
    });
    expect(login.status()).toBe(200);

    const { verifier, challenge } = pkce();
    const resource = `${origin}/api/mcp`;
    const authorize = await api.get('/oauth/authorize', {
      maxRedirects: 0,
      params: {
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        scope: 'read write',
        state: 'e2e-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource,
      },
    });
    expect(authorize.status()).toBe(302);
    const consentLocation = authorize.headers()['location'] || '';
    expect(consentLocation).toContain('/oauth/authorize/consent?pending=');

    const consentPage = await api.get(consentLocation);
    expect(consentPage.status()).toBe(200);
    const csp = consentPage.headers()['content-security-policy'] || '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(consentPage.headers()['x-frame-options'] || '').toMatch(/DENY/i);

    // pending + csrf from authorize Set-Cookie
    const setCookie = authorize.headers()['set-cookie'] || '';
    const csrf = /byo_oauth_csrf=([^;]+)/.exec(Array.isArray(setCookie) ? setCookie.join(';') : setCookie)?.[1];
    expect(csrf).toBeTruthy();
    const pending = new URL(consentLocation, origin).searchParams.get('pending');
    expect(pending).toBeTruthy();

    // 認可の CSRF Cookie を既存のログイン Cookie と一緒に載せる（上書きしない）
    const storage = await api.storageState();
    const cookieHeader = [
      ...storage.cookies.map((c) => `${c.name}=${c.value}`),
      `byo_oauth_csrf=${csrf}`,
    ].join('; ');
    const consent = await api.post('/api/oauth/consent', {
      headers: { Cookie: cookieHeader },
      data: { pending_id: pending, decision: 'approve', csrf },
    });
    expect(consent.status()).toBe(200);
    const { redirect_url: redirectUrl } = await consent.json();
    const code = new URL(redirectUrl).searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await api.post('/api/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: client.redirect_uris[0],
        client_id: client.client_id,
        code_verifier: verifier,
        resource,
      },
    });
    expect(token.status()).toBe(200);
    const tokens = await token.json();
    expect(tokens.access_token).toMatch(/^byoagt_/);
    expect(tokens.refresh_token).toMatch(/^byoref_/);

    const mcp = await api.post('/api/mcp', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      },
    });
    expect(mcp.status()).toBe(200);

    void userId;
  } finally {
    await api.dispose();
  }
});
