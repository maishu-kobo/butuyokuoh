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
import { AGENT_MANUAL_PRICE_MAX } from '../src/lib/agent-items';
import { PRODUCT_WAITING_HELP } from '../src/lib/product-html';
import { PRODUCT_FETCH_BLOCKED_HELP, PRODUCT_FETCH_HELP } from '../src/lib/public-page';
import { AMAZON_BOT_NOTE } from '../src/lib/scraper';

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
const UNRESOLVABLE_IMAGE_HOST = 'unresolvable.example';
/** ボット対策ページ（Cloudflare 風）を返す店。product-html は PRODUCT_FETCH_BLOCKED_HELP + BOT_CHALLENGE にする。 */
const BLOCKED_SHOP_URL = 'https://blocked.example.com/products/challenge';

const waitingHtml = readFileSync(new URL('./fixtures/patagonia-waiting.html', import.meta.url), 'utf8');
const challengeHtml = '<html><head><title>Attention Required! | Cloudflare</title></head><body>Checking your browser</body></html>';

// DNS は固定。private-cdn.example だけ私設アドレスへ解決し、unresolvable.example は解決に失敗する。
// どのホストを引いたかを記録する。
const resolvedHosts: string[] = [];
before(() => {
  mock.method(dns, 'lookup', async (host: string) => {
    resolvedHosts.push(host);
    if (host === PRIVATE_IMAGE_HOST) return [{ address: '10.0.0.1', family: 4 }];
    if (host === UNRESOLVABLE_IMAGE_HOST) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    }
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
      : candidate.hostname === 'blocked.example.com'
        ? { status: 200, body: Buffer.from(challengeHtml), contentType: 'text/html' }
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
type McpToolDescriptor = {
  name: string;
  description: string;
  annotations: Record<string, boolean>;
  inputSchema: { additionalProperties?: boolean; required?: string[]; properties: Record<string, unknown> };
};
type McpResponse = {
  result?: McpToolResult & { tools?: McpToolDescriptor[] };
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
    // 取得失敗が view から分かる（参考情報。埋められるかは各フィールドが null かどうかだけで決まる）
    assert.equal(addedData.item.scrape_status, 'failed');
    assert.equal(addedData.item.scrape_error_code, 'BOT_CHALLENGE');
    assert.equal(addedData.item.scrape_error, PRODUCT_WAITING_HELP, 'the known waiting-page message is shown as is');
    assert.equal(addedData.item.stores[0]?.scrape_status, 'failed');
    assert.equal(addedData.item.stores[0]?.scrape_error_code, 'BOT_CHALLENGE');
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
    assert.equal(
      (updateTool.inputSchema.properties.current_price as { maximum?: number }).maximum,
      AGENT_MANUAL_PRICE_MAX,
      'the schema advertises the documented price ceiling',
    );
    // image_url の名前解決で外部 DNS に触れるので openWorldHint は true。入力の形は変えない。
    assert.deepEqual(updateTool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.equal(updateTool.inputSchema.additionalProperties, false);
    assert.deepEqual(updateTool.inputSchema.required, ['item_id']);
    // スキームの大文字小文字を問わない実装と同じ pattern を、MCP スキーマと OpenAPI の両方に書く
    const imagePattern = (updateTool.inputSchema.properties.image_url as { pattern?: string }).pattern;
    assert.equal(imagePattern, '^[Hh][Tt][Tt][Pp][Ss]://');
    assert.ok(new RegExp(imagePattern as string).test('HTTPS://cdn.example/a.png'));
    assert.equal(new RegExp(imagePattern as string).test('https:cdn.example/a.png'), false);
    const openapi = readFileSync(new URL('../public/openapi/agent-v1.yaml', import.meta.url), 'utf8');
    assert.ok(openapi.includes(`pattern: '${imagePattern}'`), 'OpenAPI uses the same image_url pattern');
    // 「価格と画像は変更不可」という一律の説明ではなく、空のときだけ埋められる条件付きの説明になっている
    assert.equal(updateTool.description.includes('価格と画像は変更不可'), false, updateTool.description);
    assert.match(updateTool.description, /current_price/);
    assert.match(updateTool.description, /image_url/);
    assert.match(updateTool.description, /MEDIA_ALREADY_SET/);
  });
}));

test('a manual item (no URL, scrape_status null) can be priced by the agent; fractional yen and canonical image URLs are stored as such', () => serial(async () => {
  await createMember('manual-media-manual');
  const token = await createToken(['read', 'write'], 'manual-media-manual');
  const database = await db();

  const added = mcpData<AddData>(await mcpTool(token.token, 'add_item', { name: 'URL なし', planned_purchase_date: '2026-12-01', quantity: 2 }));
  assert.ok(added.item.url.startsWith('manual://'));
  assert.equal(added.item.current_price, null);
  // 手動品目は取得そのものが無い。許可判定は scrape_status ではなく各フィールドが null かどうかだけ。
  assert.equal(added.item.scrape_status, null);
  assert.deepEqual(added.media_fetch_errors, []);

  const priced = mcpData<AgentItemView>(await mcpTool(token.token, 'update_item', { item_id: added.item.id, current_price: 1234.5 }));
  assert.equal(priced.current_price, 1234.5, 'positive fractional yen are accepted as given');
  assert.deepEqual(priceHistory(database, added.item.id).map((entry) => entry.price), [1234.5]);

  const budget = await restBudget(token.token, '2026-12');
  assert.equal(budget.months['2026-12'].total, 2469);

  // 画像は「https://」で始まる絶対 URL だけ受け付け（スキームの大文字小文字は問わない）、
  // 保存するのは正規形（スキーム・ホスト小文字、フラグメント無し）。
  const imaged = mcpData<AgentItemView>(await mcpTool(token.token, 'update_item', {
    item_id: added.item.id,
    image_url: 'HTTPS://CDN.Example/Path/Photo.png?x=1#frag',
  }));
  assert.equal(imaged.image_url, 'https://cdn.example/Path/Photo.png?x=1');
  assert.equal(itemRow(database, added.item.id).image_url, 'https://cdn.example/Path/Photo.png?x=1');
}));

test('the price ceiling is explicit: the maximum is accepted and stays finite at the largest quantity, one more is 400', () => serial(async () => {
  const owner = await createMember('manual-media-ceiling');
  const token = await createToken(['read', 'write'], 'manual-media-ceiling');
  const database = await db();
  const insert = database.prepare(
    "INSERT INTO items (user_id, name, url, source, quantity, planned_purchase_date) VALUES (?, ?, ?, 'other', 999, '2027-01-15')",
  );
  const maxId = Number(insert.run(owner.id, '上限', 'manual://ceiling-max').lastInsertRowid);
  const overId = Number(insert.run(owner.id, '超過', 'manual://ceiling-over').lastInsertRowid);

  const accepted = await restPatch(token.token, maxId, { current_price: AGENT_MANUAL_PRICE_MAX });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal((accepted.json as Wrapped<AgentItemView>).data.current_price, AGENT_MANUAL_PRICE_MAX);

  for (const price of [AGENT_MANUAL_PRICE_MAX + 1, 1e308, Number.MAX_VALUE]) {
    const rejected = await restPatch(token.token, overId, { current_price: price });
    assert.equal(rejected.status, 400, `${price}: ${rejected.text}`);
    assert.equal((rejected.json as ErrorBody).code, 'INVALID_INPUT');
  }
  assert.equal(itemRow(database, overId).current_price, null);
  assert.equal(priceHistory(database, overId).length, 0);

  const budget = await restBudget(token.token, '2027-01');
  assert.equal(budget.months['2027-01'].total, AGENT_MANUAL_PRICE_MAX * 999);
  assert.ok(Number.isSafeInteger(budget.months['2027-01'].total), 'ceiling × max quantity stays an exact integer');
  assert.ok(JSON.stringify(budget).includes(String(AGENT_MANUAL_PRICE_MAX * 999)), 'the JSON total is a number, not null');

  // 公開の OpenAPI も同じ上限を書く
  const openapi = readFileSync(new URL('../public/openapi/agent-v1.yaml', import.meta.url), 'utf8');
  assert.ok(openapi.includes(`maximum: ${AGENT_MANUAL_PRICE_MAX}`), 'OpenAPI documents the same ceiling');
}));

test('scrape_error in item and store views is a fixed user-facing message with a code, never a raw exception string', () => serial(async () => {
  const owner = await createMember('manual-media-scrape-error');
  const token = await createToken(['read', 'write'], 'manual-media-scrape-error');
  const database = await db();
  const rawInternal = 'HTTP error 502: https://internal.example/path ECONNRESET 10.0.0.5';
  const rawBot = 'Amazonのボット対策により価格を取得できませんでした（内部: 10.0.0.5）';
  const insert = database.prepare(
    "INSERT INTO items (user_id, name, url, source, scrape_status, scrape_error) VALUES (?, ?, ?, 'other', ?, ?)",
  );
  const internalId = Number(insert.run(owner.id, '内部エラー', 'manual://scrape-internal', 'failed', rawInternal).lastInsertRowid);
  const botId = Number(insert.run(owner.id, 'ボット', 'manual://scrape-bot', 'failed', rawBot).lastInsertRowid);
  const waitingId = Number(insert.run(owner.id, '待機ページ', 'manual://scrape-waiting', 'failed', PRODUCT_WAITING_HELP).lastInsertRowid);
  const blockedId = Number(insert.run(owner.id, 'ボット対策', 'manual://scrape-blocked', 'failed', PRODUCT_FETCH_BLOCKED_HELP).lastInsertRowid);
  const amazonBotId = Number(insert.run(owner.id, 'Amazon ボット', 'manual://scrape-amazon-bot', 'failed', AMAZON_BOT_NOTE).lastInsertRowid);
  const genericId = Number(insert.run(owner.id, '一般失敗', 'manual://scrape-generic', 'failed', PRODUCT_FETCH_HELP).lastInsertRowid);
  const staleId = Number(insert.run(owner.id, '成功後', 'manual://scrape-stale', 'success', rawInternal).lastInsertRowid);
  const nullId = Number(insert.run(owner.id, '未取得', 'manual://scrape-null', null, null).lastInsertRowid);
  const oddId = Number(insert.run(owner.id, '未知の状態', 'manual://scrape-odd', 'retrying', rawInternal).lastInsertRowid);

  const views = new Map<number, AgentItemView>();
  for (const id of [internalId, botId, waitingId, blockedId, amazonBotId, genericId, staleId, nullId, oddId]) {
    views.set(id, await restGet(token.token, id));
  }

  // 定型文は、それを出す側が付けている実際の種別のまま（product-html / scraper の failureCode と一致）
  const blocked = views.get(blockedId)!;
  assert.equal(blocked.scrape_error_code, 'BOT_CHALLENGE', 'PRODUCT_FETCH_BLOCKED_HELP is emitted with BOT_CHALLENGE');
  assert.equal(blocked.scrape_error, PRODUCT_FETCH_BLOCKED_HELP);
  assert.equal(blocked.stores[0].scrape_error_code, 'BOT_CHALLENGE');
  const amazonBot = views.get(amazonBotId)!;
  assert.equal(amazonBot.scrape_error_code, 'BOT_CHALLENGE');
  assert.equal(amazonBot.scrape_error, AMAZON_BOT_NOTE);
  const generic = views.get(genericId)!;
  assert.equal(generic.scrape_error_code, 'FETCH_FAILED');
  assert.equal(generic.scrape_error, PRODUCT_FETCH_HELP);
  // OpenAPI の enum に無い状態値は出さない
  const odd = views.get(oddId)!;
  assert.equal(odd.scrape_status, null);
  assert.equal(odd.scrape_error, null);
  assert.equal(odd.scrape_error_code, null);
  const internal = views.get(internalId)!;
  assert.equal(internal.scrape_status, 'failed');
  assert.equal(internal.scrape_error_code, 'FETCH_FAILED');
  assert.ok(internal.scrape_error && internal.scrape_error.length > 0);
  for (const fragment of ['ECONNRESET', '10.0.0.5', 'internal.example', 'HTTP error']) {
    assert.equal(internal.scrape_error.includes(fragment), false, fragment);
    assert.equal(internal.stores[0].scrape_error?.includes(fragment), false, `store: ${fragment}`);
  }
  assert.equal(internal.stores[0].scrape_error_code, 'FETCH_FAILED');

  const bot = views.get(botId)!;
  assert.equal(bot.scrape_error_code, 'BOT_CHALLENGE');
  assert.equal(bot.scrape_error, PRODUCT_FETCH_BLOCKED_HELP, 'a bot-like raw string maps to the fixed blocked message');
  assert.equal(bot.stores[0].scrape_error, PRODUCT_FETCH_BLOCKED_HELP);

  const waiting = views.get(waitingId)!;
  assert.equal(waiting.scrape_error_code, 'BOT_CHALLENGE');
  assert.equal(waiting.scrape_error, PRODUCT_WAITING_HELP, 'a known fixed message is kept as is');

  const stale = views.get(staleId)!;
  assert.equal(stale.scrape_status, 'success');
  assert.equal(stale.scrape_error, null, 'a successful fetch exposes no error even if the column still holds text');
  assert.equal(stale.scrape_error_code, null);

  const never = views.get(nullId)!;
  assert.equal(never.scrape_status, null);
  assert.equal(never.scrape_error, null);
  assert.equal(never.scrape_error_code, null);

  // list_items（MCP）も同じ整形
  const listed = mcpData<{ items: AgentItemView[] }>(await mcpTool(token.token, 'list_items', { q: 'scrape-internal' }));
  const listedInternal = listed.items.find((item) => item.id === internalId);
  assert.ok(listedInternal);
  assert.equal(listedInternal.scrape_error_code, 'FETCH_FAILED');
  assert.equal(listedInternal.scrape_error?.includes('ECONNRESET'), false);
  assert.equal(JSON.stringify(listed).includes('10.0.0.5'), false, 'no raw detail leaks anywhere in the list payload');

  // 写真グループの店行も同じ整形で、失敗した店だけが失敗を出す
  const groupId = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name, priority, origin) VALUES (?, '店比較', 3, 'photo')",
  ).run(owner.id).lastInsertRowid);
  database.prepare("UPDATE items SET comparison_group_id = ?, sort_order = 0 WHERE id = ?").run(groupId, internalId);
  database.prepare(
    "INSERT INTO items (user_id, name, url, source, comparison_group_id, sort_order, current_price, scrape_status) VALUES (?, '内部エラー', 'https://shop.example/ok', 'other', ?, 1, 980, 'success')",
  ).run(owner.id, groupId);
  const grouped = await restGet(token.token, internalId);
  assert.equal(grouped.stores.length, 2);
  assert.equal(grouped.stores[0].scrape_error_code, 'FETCH_FAILED');
  assert.equal(grouped.stores[0].scrape_error?.includes('ECONNRESET'), false);
  assert.equal(grouped.stores[1].scrape_error, null);
  assert.equal(grouped.stores[1].scrape_error_code, null);

  // 公開 OpenAPI 3.1: 新しい null 許容プロパティは nullable ではなく型の和（null を含む）で書き、種別は enum で縛る
  const openapi = readFileSync(new URL('../public/openapi/agent-v1.yaml', import.meta.url), 'utf8');
  const lines = openapi.split('\n');
  const blocksOf = (property: string) => lines
    .map((line, index) => (line.trim() === `${property}:` ? index : -1))
    .filter((index) => index >= 0)
    .map((index) => lines.slice(index + 1, index + 5).join('\n'));
  for (const property of ['scrape_status', 'scrape_error_code', 'scrape_error']) {
    const blocks = blocksOf(property);
    assert.equal(blocks.length, 2, `${property} is documented on AgentStore and AgentItem`);
    for (const block of blocks) {
      assert.ok(block.includes("type: [string, 'null']"), `${property}: ${block}`);
      assert.equal(block.includes('nullable'), false, `${property} must not use OpenAPI 3.0 nullable`);
    }
  }
  for (const block of blocksOf('scrape_error_code')) {
    assert.ok(block.includes('enum: [BOT_CHALLENGE, FETCH_FAILED, null]'), block);
  }
  for (const block of blocksOf('scrape_status')) {
    assert.ok(block.includes('enum: [success, failed, null]'), block);
  }
}));

test('a bot-protection page keeps BOT_CHALLENGE with PRODUCT_FETCH_BLOCKED_HELP across add, get_item and list_items', () => serial(async () => {
  await withWaitingPageFixture(async () => {
    await createMember('manual-media-blocked');
    const token = await createToken(['read', 'write'], 'manual-media-blocked');

    const added = mcpData<AddData>(await mcpTool(token.token, 'add_item', { name: 'ボット対策の店', url: BLOCKED_SHOP_URL }));
    assert.equal(added.media_fetched, false);
    assert.deepEqual(added.media_fetch_errors, [{ url: BLOCKED_SHOP_URL, code: 'BOT_CHALLENGE', message: PRODUCT_FETCH_BLOCKED_HELP }]);
    assert.equal(added.item.scrape_status, 'failed');
    assert.equal(added.item.scrape_error_code, 'BOT_CHALLENGE');
    assert.equal(added.item.scrape_error, PRODUCT_FETCH_BLOCKED_HELP);

    const fetched = mcpData<AgentItemView>(await mcpTool(token.token, 'get_item', { item_id: added.item.id }));
    assert.equal(fetched.scrape_error_code, 'BOT_CHALLENGE');
    assert.equal(fetched.scrape_error, PRODUCT_FETCH_BLOCKED_HELP);
    assert.equal(fetched.stores[0].scrape_error_code, 'BOT_CHALLENGE');
    assert.equal(fetched.stores[0].scrape_error, PRODUCT_FETCH_BLOCKED_HELP);

    const listed = mcpData<{ items: AgentItemView[] }>(await mcpTool(token.token, 'list_items', { q: 'blocked.example.com' }));
    const row = listed.items.find((item) => item.id === added.item.id);
    assert.ok(row);
    assert.equal(row.scrape_error_code, 'BOT_CHALLENGE');
    assert.equal(row.scrape_error, PRODUCT_FETCH_BLOCKED_HELP);
  });
}));

test('trashed items and already-set fields answer 409 before any DNS lookup, even for a host that does not resolve', () => serial(async () => {
  const owner = await createMember('manual-media-precedence');
  const token = await createToken(['read', 'write'], 'manual-media-precedence');
  const database = await db();
  const populatedId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source, current_price, notes) VALUES (?, '価格あり', 'https://shop.example.com/populated', 'other', 3499, 'keep')",
  ).run(owner.id).lastInsertRowid);
  const trashedId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source, deleted_at) VALUES (?, 'ゴミ箱', 'manual://precedence-trashed', 'other', datetime('now'))",
  ).run(owner.id).lastInsertRowid);
  const emptyId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source) VALUES (?, '空', 'manual://precedence-empty', 'other')",
  ).run(owner.id).lastInsertRowid);
  const stranger = await createMember('manual-media-stranger');
  const strangerToken = await createToken(['read', 'write'], 'manual-media-stranger');
  void stranger;

  const host = 'precedence-cdn.example';
  const lookupsBefore = resolvedHosts.length;

  // 値がある側へ送ると 409（e2e の agent.spec.ts と同じ形）。メモも変わらず、名前解決はしない。
  const populated = await restPatch(token.token, populatedId, { notes: 'changed', current_price: 1, image_url: `https://${host}/x.png` });
  assert.equal(populated.status, 409, populated.text);
  assert.equal((populated.json as ErrorBody).code, 'MEDIA_ALREADY_SET');
  const populatedUnresolvable = await restPatch(token.token, populatedId, { current_price: 1, image_url: `https://${UNRESOLVABLE_IMAGE_HOST}/x.png` });
  assert.equal(populatedUnresolvable.status, 409, populatedUnresolvable.text);
  assert.equal((populatedUnresolvable.json as ErrorBody).code, 'MEDIA_ALREADY_SET');
  const populatedMcp = await mcpTool(token.token, 'update_item', { item_id: populatedId, current_price: 1, image_url: `https://${host}/mcp.png` });
  mcpError(populatedMcp, 'MEDIA_ALREADY_SET', 409);

  const trashed = await restPatch(token.token, trashedId, { image_url: `https://${host}/trash.png` });
  assert.equal(trashed.status, 409, trashed.text);
  assert.equal((trashed.json as ErrorBody).code, 'ITEM_TRASHED');
  const trashedUnresolvable = await restPatch(token.token, trashedId, { image_url: `https://${UNRESOLVABLE_IMAGE_HOST}/trash.png` });
  assert.equal(trashedUnresolvable.status, 409, trashedUnresolvable.text);
  assert.equal((trashedUnresolvable.json as ErrorBody).code, 'ITEM_TRASHED');

  const foreign = await restPatch(strangerToken.token, emptyId, { image_url: `https://${host}/foreign.png` });
  assert.equal(foreign.status, 404, foreign.text);

  assert.equal(resolvedHosts.length, lookupsBefore, 'no DNS lookup for any of the rejected requests');
  assert.equal(resolvedHosts.includes(host), false);
  assert.equal(resolvedHosts.includes(UNRESOLVABLE_IMAGE_HOST), false);
  const populatedRow = itemRow(database, populatedId);
  assert.equal(populatedRow.current_price, 3499);
  assert.equal(populatedRow.image_url, null);
  assert.equal(populatedRow.notes, 'keep');
  assert.ok(itemRow(database, trashedId).deleted_at);

  // 空のフィールドへ送ったときだけ名前解決に進み、解決できないホストは 400 URL_BLOCKED
  const unresolvable = await restPatch(token.token, emptyId, { image_url: `https://${UNRESOLVABLE_IMAGE_HOST}/x.png` });
  assert.equal(unresolvable.status, 400, unresolvable.text);
  assert.equal((unresolvable.json as ErrorBody).code, 'URL_BLOCKED');
  assert.ok(resolvedHosts.includes(UNRESOLVABLE_IMAGE_HOST), 'the empty item did reach DNS');
  assert.equal(itemRow(database, emptyId).image_url, null);
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
    // 「https://」が無い形は、ブラウザが基底 URL によって別の場所と解釈するので受け付けない
    'https:cdn.example/photo.png',
    'https:/cdn.example/x',
    'https:///cdn.example/x',
    'HTTPS:cdn.example/x',
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

  // カテゴリ・比較グループの所有と存在も同じトランザクションで見る。名前解決の間に消えたら
  // 通常の 400 INVALID_RELATION で、外部キー違反の 500 にも部分書き込みにもならない。
  const relId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source, notes) VALUES (?, '関連', 'manual://race-relations', 'other', 'before')",
  ).run(owner.id).lastInsertRowid);
  const categoryId = Number(database.prepare(
    "INSERT INTO categories (user_id, name, color) VALUES (?, '消えるカテゴリ', '#123456')",
  ).run(owner.id).lastInsertRowid);
  const groupId = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name, priority, origin) VALUES (?, '消えるグループ', 3, NULL)",
  ).run(owner.id).lastInsertRowid);
  const relationBody = { notes: 'after', category_id: categoryId, comparison_group_id: groupId, current_price: MANUAL_PRICE, image_url: body.image_url };
  await assert.rejects(
    () => updateAgentItem(auth, relId, relationBody, database, {
      deps: {
        resolve: async () => {
          database.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
          return publicAddress;
        },
      },
    }),
    guestError(400, 'INVALID_RELATION'),
  );
  let rel = itemRow(database, relId) as ItemRow & { category_id: number | null; comparison_group_id: number | null };
  assert.equal(rel.notes, 'before');
  assert.equal(rel.category_id, null);
  assert.equal(rel.comparison_group_id, null);
  assert.equal(rel.current_price, null);
  assert.equal(rel.image_url, null);
  assert.equal(priceHistory(database, relId).length, 0);

  const categoryAgain = Number(database.prepare(
    "INSERT INTO categories (user_id, name, color) VALUES (?, '残るカテゴリ', '#654321')",
  ).run(owner.id).lastInsertRowid);
  await assert.rejects(
    () => updateAgentItem(auth, relId, { ...relationBody, category_id: categoryAgain }, database, {
      deps: {
        resolve: async () => {
          database.prepare('DELETE FROM comparison_groups WHERE id = ?').run(groupId);
          return publicAddress;
        },
      },
    }),
    guestError(400, 'INVALID_RELATION'),
  );
  rel = itemRow(database, relId) as typeof rel;
  assert.equal(rel.notes, 'before');
  assert.equal(rel.category_id, null);
  assert.equal(rel.current_price, null);
  assert.equal(rel.image_url, null);
  assert.equal(priceHistory(database, relId).length, 0);

  // 競合が無ければ、関連も媒体もメモも一度に入る
  const applied = await updateAgentItem(auth, relId, { ...relationBody, category_id: categoryAgain, comparison_group_id: null }, database, {
    deps: { resolve: async () => publicAddress },
  });
  assert.equal(applied.notes, 'after');
  assert.equal(applied.category_id, categoryAgain);
  assert.equal(applied.comparison_group_id, null);
  assert.equal(applied.current_price, MANUAL_PRICE);
  assert.equal(applied.image_url, body.image_url);
  assert.deepEqual(priceHistory(database, relId).map((entry) => entry.price), [MANUAL_PRICE]);
}));
