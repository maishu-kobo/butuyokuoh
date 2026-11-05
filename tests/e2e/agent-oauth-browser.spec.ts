import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const origin = 'http://localhost:3107';
const resource = `${origin}/api/mcp`;
const callback = 'http://127.0.0.1:3920/callback';
const password = 'oauth-browser-test-only';
const verifier = 'browser-e2e-verifier-'.repeat(3);
const challenge = createHash('sha256').update(verifier).digest('base64url');

// Synthetic identities and data only. Never reuse browser auth or a production DB.
function seedMember(scenario: string) {
  const dbPath = process.env.E2E_DB_PATH;
  expect(dbPath).toBeTruthy();
  const db = new Database(dbPath!);
  try {
    const email = `oauth-browser-${scenario}@example.test`;
    const hash = bcrypt.hashSync(password, 4);
    const owner = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
      .run(email, `Browser ${scenario}`, hash).lastInsertRowid;
    const foreign = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
      .run(`oauth-foreign-${scenario}@example.test`, 'Other user', hash).lastInsertRowid;
    const group = Number(db.prepare('INSERT INTO comparison_groups (user_id, name) VALUES (?, ?)')
      .run(owner, 'E2E visible group').lastInsertRowid);
    db.prepare('INSERT INTO comparison_groups (user_id, name) VALUES (?, ?)').run(foreign, 'E2E private group');
    return { email, group };
  } finally { db.close(); }
}

async function begin(api: APIRequestContext, page: Page, scenario: string, explicitResource: boolean) {
  const registration = await api.post('/api/oauth/register', { data: {
    client_name: 'Browser E2E', redirect_uris: [callback], token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  } });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = await registration.json();
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: callback, scope: 'read',
    state: `browser-${scenario}`, code_challenge: challenge, code_challenge_method: 'S256',
    ...(explicitResource ? { resource } : {}),
  });
  // Only the client callback is intercepted. Login, consent and token APIs are real.
  await page.route(`${callback}?**`, (route) => route.fulfill({ contentType: 'text/plain', body: 'OAuth callback received' }));
  await page.goto(`${origin}/oauth/authorize?${params}`);
  await expect(page.getByText('エージェント連携の認可には会員ログインが必要です（ゲスト不可）')).toBeVisible();
  await expect(page.getByRole('button', { name: '許可する', exact: true })).toHaveCount(0);
  return clientId as string;
}

async function loginAndDecide(page: Page, email: string, decision: '許可する' | '拒否する', scenario: string) {
  await page.getByPlaceholder('email@example.com').fill(email);
  await page.getByPlaceholder('6文字以上').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'エージェント連携の許可' })).toBeVisible();
  await expect(page.getByText(resource, { exact: true })).toBeVisible();
  await expect(page.getByText('read', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: decision, exact: true }).click();
  await page.waitForURL(`${callback}?**`);
  const result = new URL(page.url());
  expect(result.searchParams.get('state')).toBe(`browser-${scenario}`);
  expect(result.searchParams.get('iss')).toBe(origin);
  return result.searchParams;
}

async function rpc(api: APIRequestContext, token: string, method: string, params?: object) {
  const response = await api.post('/api/mcp', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method, params },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

for (const explicitResource of [true, false]) {
  const scenario = explicitResource ? 'explicit' : 'omitted';
  test(`OAuth browser: logged out to list, refresh and write denial (${scenario} resource)`, async ({ page, context }) => {
    expect(await context.cookies()).toEqual([]);
    // Independent from the browser: OAuth bearer tokens must work without its login cookie.
    const api = await playwrightRequest.newContext({ baseURL: origin });
    try {
      const unauth = await api.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
      expect(unauth.status()).toBe(401);
      const metadataUrl = /resource_metadata="([^"]+)"/.exec(unauth.headers()['www-authenticate'])?.[1];
      expect(metadataUrl).toBe(`${origin}/.well-known/oauth-protected-resource/api/mcp`);
      const metadata = await api.get(metadataUrl!);
      expect(metadata.status()).toBe(200);
      const prm = await metadata.json();
      expect(prm.resource).toBe(resource);
      expect(prm.authorization_servers).toEqual([origin]);
      const asResponse = await api.get(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`);
      expect(asResponse.status()).toBe(200);
      const as = await asResponse.json();
      expect(as.authorization_endpoint).toBe(`${origin}/oauth/authorize`);
      expect(as.token_endpoint).toBe(`${origin}/api/oauth/token`);

      const clientId = await begin(api, page, scenario, explicitResource);
      const user = seedMember(scenario);
      const callbackParams = await loginAndDecide(page, user.email, '許可する', scenario);
      const code = callbackParams.get('code');
      expect(code).toBeTruthy();
      const resourceParam: Record<string, string> = explicitResource ? { resource } : {};
      const tokenResponse = await api.post(as.token_endpoint, { form: {
        grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback,
        code: code!, code_verifier: verifier, ...resourceParam,
      } });
      expect(tokenResponse.status()).toBe(200);
      const tokens = await tokenResponse.json();
      expect(tokens.scope).toBe('read');
      expect((await api.storageState()).cookies).toEqual([]);
      const initialized = await rpc(api, tokens.access_token, 'initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'browser-e2e', version: '1' },
      });
      expect(initialized.result.protocolVersion).toBe('2025-11-25');
      const notified = await api.post('/api/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` },
        data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
      expect(notified.status()).toBe(202);
      const tools = (await rpc(api, tokens.access_token, 'tools/list')).result.tools.map((tool: { name: string }) => tool.name);
      expect(tools).toContain('list_comparison_groups');
      expect(tools).not.toContain('create_comparison_group');
      const read = async (bearer: string) => {
        const result = await rpc(api, bearer, 'tools/call', { name: 'list_comparison_groups', arguments: {} });
        expect(result.result.isError).toBe(false);
        expect(result.result.structuredContent.data.groups).toEqual([
          { id: user.group, name: 'E2E visible group', origin: null, item_count: 0 },
        ]);
      };
      await read(tokens.access_token);
      const denied = await rpc(api, tokens.access_token, 'tools/call', {
        name: 'create_comparison_group', arguments: { name: 'must not be created' },
      });
      expect(denied.error.data.code).toBe('AGENT_SCOPE_DENIED');
      await read(tokens.access_token);
      const refreshForm = { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, ...resourceParam };
      const refreshed = await api.post(as.token_endpoint, { form: refreshForm });
      expect(refreshed.status()).toBe(200);
      const fresh = await refreshed.json();
      expect(fresh.access_token).not.toBe(tokens.access_token);
      expect(fresh.refresh_token).not.toBe(tokens.refresh_token);
      await read(fresh.access_token);
      expect((await api.post(as.token_endpoint, { form: refreshForm })).status()).toBe(400);
    } finally { await api.dispose(); }
  });
}

test('OAuth browser: denial returns no code and grants no tokens', async ({ page, context }) => {
  expect(await context.cookies()).toEqual([]);
  const api = await playwrightRequest.newContext({ baseURL: origin });
  try {
    const clientId = await begin(api, page, 'denied', true);
    const user = seedMember('denied');
    const result = await loginAndDecide(page, user.email, '拒否する', 'denied');
    expect(result.get('error')).toBe('access_denied');
    expect(result.has('code')).toBe(false);
    const db = new Database(process.env.E2E_DB_PATH!);
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM agent_tokens WHERE oauth_client_id = ?').get(clientId)).toEqual({ n: 0 });
    } finally { db.close(); }
  } finally { await api.dispose(); }
});
