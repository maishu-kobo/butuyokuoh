import './regression-harness';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import { installFrozenClock } from './trash-restore-clock';
import { agentRateUsed, consumeAgentRates, createAgentToken } from '../src/lib/agent-token';
import { AGENT_RATE_LIMITS } from '../src/lib/agent-access-limits';

const tool = 'import_wishlist_items';
let releaseClock: () => void;
before(async () => { releaseClock = installFrozenClock(await db()); });
after(() => releaseClock());

async function rpc(token: string, method: string, params: unknown = {}) {
  const response = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp',
    { jsonrpc: '2.0', id: 1, method, params }, undefined, { Authorization: `Bearer ${token}` });
  assert.equal(response.status, 200, response.text);
  return JSON.parse(response.text);
}

function importItems(token: string, items: unknown) {
  return rpc(token, 'tools/call', { name: tool, arguments: { items } });
}

function product(index: number) {
  return { name: `商品${index}`, url: `https://item.rakuten.co.jp/test-shop/item-${index}/` };
}

test('one MCP call saves 100 independent links, restores only owned items and safely replays', async () => {
  const foreign = await createMember('other-list');
  const owner = await createMember('bulk-owner');
  const writer = createAgentToken(owner.id, { name: 'writer', scopes: ['write'] });
  const database = await db();
  const seed = database.prepare('INSERT INTO items (user_id,name,url,deleted_at) VALUES (?,?,?,?)');
  const amazon = { name: 'Amazon商品', url: 'https://www.amazon.co.jp/dp/B0TESTASIN' };
  seed.run(foreign.id, '別の持ち主', amazon.url, null);
  seed.run(owner.id, '元の品名', product(1).url, '2026-11-01');
  seed.run(owner.id, '購入済み', product(2).url, null);
  database.prepare('UPDATE items SET is_purchased=1 WHERE user_id=? AND url=?').run(owner.id, product(2).url);
  const rows = [amazon, ...Array.from({ length: 99 }, (_, i) => product(i + 1))];
  const result = await importItems(writer.token, rows);
  assert.equal(result.result.isError, false, JSON.stringify(result));
  const first = result.result.structuredContent.data;
  assert.deepEqual([first.total, first.added, first.restored, first.existing, first.failed], [100, 98, 1, 1, 0]);
  const stored = database.prepare(`SELECT count(*) FROM items WHERE user_id=? AND deleted_at IS NULL
    AND comparison_group_id IS NULL AND current_price IS NULL AND image_url IS NULL`).pluck();
  assert.equal(stored.get(owner.id), 100);
  assert.equal(stored.get(foreign.id), 1);
  assert.equal(database.prepare('SELECT count(*) FROM items WHERE added_by_agent_token_id=?').pluck().get(writer.record.id), 98);
  assert.equal(agentRateUsed(writer.record.id, 'add'), 1);
  assert.equal(agentRateUsed(writer.record.id, 'add_url'), 0);
  assert.equal(agentRateUsed(writer.record.id, 'add_day'), 99);
  const again = (await importItems(writer.token, rows)).result.structuredContent.data;
  assert.deepEqual([again.added, again.restored, again.existing], [0, 0, 100]);
  assert.equal(agentRateUsed(writer.record.id, 'add_day'), 99);
});

test('MCP discovery, validation and partial results preserve input order', async () => {
  const owner = await createMember('bulk-validation');
  const reader = createAgentToken(owner.id, { name: 'reader', scopes: ['read'] }).token;
  const writer = createAgentToken(owner.id, { name: 'writer', scopes: ['write'] }).token;
  const discover = async (token: string) => (await rpc(token, 'tools/list')).result.tools
    .some((entry: { name: string }) => entry.name === tool);
  assert.equal(await discover(reader), false);
  assert.equal(await discover(writer), true);
  assert.equal((await importItems(reader, [product(1)])).error.data.httpStatus, 403);
  for (const bad of [[], 'list', Array.from({ length: 101 }, (_, i) => product(i))]) {
    assert.equal((await importItems(writer, bad)).result._meta.httpStatus, 400);
  }
  const entries = [product(1), { ...product(1), url: product(1).url + '?utm_source=test' },
    null, { name: '非商品', url: 'https://www.amazon.co.jp/hz/wishlist/ls/demo' },
    { name: '対象外', url: 'https://example.test/dp/B0TESTASIN' }, { url: product(2).url },
    { name: '内部識別子', url: 'manual://[invalid' }];
  const result = (await importItems(writer, entries)).result.structuredContent.data;
  assert.deepEqual([result.total, result.added, result.existing, result.failed], [7, 1, 1, 5]);
  assert.deepEqual(result.results.map((row: { status: string }) => row.status),
    ['added', 'existing', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid']);
});

test('insufficient daily quota rolls back the whole import and does not consume a write call', async () => {
  const owner = await createMember('bulk-quota');
  const writer = createAgentToken(owner.id, { name: 'writer', scopes: ['write'] });
  consumeAgentRates(writer.record.id, ['add_day'], AGENT_RATE_LIMITS.add_day - 1);
  const denied = await importItems(writer.token, [product(1), product(2)]);
  assert.equal(denied.error.data.httpStatus, 429);
  assert.equal((await db()).prepare('SELECT count(*) FROM items WHERE user_id=?').pluck().get(owner.id), 0);
  assert.equal(agentRateUsed(writer.record.id, 'add'), 0);
  assert.equal(agentRateUsed(writer.record.id, 'add_day'), AGENT_RATE_LIMITS.add_day - 1);
  assert.equal((await importItems(writer.token, [product(2)])).result.structuredContent.data.added, 1);
});

test('Amazon wishlist and extension URLs match by marketplace and ASIN across registered, purchased and trashed rows', async () => {
  const member = await createMember('bulk-amazon-id');
  const token = createAgentToken(member.id, { name: 'writer', scopes: ['write'] }).token;
  const database = await db();
  const insert = database.prepare('INSERT INTO items (user_id, name, url, is_purchased, deleted_at) VALUES (?, ?, ?, ?, ?)');
  for (const [suffix, purchased, deleted] of [['1', 0, null], ['2', 1, null], ['3', 0, '2026-11-01']] as const) {
    insert.run(member.id, '以前の登録', `https://www.amazon.co.jp/dp/B00000000${suffix}`, purchased, deleted);
  }
  const links = [
    'https://www.amazon.co.jp/Example/dp/B000000001/ref=wl_it?colid=L1&coliid=I1&psc=1',
    'https://amazon.jp/gp/product/B000000002/',
    'https://www.amazon.co.jp/gp/aw/d/B000000003',
    'https://www.amazon.com/dp/B000000001',
  ];
  const results = (await importItems(token, links.map(url => ({ url, name: '候補' })))).result.structuredContent.data;
  assert.deepEqual(results.results.map((entry: { status: string }) => entry.status),
    ['existing', 'existing', 'restored', 'added']);
});

test('extension import rejects malformed source without writing any items', async () => {
  const member = await createMember('bulk-extension-source');
  const token = createAgentToken(member.id, { name: 'extension', scopes: ['extension'] }).token;
  const response = await call('../src/app/api/extension-import/route.ts', 'POST', '/api/extension-import',
    { source: {}, items: [product(1)] }, undefined, { Authorization: `Bearer ${token}` });
  assert.equal(response.status, 400);
  assert.equal((await db()).prepare('SELECT count(*) FROM items WHERE user_id=?').pluck().get(member.id), 0);
});
