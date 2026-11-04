import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, createMember, db, setTestUser } from './regression-harness';

import type { AgentComparisonGroup as Group } from '../src/lib/agent-comparison-groups';
type Rpc = {
  result?: {
    isError?: boolean;
    tools?: { name: string }[];
    structuredContent?: { data: { group?: Group; groups?: Group[] } };
    _meta?: { code: string };
  };
  error?: { data: { code: string } };
};

async function token(scopes: ('read' | 'write')[]) {
  const response = await call('../src/app/api/agent-tokens/route.ts', 'POST', '/api/agent-tokens',
    { name: 'comparison-test', scopes }, undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens');
  assert.equal(response.status, 201, response.text);
  return response.json as { token: string; record: { id: number } };
}

async function rpc(bearer: string, method: string, params?: unknown): Promise<Rpc> {
  const response = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp',
    { jsonrpc: '2.0', id: 1, method, params }, undefined,
    { Authorization: `Bearer ${bearer}`, Accept: 'application/json, text/event-stream' });
  assert.equal(response.status, 200, response.text);
  return response.json as Rpc;
}

function tool(bearer: string, name: string, args = {}) {
  return rpc(bearer, 'tools/call', { name, arguments: args });
}

test('MCP comparison groups: create, attach existing items, list and display through the Web API', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-04T12:00:00Z') });
  const owner = await createMember('comparison-owner');
  const auth = await token(['read', 'write']);
  const created = await tool(auth.token, 'create_comparison_group', { name: '  トラウザーの比較  ' });
  assert.equal(created.result?.isError, false, JSON.stringify(created));
  const group = created.result!.structuredContent!.data.group!;
  assert.equal(group.name, 'トラウザーの比較');
  assert.equal(group.origin, null); // Web の手作業グループと同じ。photo ではない。
  assert.equal(group.item_count, 0);
  const database = await db();
  const ids = [0, 1, 2].map(index => Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source) VALUES (?, ?, ?, 'manual')",
  ).run(owner.id, `比較候補${index}`, `manual://comparison-${index}`).lastInsertRowid));
  for (const id of ids) {
    const attached = await tool(auth.token, 'update_item', { item_id: id, comparison_group_id: group.id });
    assert.equal(attached.result?.isError, false, JSON.stringify(attached));
  }
  const listed = await tool(auth.token, 'list_comparison_groups');
  assert.deepEqual(listed.result!.structuredContent!.data.groups, [{ ...group, item_count: 3 }]);
  const web = await call('../src/app/api/comparison-groups/route.ts', 'GET', '/api/comparison-groups');
  assert.equal(web.status, 200);
  assert.ok((web.json as Group[]).some(row => row.id === group.id && row.item_count === 3 && row.name === group.name));

  // 非表示の品目と、壊れた関連付けを持つ他人の品目を件数に含めない。
  database.prepare("UPDATE items SET deleted_at = '2026-11-04 00:00:00' WHERE id = ?").run(ids[0]);
  database.prepare('UPDATE items SET is_purchased = 1 WHERE id = ?').run(ids[1]);
  const other = await createMember('comparison-other');
  const otherAuth = await token(['read', 'write']);
  const foreignItemId = Number(database.prepare(
    "INSERT INTO items (user_id, name, url, source, comparison_group_id) VALUES (?, 'foreign', 'manual://foreign', 'manual', ?)",
  ).run(other.id, group.id).lastInsertRowid);
  const hidden = await tool(otherAuth.token, 'list_comparison_groups');
  assert.deepEqual(hidden.result!.structuredContent!.data.groups, []);
  const deniedGroup = await tool(otherAuth.token, 'update_item', { item_id: foreignItemId, comparison_group_id: group.id });
  assert.equal(deniedGroup.result?._meta?.code, 'INVALID_RELATION');
  const deniedItem = await tool(otherAuth.token, 'update_item', { item_id: ids[2], comparison_group_id: null });
  assert.equal(deniedItem.result?._meta?.code, 'ITEM_NOT_FOUND');
  await setTestUser(owner);
  const activeOnly = await tool(auth.token, 'list_comparison_groups');
  assert.equal(activeOnly.result!.structuredContent!.data.groups![0].item_count, 1);
  const audit = database.prepare('SELECT action FROM agent_audit_log WHERE token_id = ? AND action = ?')
    .all(auth.record.id, 'comparison_groups.create');
  assert.equal(audit.length, 1);
});

test('MCP comparison groups: scopes, validation and existing rate limits apply', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-04T12:00:00Z') });
  await createMember('comparison-permissions');
  const read = await token(['read']);
  const write = await token(['write']);
  const names = (await rpc(read.token, 'tools/list')).result!.tools!.map(tool => tool.name);
  assert.ok(names.includes('list_comparison_groups'));
  assert.equal(names.includes('create_comparison_group'), false);
  const writeNames = (await rpc(write.token, 'tools/list')).result!.tools!.map(tool => tool.name);
  assert.ok(writeNames.includes('create_comparison_group'));
  assert.equal(writeNames.includes('list_comparison_groups'), false);
  assert.equal((await tool(read.token, 'create_comparison_group', { name: 'denied' })).error?.data.code, 'AGENT_SCOPE_DENIED');
  assert.equal((await tool(write.token, 'list_comparison_groups')).error?.data.code, 'AGENT_SCOPE_DENIED');
  for (const name of [undefined, null, '', ' \n ', '\u0000', 42, {}, 'a'.repeat(201)]) {
    const invalid = await tool(write.token, 'create_comparison_group', { name });
    assert.equal(invalid.result?._meta?.code, 'INVALID_INPUT', JSON.stringify(invalid));
  }
  const { consumeAgentRates } = await import('../src/lib/agent-token');
  const { AGENT_RATE_LIMITS } = await import('../src/lib/agent-access-limits');
  consumeAgentRates(read.record.id, ['read'], AGENT_RATE_LIMITS.read);
  assert.equal((await tool(read.token, 'list_comparison_groups')).error?.data.code, 'AGENT_RATE_LIMITED');
  // 新しいトークンで日次作成枠を使い切った場合、作成は行われない。
  const limited = await token(['write']);
  consumeAgentRates(limited.record.id, ['add_day'], AGENT_RATE_LIMITS.add_day);
  assert.equal((await tool(limited.token, 'create_comparison_group', { name: 'limited' })).error?.data.code, 'AGENT_RATE_LIMITED');
  const database = await db();
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM comparison_groups WHERE name IN ('limited', 'denied')").get() as { count: number }).count, 0);
});
