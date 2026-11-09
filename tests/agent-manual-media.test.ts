// #382: サーバー取得に失敗して空のままの価格・画像を、エージェント（MCP update_item / REST PATCH）が
// 一度だけ埋められる。取得済みの値は上書きしない。DB は一時ファイル、取得は fixture、DNS は固定。
import './regression-harness';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import { after, before, mock, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import {
  AMAZON_IMAGE,
  AMAZON_PRICE,
  AMAZON_PRODUCT_URL,
  PITAKA_URL,
  regressionLookup,
} from '../src/lib/product-regression-fixtures';
import type { AgentItemView } from '../src/lib/agent-items';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const itemsPath = '../src/app/api/agent/v1/items/route.ts';
const byUrlPath = '../src/app/api/agent/v1/items/by-url/route.ts';
const itemIdPath = '../src/app/api/agent/v1/items/[id]/route.ts';
const historyPath = '../src/app/api/agent/v1/items/[id]/price-history/route.ts';
const budgetPath = '../src/app/api/agent/v1/budget/route.ts';
const mcpPath = '../src/app/api/mcp/route.ts';

const sameOrigin = { origin: 'http://localhost' } as const;
const sameOriginUrl = 'http://localhost';

const PATAGONIA_URL = 'https://www.patagonia.jp/product/terravia-convertible-tote-bag-backpack-24-liters/48814.html';
const PATAGONIA_NAME = 'テラヴィア・トート・パック 24L';
const PATAGONIA_IMAGE = 'https://www.patagonia.jp/dw/image/v2/48814.jpg?sw=800';
const MANUAL_PRICE = 14850;
const BOT_MESSAGE = /待機ページ|ボット対策/;
const PRIVATE_IMAGE_HOST = 'private-cdn.example';

const waitingHtml = readFileSync(new URL('./fixtures/patagonia-waiting.html', import.meta.url), 'utf8');

// DNS は固定。private-cdn.example だけ私設アドレスへ解決し、どのホストを引いたかを記録する。
const resolvedHosts: string[] = [];
before(() => {
  mock.method(dns, 'lookup', async (host: string) => {
    resolvedHosts.push(host);
    if (host === PRIVATE_IMAGE_HOST) return [{ address: '10.0.0.1', family: 4 }];
    return [{ address: '8.8.8.8', family: 4 }];
  });
});
after(() => {
  mock.restoreAll();
  assert.ok(resolvedHosts.length > 0, 'image URL validation must use the DNS mock');
});

let exclusive: Promise<void> = Promise.resolve();
function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

async function withWaitingPageFixture<T>(run: () => Promise<T>): Promise<T> {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort({
    lookup: (candidate: URL) => candidate.hostname === 'www.patagonia.jp'
      ? { status: 200, body: Buffer.from(waitingHtml), contentType: 'text/html' }
      : regressionLookup(candidate),
    timeoutMs: 400,
  });
  try {
    return await run();
  } finally {
    installProductFetchPort(null);
  }
}

async function createToken(scopes: ('read' | 'write')[], name: string) {
  const created = await call(
    tokensPath,
    'POST',
    '/api/agent-tokens',
    { name, scopes, expiresInDays: 30 },
    undefined,
    sameOrigin,
    `${sameOriginUrl}/api/agent-tokens`,
  );
  assert.equal(created.status, 201, created.text);
  return created.json as { token: string; record: { id: number } };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type ErrorBody = { error: string; code: string };
type Wrapped<T> = { data: T; notice: { ja: string; en: string } };
type AddData = {
  item: AgentItemView;
  media_fetched: boolean;
  media_fetch_errors: { url: string; code: string; message: string }[];
};
type BudgetData = {
  months: Record<string, { total: number; item_count: number; item_ids: number[] }>;
  undated: { total: number; item_count: number; item_ids: number[] };
  grand_total: number;
};

async function restPatch(token: string, itemId: number, body: unknown) {
  return call(itemIdPath, 'PATCH', `/api/agent/v1/items/${itemId}`, body, { id: String(itemId) }, bearer(token));
}

async function restGet(token: string, itemId: number): Promise<AgentItemView> {
  const response = await call(itemIdPath, 'GET', `/api/agent/v1/items/${itemId}`, undefined, { id: String(itemId) }, bearer(token));
  assert.equal(response.status, 200, response.text);
  return (response.json as Wrapped<AgentItemView>).data;
}

async function restBudget(token: string, month: string): Promise<BudgetData> {
  const response = await call(budgetPath, 'GET', `/api/agent/v1/budget?month=${month}`, undefined, undefined, bearer(token));
  assert.equal(response.status, 200, response.text);
  return (response.json as Wrapped<BudgetData>).data;
}

type McpToolResult = {
  isError: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: { data: Record<string, unknown> };
  _meta?: { code?: string; httpStatus?: number };
};
type McpResponse = {
  result?: McpToolResult & { tools?: { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[] };
  error?: { code: number; message: string; data?: { httpStatus?: number; code?: string } };
};

let rpcId = 500;
async function mcp(token: string, method: string, params?: unknown) {
  const response = await call(mcpPath, 'POST', '/api/mcp', {
    jsonrpc: '2.0',
    id: ++rpcId,
    method,
    params,
  }, undefined, { ...bearer(token), Accept: 'application/json, text/event-stream' });
  return { status: response.status, text: response.text, body: response.json as McpResponse };
}

async function mcpTool(token: string, name: string, args: Record<string, unknown>) {
  return mcp(token, 'tools/call', { name, arguments: args });
}

function mcpData<T>(response: { text: string; body: McpResponse }): T {
  assert.ok(response.body.result, response.text);
  assert.equal(response.body.result.isError, false, response.text);
  assert.ok(response.body.result.structuredContent, response.text);
  return response.body.result.structuredContent.data as unknown as T;
}

function mcpError(response: { text: string; body: McpResponse }, code: string, httpStatus: number): string {
  assert.ok(response.body.result, response.text);
  assert.equal(response.body.result.isError, true, response.text);
  assert.equal(response.body.result._meta?.code, code, response.text);
  assert.equal(response.body.result._meta?.httpStatus, httpStatus, response.text);
  return response.body.result.content?.map((entry) => entry.text).join('\n') ?? '';
}

type ItemRow = {
  id: number;
  notes: string | null;
  current_price: number | null;
  image_url: string | null;
  original_price: number | null;
  deleted_at: string | null;
  scrape_status: string | null;
  scrape_error: string | null;
  quantity: number;
};

function itemRow(database: Awaited<ReturnType<typeof db>>, id: number): ItemRow {
  const row = database.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  assert.ok(row, `item ${id} must exist`);
  return row;
}

function priceHistory(database: Awaited<ReturnType<typeof db>>, itemId: number) {
  return database.prepare(
    'SELECT id, price FROM price_history WHERE item_id = ? ORDER BY id',
  ).all(itemId) as { id: number; price: number }[];
}

test('REST: a BOT_CHALLENGE item exposes scrape fields, takes price + image once via PATCH, and enters the budget', () => serial(async () => {
  await withWaitingPageFixture(async () => {
    await createMember('manual-media-rest');
    const token = await createToken(['read', 'write'], 'manual-media-rest');
    const database = await db();

    const added = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: PATAGONIA_URL,
      name: PATAGONIA_NAME,
      notes: '¥14,850 のはず',
      planned_purchase_date: '2026-11-12',
    }, undefined, bearer(token.token));
    assert.equal(added.status, 201, added.text);
    const addedData = (added.json as Wrapped<AddData>).data;
    assert.equal(addedData.media_fetched, false);
    assert.equal(addedData.media_fetch_errors[0]?.code, 'BOT_CHALLENGE');
    assert.equal(addedData.item.current_price, null);
    assert.equal(addedData.item.image_url, null);
    // 取得失敗が view から分かる（手動設定してよい条件をエージェントが判断できる）
    assert.equal(addedData.item.scrape_status, 'failed');
    assert.match(addedData.item.scrape_error ?? '', BOT_MESSAGE);
    assert.equal(addedData.item.stores[0]?.scrape_status, 'failed');
    assert.match(addedData.item.stores[0]?.scrape_error ?? '', BOT_MESSAGE);
    const itemId = addedData.item.id;

    const listed = await call(itemsPath, 'GET', '/api/agent/v1/items?q=48814', undefined, undefined, bearer(token.token));
    assert.equal(listed.status, 200, listed.text);
    const listedRow = (listed.json as Wrapped<{ items: AgentItemView[] }>).data.items.find((row) => row.id === itemId);
    assert.equal(listedRow?.scrape_status, 'failed');
    assert.match(listedRow?.scrape_error ?? '', BOT_MESSAGE);

    // 価格 null は 0 円扱いで月次合計に入らない
    const before = await restBudget(token.token, '2026-11');
    assert.equal(before.months['2026-11']?.total ?? 0, 0);
    assert.equal(priceHistory(database, itemId).length, 0);

    const filled = await restPatch(token.token, itemId, { current_price: MANUAL_PRICE, image_url: PATAGONIA_IMAGE });
    assert.equal(filled.status, 200, filled.text);
    const filledItem = (filled.json as Wrapped<AgentItemView>).data;
    assert.equal(filledItem.id, itemId);
    assert.equal(filledItem.current_price, MANUAL_PRICE);
    assert.equal(filledItem.image_url, PATAGONIA_IMAGE);
    assert.equal(filledItem.notes, '¥14,850 のはず');
    assert.equal(filledItem.stores[0]?.current_price, MANUAL_PRICE);
    assert.equal(filledItem.stores[0]?.image_url, PATAGONIA_IMAGE);
    assert.ok(resolvedHosts.includes('www.patagonia.jp'), 'the image host is checked against public DNS');

    const row = itemRow(database, itemId);
    assert.equal(row.current_price, MANUAL_PRICE);
    assert.equal(row.image_url, PATAGONIA_IMAGE);
    assert.equal(row.original_price, null, 'only current_price is written');
    assert.deepEqual(priceHistory(database, itemId).map((entry) => entry.price), [MANUAL_PRICE]);

    const history = await call(historyPath, 'GET', `/api/agent/v1/items/${itemId}/price-history`, undefined, { id: String(itemId) }, bearer(token.token));
    assert.equal(history.status, 200, history.text);
    assert.equal((history.json as Wrapped<{ history: { price: number }[] }>).data.history.length, 1);

    const after = await restBudget(token.token, '2026-11');
    assert.equal(after.months['2026-11'].total, MANUAL_PRICE);
    assert.ok(after.months['2026-11'].item_ids.includes(itemId));
    assert.equal(after.grand_total, MANUAL_PRICE);

    // 二度目は拒否。null や空文字で消すこともできない。
    const again = await restPatch(token.token, itemId, { current_price: 1 });
    assert.equal(again.status, 409, again.text);
    assert.equal((again.json as ErrorBody).code, 'MEDIA_ALREADY_SET');
    const imageAgain = await restPatch(token.token, itemId, { image_url: 'https://cdn.example/other.png' });
    assert.equal(imageAgain.status, 409, imageAgain.text);
    assert.equal((imageAgain.json as ErrorBody).code, 'MEDIA_ALREADY_SET');
    for (const body of [{ current_price: null }, { image_url: null }, { image_url: '' }]) {
      const cleared = await restPatch(token.token, itemId, body);
      assert.equal(cleared.status, 400, cleared.text);
      assert.equal((cleared.json as ErrorBody).code, 'INVALID_INPUT');
    }
    const kept = itemRow(database, itemId);
    assert.equal(kept.current_price, MANUAL_PRICE);
    assert.equal(kept.image_url, PATAGONIA_IMAGE);
    assert.equal(priceHistory(database, itemId).length, 1);
    const keptView = await restGet(token.token, itemId);
    assert.equal(keptView.current_price, MANUAL_PRICE);
    assert.equal(keptView.image_url, PATAGONIA_IMAGE);
    // 取得が失敗した事実は残す（手動設定では scrape_status を書き換えない）
    assert.equal(keptView.scrape_status, 'failed');
  });
}));

test('MCP: update_item fills price and image field by field, quantity multiplies into the budget, and tools/list says so', () => serial(async () => {
  await withWaitingPageFixture(async () => {
    await createMember('manual-media-mcp');
    const token = await createToken(['read', 'write'], 'manual-media-mcp');
    const database = await db();

    const added = mcpData<AddData>(await mcpTool(token.token, 'add_item', {
      name: '黒',
      url: `${PATAGONIA_URL}?color=black`,
      quantity: 2,
      planned_purchase_date: '2026-11-20',
    }));
    assert.equal(added.media_fetched, false);
    assert.equal(added.media_fetch_errors[0]?.code, 'BOT_CHALLENGE');
    assert.equal(added.item.current_price, null);
    assert.equal(added.item.image_url, null);
    const itemId = added.item.id;

    const fetched = mcpData<AgentItemView>(await mcpTool(token.token, 'get_item', { item_id: itemId }));
    assert.equal(fetched.scrape_status, 'failed');
    assert.match(fetched.scrape_error ?? '', BOT_MESSAGE);

    // 価格だけ埋める（画像は空のまま）
    const priced = mcpData<AgentItemView>(await mcpTool(token.token, 'update_item', { item_id: itemId, current_price: MANUAL_PRICE }));
    assert.equal(priced.current_price, MANUAL_PRICE);
    assert.equal(priced.image_url, null);
    assert.deepEqual(priceHistory(database, itemId).map((entry) => entry.price), [MANUAL_PRICE]);

    const budget = mcpData<BudgetData>(await mcpTool(token.token, 'get_budget_summary', { month: '2026-11' }));
    assert.equal(budget.months['2026-11'].total, MANUAL_PRICE * 2);
    assert.ok(budget.months['2026-11'].item_ids.includes(itemId));

    // 価格が埋まっていても、画像が空なら画像は別に埋められる
    const imaged = mcpData<AgentItemView>(await mcpTool(token.token, 'update_item', { item_id: itemId, image_url: PATAGONIA_IMAGE }));
    assert.equal(imaged.current_price, MANUAL_PRICE);
    assert.equal(imaged.image_url, PATAGONIA_IMAGE);
    assert.equal(priceHistory(database, itemId).length, 1);

    const text = mcpError(await mcpTool(token.token, 'update_item', { item_id: itemId, current_price: 2 }), 'MEDIA_ALREADY_SET', 409);
    assert.match(text, /価格/);
    assert.equal(itemRow(database, itemId).current_price, MANUAL_PRICE);

    const listed = await mcp(token.token, 'tools/list');
    assert.equal(listed.status, 200, listed.text);
    const updateTool = listed.body.result?.tools?.find((tool) => tool.name === 'update_item');
    assert.ok(updateTool, listed.text);
    assert.ok('current_price' in updateTool.inputSchema.properties);
    assert.ok('image_url' in updateTool.inputSchema.properties);
    // 「価格と画像は変更不可」という一律の説明ではなく、空のときだけ埋められる条件付きの説明になっている
    assert.equal(updateTool.description.includes('価格と画像は変更不可'), false, updateTool.description);
    assert.match(updateTool.description, /current_price/);
    assert.match(updateTool.description, /image_url/);
    assert.match(updateTool.description, /MEDIA_ALREADY_SET/);
  });
}));

test('a manual item (no URL) can be priced by the agent and the price counts in the budget', () => serial(async () => {
  await createMember('manual-media-manual');
  const token = await createToken(['read', 'write'], 'manual-media-manual');
  const database = await db();

  const added = mcpData<AddData>(await mcpTool(token.token, 'add_item', { name: 'URL なし', planned_purchase_date: '2026-12-01' }));
  assert.ok(added.item.url.startsWith('manual://'));
  assert.equal(added.item.current_price, null);
  assert.deepEqual(added.media_fetch_errors, []);

  const priced = mcpData<AgentItemView>(await mcpTool(token.token, 'update_item', { item_id: added.item.id, current_price: 500 }));
  assert.equal(priced.current_price, 500);
  assert.deepEqual(priceHistory(database, added.item.id).map((entry) => entry.price), [500]);

  const budget = await restBudget(token.token, '2026-12');
  assert.equal(budget.months['2026-12'].total, 500);
}));

test('fetched price and image are never overwritten, add paths still reject client media, and aliases stay closed', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort({ lookup: regressionLookup, timeoutMs: 400 });
  try {
    const owner = await createMember('manual-media-fetched');
    const token = await createToken(['read', 'write'], 'manual-media-fetched');
    const database = await db();

    const rejectedAdd = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: AMAZON_PRODUCT_URL,
      current_price: 1,
      image_url: 'https://evil.example/x.png',
    }, undefined, bearer(token.token));
    assert.equal(rejectedAdd.status, 400, rejectedAdd.text);
    assert.equal((rejectedAdd.json as ErrorBody).code, 'INVALID_INPUT');
    assert.match((rejectedAdd.json as ErrorBody).error, /価格と画像はサーバー取得のみ/);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(owner.id) as { n: number }).n,
      0,
      'a rejected add saves nothing',
    );

    const mcpRejected = await mcpTool(token.token, 'add_item', { name: 'MCP', url: PITAKA_URL, current_price: 1 });
    assert.match(mcpError(mcpRejected, 'INVALID_INPUT', 400), /価格と画像はサーバー取得のみ/);

    const added = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', { url: AMAZON_PRODUCT_URL, notes: 'fetched' }, undefined, bearer(token.token));
    assert.equal(added.status, 201, added.text);
    const item = (added.json as Wrapped<AddData>).data.item;
    assert.equal(item.current_price, AMAZON_PRICE);
    assert.equal(item.image_url, AMAZON_IMAGE);
    assert.equal(item.scrape_status, null);
    const historyBefore = priceHistory(database, item.id);
    assert.equal(historyBefore.length, 1);

    // 混在ボディは丸ごと拒否（メモも変わらない）
    const mixed = await restPatch(token.token, item.id, { notes: 'should-not-apply', current_price: 1 });
    assert.equal(mixed.status, 409, mixed.text);
    assert.equal((mixed.json as ErrorBody).code, 'MEDIA_ALREADY_SET');
    const image = await restPatch(token.token, item.id, { image_url: 'https://evil.example/x.png' });
    assert.equal(image.status, 409, image.text);
    const mcpImage = await mcpTool(token.token, 'update_item', { item_id: item.id, image_url: 'https://evil.example/x.png' });
    mcpError(mcpImage, 'MEDIA_ALREADY_SET', 409);

    // 別名では、空の品目でも開かない
    const emptyId = Number(database.prepare(
      "INSERT INTO items (user_id, name, url, source) VALUES (?, '空', 'manual://alias-test', 'other')",
    ).run(owner.id).lastInsertRowid);
    for (const body of [
      { price: 100 },
      { original_price: 100 },
      { target_price: 100 },
      { imageUrl: 'https://cdn.example/a.png' },
      { notes: 'x', price: 100 },
    ]) {
      const alias = await restPatch(token.token, emptyId, body);
      assert.equal(alias.status, 400, `${JSON.stringify(body)}: ${alias.text}`);
      assert.equal((alias.json as ErrorBody).code, 'INVALID_INPUT');
    }
    const aliasRow = itemRow(database, emptyId);
    assert.equal(aliasRow.current_price, null);
    assert.equal(aliasRow.image_url, null);
    assert.equal(aliasRow.notes, null);

    const row = itemRow(database, item.id);
    assert.equal(row.current_price, AMAZON_PRICE);
    assert.equal(row.image_url, AMAZON_IMAGE);
    assert.equal(row.notes, 'fetched');
    assert.deepEqual(priceHistory(database, item.id), historyBefore);
  } finally {
    installProductFetchPort(null);
  }
}));

test('invalid prices and unsafe image URLs are rejected without touching other fields', () => serial(async () => {
  const owner = await createMember('manual-media-invalid');
  const token = await createToken(['read', 'write'], 'manual-media-invalid');
  const database = await db();
  const itemId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source, notes) VALUES (?, '空', 'manual://invalid-test', 'other', 'keep')",
  ).run(owner.id).lastInsertRowid);

  for (const price of [-1, 0, -14850, '14850', true, [14850], { yen: 14850 }]) {
    const response = await restPatch(token.token, itemId, { notes: 'changed', current_price: price });
    assert.equal(response.status, 400, `${JSON.stringify(price)}: ${response.text}`);
    assert.equal((response.json as ErrorBody).code, 'INVALID_INPUT');
    assert.match((response.json as ErrorBody).error, /価格|current_price/);
  }
  // JSON では送れない値も lib では拒否する
  const { updateAgentItem } = await import('../src/lib/agent-items');
  const { findAgentTokenByPlaintext } = await import('../src/lib/agent-token');
  const auth = findAgentTokenByPlaintext(token.token, database);
  assert.ok(auth);
  for (const price of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    await assert.rejects(
      () => updateAgentItem(auth, itemId, { current_price: price }, database),
      (error: unknown) => error instanceof Error && (error as { status?: number }).status === 400,
      String(price),
    );
  }

  const unsafeImages: unknown[] = [
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'http://cdn.example/a.png',
    'https://user:pw@cdn.example/a.png',
    'https://cdn.example:8443/a.png',
    'https://localhost/a.png',
    'https://cdn.local/a.png',
    'https://cdn.internal/a.png',
    'https://10.0.0.1/a.png',
    'https://[::1]/a.png',
    '//cdn.example/a.png',
    'ftp://cdn.example/a.png',
    'https://cdn.example/a\\b.png',
    'not a url',
    42,
    ['https://cdn.example/a.png'],
  ];
  const lookupsBefore = resolvedHosts.length;
  for (const imageUrl of unsafeImages) {
    const response = await restPatch(token.token, itemId, { notes: 'changed', image_url: imageUrl });
    assert.equal(response.status, 400, `${JSON.stringify(imageUrl)}: ${response.text}`);
    assert.equal((response.json as ErrorBody).code, 'INVALID_INPUT');
    assert.match((response.json as ErrorBody).error, /画像|image_url/);
  }
  assert.equal(resolvedHosts.length, lookupsBefore, 'syntactically unsafe image URLs are rejected before any DNS lookup');

  // 公開ホストに見えても私設アドレスへ解決する画像ホストは拒否
  const privateHost = await restPatch(token.token, itemId, { notes: 'changed', image_url: `https://${PRIVATE_IMAGE_HOST}/a.png` });
  assert.equal(privateHost.status, 400, privateHost.text);
  assert.equal((privateHost.json as ErrorBody).code, 'URL_BLOCKED');
  assert.ok(resolvedHosts.includes(PRIVATE_IMAGE_HOST));

  const row = itemRow(database, itemId);
  assert.equal(row.notes, 'keep');
  assert.equal(row.current_price, null);
  assert.equal(row.image_url, null);
  assert.equal(priceHistory(database, itemId).length, 0);
}));

test('network validation of the image host happens only after authentication and scope checks', () => serial(async () => {
  const owner = await createMember('manual-media-auth');
  const readOnly = await createToken(['read'], 'manual-media-read');
  const database = await db();
  const itemId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source) VALUES (?, '空', 'manual://auth-test', 'other')",
  ).run(owner.id).lastInsertRowid);
  const host = 'auth-check-cdn.example';
  const body = { current_price: MANUAL_PRICE, image_url: `https://${host}/a.png` };

  const anonymous = await call(itemIdPath, 'PATCH', `/api/agent/v1/items/${itemId}`, body, { id: String(itemId) });
  assert.equal(anonymous.status, 401, anonymous.text);

  const denied = await restPatch(readOnly.token, itemId, body);
  assert.equal(denied.status, 403, denied.text);

  const mcpDenied = await mcpTool(readOnly.token, 'update_item', { item_id: itemId, ...body });
  assert.equal(mcpDenied.status, 200, mcpDenied.text);
  assert.equal(mcpDenied.body.error?.data?.code, 'AGENT_SCOPE_DENIED', mcpDenied.text);

  assert.equal(resolvedHosts.includes(host), false, 'no DNS lookup before auth and scope pass');
  const row = itemRow(database, itemId);
  assert.equal(row.current_price, null);
  assert.equal(row.image_url, null);
}));

test('state is re-checked inside the write transaction: a trash or a concurrent writer between validation and update rejects the whole body', () => serial(async () => {
  const owner = await createMember('manual-media-race');
  const token = await createToken(['read', 'write'], 'manual-media-race');
  const database = await db();
  const { updateAgentItem } = await import('../src/lib/agent-items');
  const { findAgentTokenByPlaintext } = await import('../src/lib/agent-token');
  const auth = findAgentTokenByPlaintext(token.token, database);
  assert.ok(auth);
  const itemId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source, notes) VALUES (?, '競合', 'manual://race-test', 'other', 'before')",
  ).run(owner.id).lastInsertRowid);
  const body = { notes: 'after', current_price: MANUAL_PRICE, image_url: 'https://cdn.example/race.png' };
  const publicAddress = [{ address: '8.8.8.8', family: 4 }];
  const guestError = (status: number, code: string) => (error: unknown) =>
    error instanceof Error
    && (error as { status?: number }).status === status
    && (error as { code?: string }).code === code;

  // 画像ホストの名前解決（検証と書き込みの間）に、品目がゴミ箱へ入る
  await assert.rejects(
    () => updateAgentItem(auth, itemId, body, database, {
      deps: {
        resolve: async () => {
          database.prepare("UPDATE items SET deleted_at = datetime('now') WHERE id = ?").run(itemId);
          return publicAddress;
        },
      },
    }),
    guestError(409, 'ITEM_TRASHED'),
  );
  let row = itemRow(database, itemId);
  assert.ok(row.deleted_at);
  assert.equal(row.notes, 'before');
  assert.equal(row.current_price, null);
  assert.equal(row.image_url, null);
  assert.equal(priceHistory(database, itemId).length, 0);

  // 復元後、今度は別の書き手（定期の価格チェックなど）が同じ窓で価格を入れる
  database.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run(itemId);
  await assert.rejects(
    () => updateAgentItem(auth, itemId, body, database, {
      deps: {
        resolve: async () => {
          database.prepare('UPDATE items SET current_price = 9999 WHERE id = ?').run(itemId);
          return publicAddress;
        },
      },
    }),
    guestError(409, 'MEDIA_ALREADY_SET'),
  );
  row = itemRow(database, itemId);
  assert.equal(row.current_price, 9999, 'the other writer\'s price stays');
  assert.equal(row.image_url, null, 'the image half of the body is not applied either');
  assert.equal(row.notes, 'before');
  assert.equal(priceHistory(database, itemId).length, 0, 'no manual history row for a rejected update');

  // 画像だけなら、価格が埋まっていても入る。ここは競合なし。
  const imaged = await updateAgentItem(auth, itemId, { notes: 'after', image_url: body.image_url }, database, {
    deps: { resolve: async () => publicAddress },
  });
  assert.equal(imaged.image_url, body.image_url);
  assert.equal(imaged.current_price, 9999);
  assert.equal(imaged.notes, 'after');
  assert.equal(priceHistory(database, itemId).length, 0);

  // 別の書き手が画像だけ入れた窓でも、価格側は書かれない
  const otherId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source) VALUES (?, '競合2', 'manual://race-test-2', 'other')",
  ).run(owner.id).lastInsertRowid);
  await assert.rejects(
    () => updateAgentItem(auth, otherId, body, database, {
      deps: {
        resolve: async () => {
          database.prepare("UPDATE items SET image_url = 'https://cdn.example/other.png' WHERE id = ?").run(otherId);
          return publicAddress;
        },
      },
    }),
    guestError(409, 'MEDIA_ALREADY_SET'),
  );
  const other = itemRow(database, otherId);
  assert.equal(other.current_price, null);
  assert.equal(other.image_url, 'https://cdn.example/other.png');
  assert.equal(priceHistory(database, otherId).length, 0);
}));
