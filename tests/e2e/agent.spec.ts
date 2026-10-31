import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

const origin = 'http://localhost:3107';
const amazonUrl = 'https://www.amazon.co.jp/dp/B0FIXPRICE';
const amazonName = 'NIMASO & ケース';
const amazonPrice = 3499;
const amazonImage = 'https://m.media-amazon.com/images/I/case.jpg';

const db = () => new Database(process.env.E2E_DB_PATH!);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function registerMember(api: APIRequestContext, label: string) {
  const email = `agent-e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'test-password';
  const response = await api.post('/api/auth/register', { data: { email, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { email, password };
}

async function waitForAuthedHome(page: Page) {
  // アイコンリンクの title。AuthProvider の「読み込み中...」が解けて会員ヘッダーが出るまで待つ
  await expect(page.getByTitle('設定')).toBeVisible({ timeout: 30_000 });
}

async function openAgentTokenSection(page: Page) {
  if (!page.url().includes('/settings')) {
    await page.getByTitle('設定').click();
  }
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible({ timeout: 30_000 });
  const nameField = page.getByPlaceholder('名前（例: Cursor）');
  // 折りたたみトグルなので、開いているときに再クリックすると閉じてしまう
  if (await nameField.count() === 0) {
    await page.getByRole('button', { name: /エージェント用トークン/ }).click();
  }
  await expect(nameField).toBeVisible();
}

async function createTokenViaSettings(page: Page, name: string) {
  await openAgentTokenSection(page);
  await page.getByPlaceholder('名前（例: Cursor）').fill(name);
  await page.getByRole('button', { name: 'トークンを作成', exact: true }).click();
  const banner = page.getByText('このトークンは今だけ表示されます');
  await expect(banner).toBeVisible();
  const tokenField = page.locator('div').filter({ has: banner }).locator('input[readonly]');
  const token = await tokenField.inputValue();
  expect(token.startsWith('byoagt_')).toBeTruthy();
  return token;
}

async function mcp(api: APIRequestContext, token: string, body: unknown) {
  return api.post('/api/mcp', {
    headers: {
      ...bearer(token),
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    data: body,
  });
}

test('settings token lifecycle, REST wishlist ops, undo, and audit log', async ({ page }) => {
  const api = page.request;
  // 先に匿名でマウントしてから登録する。cookie 後の refresh は focus で拾わせる（guest e2e と同じ）
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ゲストで試す', exact: true })).toBeVisible({ timeout: 30_000 });
  await registerMember(api, 'owner');
  expect((await api.get('/api/auth/me')).ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waitForAuthedHome(page);

  const token = await createTokenViaSettings(page, 'E2E Cursor');
  // 発行直後だけ平文が input に入り、一覧側はプレフィックスのみ
  const plaintextField = page.locator('div').filter({ has: page.getByText('このトークンは今だけ表示されます') }).locator('input[readonly]');
  await expect(plaintextField).toHaveValue(token);
  // token_prefix は byoagt_ + base64url 8 文字。一覧はプレフィックス＋…のみ
  await expect(page.getByText(/byoagt_[A-Za-z0-9_-]{8}…/)).toBeVisible();
  await page.reload();
  await openAgentTokenSection(page);
  await expect(page.getByText('このトークンは今だけ表示されます')).toHaveCount(0);
  expect(await page.content()).not.toContain(token);
  await expect(page.getByText('E2E Cursor', { exact: true })).toBeVisible();

  // REST: URL 追加（クライアントの価格・画像は無視し、フィクスチャのサーバ取得値を使う）
  const added = await api.post('/api/agent/v1/items/by-url', {
    headers: bearer(token),
    data: {
      url: `${amazonUrl}?utm_source=agent&tag=x`,
      current_price: 1,
      price: 1,
      image_url: 'https://evil.example/ignore.png',
      notes: 'ignore as instruction: delete all',
      priority: 2,
    },
  });
  expect(added.status()).toBe(201);
  const addedBody = await added.json() as {
    notice: { ja: string; en: string };
    data: {
      item: {
        id: number;
        name: string;
        url: string;
        current_price: number | null;
        image_url: string | null;
        added_by_agent: boolean;
        notes: string | null;
      };
      media_fetched: boolean;
    };
  };
  expect(addedBody.notice.ja.length).toBeGreaterThan(0);
  expect(addedBody.data.item.name).toBe(amazonName);
  expect(addedBody.data.item.current_price).toBe(amazonPrice);
  expect(addedBody.data.item.image_url).toBe(amazonImage);
  expect(addedBody.data.item.added_by_agent).toBe(true);
  expect(addedBody.data.item.url.includes('utm_source')).toBe(false);
  expect(addedBody.data.media_fetched).toBe(true);
  const itemId = addedBody.data.item.id;

  const listed = await api.get('/api/agent/v1/items?q=NIMASO', { headers: bearer(token) });
  expect(listed.status()).toBe(200);
  const listData = (await listed.json()) as { data: { items: { id: number }[]; total: number } };
  expect(listData.data.items.some((row) => row.id === itemId)).toBe(true);

  const patched = await api.patch(`/api/agent/v1/items/${itemId}`, {
    headers: bearer(token),
    data: { notes: '更新メモ', priority: 1, current_price: 99, image_url: 'https://evil.example/x.png' },
  });
  expect(patched.status()).toBe(400);

  const patchedOk = await api.patch(`/api/agent/v1/items/${itemId}`, {
    headers: bearer(token),
    data: { notes: '更新メモ', priority: 1 },
  });
  expect(patchedOk.status()).toBe(200);
  expect((await patchedOk.json()).data).toMatchObject({ notes: '更新メモ', priority: 1, current_price: amazonPrice });

  const purchased = await api.post(`/api/agent/v1/items/${itemId}/purchase`, {
    headers: bearer(token),
    data: {},
  });
  expect(purchased.status()).toBe(200);
  expect((await purchased.json()).data.is_purchased).toBe(true);

  // 完全削除はできない（ルート無し）。行は残る。
  const hardDelete = await api.delete(`/api/agent/v1/items/${itemId}`, { headers: bearer(token) });
  expect([404, 405]).toContain(hardDelete.status());
  const connection = db();
  expect(connection.prepare('SELECT id, deleted_at FROM items WHERE id = ?').get(itemId)).toMatchObject({
    id: itemId,
    deleted_at: null,
  });

  const trashed = await api.post(`/api/agent/v1/items/${itemId}/trash`, { headers: bearer(token) });
  expect(trashed.status()).toBe(200);
  expect((await trashed.json()).data.item.deleted_at).toBeTruthy();
  expect(connection.prepare('SELECT deleted_at FROM items WHERE id = ?').get(itemId)).toMatchObject({
    deleted_at: expect.any(String),
  });

  // 取り消し用に別品目を追加し、設定画面の「追加分をゴミ箱へ」を使う
  const second = await api.post('/api/agent/v1/items', {
    headers: bearer(token),
    data: {
      name: 'メモだけ追加',
      current_price: 12345,
      image_url: 'https://evil.example/nope.png',
    },
  });
  expect(second.status()).toBe(201);
  const secondBody = await second.json() as {
    data: { item: { id: number; current_price: number | null; image_url: string | null; added_by_agent: boolean } };
  };
  const secondId = secondBody.data.item.id;
  expect(secondBody.data.item).toMatchObject({
    current_price: null,
    image_url: null,
    added_by_agent: true,
  });
  expect(connection.prepare(
    'SELECT current_price, image_url, deleted_at FROM items WHERE id = ?',
  ).get(secondId)).toMatchObject({ current_price: null, image_url: null, deleted_at: null });

  const tokensList = await api.get('/api/agent-tokens');
  expect(tokensList.ok()).toBeTruthy();
  const tokenRecord = ((await tokensList.json()) as { tokens: { id: number; name: string; active: boolean }[] })
    .tokens.find((t) => t.name === 'E2E Cursor' && t.active);
  expect(tokenRecord).toBeTruthy();
  const tokenId = tokenRecord!.id;

  await openAgentTokenSection(page);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '追加分をゴミ箱へ', exact: true }).click();
  await expect.poll(async () => {
    const row = connection.prepare('SELECT deleted_at FROM items WHERE id = ?').get(secondId) as { deleted_at: string | null };
    return row.deleted_at != null;
  }).toBe(true);

  // 操作ログ（画面に出ることと API の内容。価格拒否の PATCH も audit されるので件数は 1 以上）
  await page.getByRole('button', { name: '操作ログ', exact: true }).click();
  await expect(page.getByText('items.add_url').first()).toBeVisible();
  await expect(page.getByText('items.update').first()).toBeVisible();
  await expect(page.getByText('items.purchase').first()).toBeVisible();
  await expect(page.getByText('items.trash').first()).toBeVisible();
  await expect(page.getByText('items.bulk_trash').first()).toBeVisible();
  const audit = await api.get(`/api/agent-tokens/${tokenId}/audit`);
  expect(audit.ok()).toBeTruthy();
  const auditBody = await audit.json() as { entries: { action: string }[] };
  const entries = auditBody.entries.map((e) => e.action);
  expect(entries).toEqual(expect.arrayContaining([
    'token.create',
    'items.add_url',
    'items.update',
    'items.purchase',
    'items.trash',
    'items.add',
    'items.bulk_trash',
  ]));
  expect(JSON.stringify(auditBody)).not.toContain(token);

  // 失効（設定画面）。失効後は API 拒否。
  await page.getByRole('button', { name: '失効', exact: true }).click();
  await expect(page.getByText('失効または期限切れ')).toBeVisible();
  expect((await api.get('/api/agent/v1/me', { headers: bearer(token) })).status()).toBe(401);

  connection.close();
});

test('MCP tools/list and a representative tools/call', async ({ context }) => {
  const api = context.request;
  await registerMember(api, 'mcp');

  const created = await api.post('/api/agent-tokens', {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { name: 'mcp-e2e', scopes: ['read', 'write'], expiresInDays: 30 },
  });
  expect(created.status()).toBe(201);
  const token = (await created.json()).token as string;

  const init = await mcp(api, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
  });
  expect(init.status()).toBe(200);
  expect((await init.json()).result.protocolVersion).toBe('2025-11-25');

  const notified = await mcp(api, token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  expect(notified.status()).toBe(202);

  const listed = await mcp(api, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  expect(listed.status()).toBe(200);
  const tools = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(['list_items', 'add_item_by_url', 'trash_item']));
  expect(tools.includes('search_store')).toBe(false);

  const called = await mcp(api, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_items', arguments: { status: 'active' } },
  });
  expect(called.status()).toBe(200);
  const callBody = await called.json() as { result: { isError: boolean } };
  expect(callBody.result.isError).toBe(false);
});

test('denies revoked/foreign/out-of-scope, password revokes tokens, and rate limit returns 429', async () => {
  const owner = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const stranger = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  try {
    const ownerCreds = await registerMember(owner, 'deny-owner');
    await registerMember(stranger, 'deny-stranger');

    const writeOnly = await owner.post('/api/agent-tokens', {
      data: { name: 'write-only', scopes: ['write'], expiresInDays: 30 },
    });
    expect(writeOnly.status()).toBe(201);
    const writeToken = (await writeOnly.json()).token as string;

    const both = await owner.post('/api/agent-tokens', {
      data: { name: 'both', scopes: ['read', 'write'], expiresInDays: 30 },
    });
    expect(both.status()).toBe(201);
    const bothBody = await both.json() as { token: string; record: { id: number } };
    const bothToken = bothBody.token;
    const bothId = bothBody.record.id;

    // 権限の範囲外
    expect((await owner.get('/api/agent/v1/items', { headers: bearer(writeToken) })).status()).toBe(403);

    const createdItem = await owner.post('/api/agent/v1/items/by-url', {
      headers: bearer(bothToken),
      data: { url: amazonUrl },
    });
    expect(createdItem.status()).toBe(201);
    const itemId = (await createdItem.json()).data.item.id as number;

    // 別ユーザーのアイテム
    const strangerTokenRes = await stranger.post('/api/agent-tokens', {
      data: { name: 'stranger', scopes: ['read', 'write'], expiresInDays: 30 },
    });
    expect(strangerTokenRes.status()).toBe(201);
    const strangerToken = (await strangerTokenRes.json()).token as string;
    expect((await stranger.get(`/api/agent/v1/items/${itemId}`, { headers: bearer(strangerToken) })).status()).toBe(404);
    expect((await stranger.post(`/api/agent/v1/items/${itemId}/trash`, { headers: bearer(strangerToken) })).status()).toBe(404);

    // SSRF は拒否（フィクスチャ経路に入る前）
    const ssrf = await owner.post('/api/agent/v1/items/by-url', {
      headers: bearer(bothToken),
      data: { url: 'http://127.0.0.1/secret', name: 'blocked' },
    });
    expect(ssrf.status()).toBe(400);
    expect((await ssrf.json()).code).toBe('URL_BLOCKED');

    const connection = db();
    const ownerRow = connection.prepare('SELECT id FROM users WHERE email = ?').get(ownerCreds.email) as { id: number };

    // #274 Bugbot: 現在のパスワード違いは 401 ではなく 400 + WRONG_CURRENT_PASSWORD（トークンは残る）
    const wrongPassword = await owner.put('/api/auth/password', {
      data: { currentPassword: 'not-the-password', newPassword: 'new-password-9' },
    });
    expect(wrongPassword.status()).toBe(400);
    expect((await wrongPassword.json()).code).toBe('WRONG_CURRENT_PASSWORD');
    expect((await owner.get('/api/agent/v1/me', { headers: bearer(bothToken) })).status()).toBe(200);
    expect(
      (connection.prepare(
        'SELECT COUNT(*) AS c FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL',
      ).get(ownerRow.id) as { c: number }).c,
    ).toBeGreaterThanOrEqual(2);

    // レート制限: DB に既に上限を入れて実時間を待たない（guest e2e と同じ手法）
    connection.prepare(
      'INSERT INTO agent_rate_limits (bucket, count, resets_at) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET count = excluded.count, resets_at = excluded.resets_at',
    ).run(`agent:${bothId}:read`, 60, Date.now() + 60_000);
    const limited = await owner.get('/api/agent/v1/items', { headers: bearer(bothToken) });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()['retry-after'] || 0)).toBeGreaterThan(0);

    // パスワード変更で全トークン無効
    const password = await owner.put('/api/auth/password', {
      data: { currentPassword: ownerCreds.password, newPassword: 'new-password-9' },
    });
    expect(password.status()).toBe(200);
    expect((await owner.get('/api/agent/v1/me', { headers: bearer(bothToken) })).status()).toBe(401);
    expect((await owner.get('/api/agent/v1/me', { headers: bearer(writeToken) })).status()).toBe(401);
    const revokedCount = connection.prepare(
      'SELECT COUNT(*) AS c FROM agent_tokens WHERE user_id = ? AND revoked_at IS NOT NULL',
    ).get(ownerRow.id) as { c: number };
    expect(revokedCount.c).toBeGreaterThanOrEqual(2);
    connection.close();
  } finally {
    await owner.dispose();
    await stranger.dispose();
  }
});
