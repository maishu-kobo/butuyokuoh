// MCP tools/call save_comparison_candidates（#388）。
// 比較中の異なる商品を、新規 URL と登録済み ID の混在で、1 回の呼び出しで同じ手作業比較グループへ保存する。
// 実際の /api/mcp 経路と Web の一覧 API で確かめる。DB は一時ファイル、取得は fixture、時計は固定。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, mock, test } from 'node:test';
import fc from 'fast-check';
import { call, createMember, db, setTestUser } from './regression-harness';
import {
  AMAZON_NAME,
  AMAZON_PRICE,
  AMAZON_PRODUCT_URL,
  FAIL_URL,
  PITAKA_NAME,
  PITAKA_PRICE,
  PITAKA_URL,
  RAKUTEN_URL,
  regressionLookup,
} from '../src/lib/product-regression-fixtures';
import type { ProductFixture } from '../src/lib/product-regression-fixtures';
import { installFrozenClock } from './trash-restore-clock';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const mcpPath = '../src/app/api/mcp/route.ts';
const webGroupsPath = '../src/app/api/comparison-groups/route.ts';
const webItemsPath = '../src/app/api/items/route.ts';
const TOOL = 'save_comparison_candidates';

let releaseClock: (() => void) | null = null;
before(async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  releaseClock = installFrozenClock(await db());
});
after(() => {
  releaseClock?.();
  mock.restoreAll();
});

let exclusive: Promise<void> = Promise.resolve();
function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

type Database = Awaited<ReturnType<typeof db>>;
type Scope = 'read' | 'write';

async function createToken(scopes: Scope[], name: string) {
  const created = await call(
    tokensPath, 'POST', '/api/agent-tokens', { name, scopes, expiresInDays: 30 },
    undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens',
  );
  assert.equal(created.status, 201, created.text);
  return created.json as { token: string; record: { id: number } };
}

type SavedCandidate = {
  position: number;
  item_id: number;
  name: string;
  url: string;
  current_price: number | null;
  result: 'created' | 'added_to_group' | 'already_in_group';
};

type Saved = {
  status: 'saved' | 'already_saved';
  changed: boolean;
  replayed: boolean;
  message: string;
  group: { id: number; name: string; origin: string | null; item_count: number; created: boolean };
  candidates: SavedCandidate[];
  item_ids: number[];
  media_fetch_errors: { url: string; code: string; message: string }[];
  replay_of?: {
    saved_at: string;
    group_created: boolean;
    candidates: { position: number; item_id: number; result: string }[];
  };
};

type McpResponse = {
  result?: {
    isError?: boolean;
    content?: { type: string; text: string }[];
    structuredContent?: { data: Record<string, unknown> };
    tools?: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: Record<string, unknown>;
    }[];
    instructions?: string;
    _meta?: { code?: string; httpStatus?: number };
  };
  error?: { code: number; message: string; data?: { httpStatus?: number; code?: string } };
};

let rpcId = 0;
async function rpc(token: string, method: string, params?: unknown): Promise<McpResponse> {
  const response = await call(mcpPath, 'POST', '/api/mcp', {
    jsonrpc: '2.0', id: ++rpcId, method, params,
  }, undefined, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
  assert.equal(response.status, 200, response.text);
  return response.json as McpResponse;
}

function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  return rpc(token, 'tools/call', { name, arguments: args });
}

function saved(body: McpResponse): Saved {
  assert.equal(body.result?.isError, false, JSON.stringify(body));
  return body.result!.structuredContent!.data as unknown as Saved;
}

/** ツール実行エラー（isError 結果）のコードと文面。 */
function failure(body: McpResponse): { code: string | undefined; text: string } {
  assert.equal(body.result?.isError, true, JSON.stringify(body));
  return { code: body.result?._meta?.code, text: body.result?.content?.[0]?.text ?? '' };
}

type Port = { lookup: (url: URL) => ProductFixture | undefined; timeoutMs?: number };

/** fixture を使いながら、取りに行った URL を記録する。onFetch で取得の最中に別の操作を挟める。 */
function recordingPort(onFetch?: (href: string) => void) {
  const fetched: string[] = [];
  const port: Port = {
    lookup: (url) => {
      fetched.push(url.href);
      onFetch?.(url.href);
      return regressionLookup(url);
    },
    timeoutMs: 400,
  };
  return { fetched, port };
}

async function withPort<T>(port: Port, run: () => Promise<T>): Promise<T> {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(port);
  try {
    return await run();
  } finally {
    installProductFetchPort(null);
  }
}

function insertItem(
  database: Database,
  userId: number,
  name: string,
  url: string,
  extra: { group?: number | null; deleted?: boolean; purchased?: boolean; notes?: string; price?: number } = {},
): number {
  return Number(database.prepare(`
    INSERT INTO items (user_id, name, url, source, comparison_group_id, deleted_at, is_purchased, notes, current_price)
    VALUES (?, ?, ?, 'other', ?, ?, ?, ?, ?)
  `).run(
    userId, name, url, extra.group ?? null,
    extra.deleted ? '2026-11-01 00:00:00' : null,
    extra.purchased ? 1 : 0,
    extra.notes ?? null,
    extra.price ?? null,
  ).lastInsertRowid);
}

function insertGroup(database: Database, userId: number, name: string, origin: string | null = null): number {
  return Number(database.prepare(
    'INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, ?, ?)',
  ).run(userId, name, origin).lastInsertRowid);
}

/** 保存済みの状態。失敗・再送で何も変わらないことを丸ごと比べる。 */
function snapshot(database: Database, userId: number) {
  return {
    items: database.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY id').all(userId),
    groups: database.prepare('SELECT * FROM comparison_groups WHERE user_id = ? ORDER BY id').all(userId),
    history: database.prepare(`
      SELECT h.id, h.item_id, h.price FROM price_history h
      JOIN items i ON i.id = h.item_id WHERE i.user_id = ? ORDER BY h.id
    `).all(userId),
  };
}

function auditRows(database: Database, tokenId: number) {
  return database.prepare(
    "SELECT meta FROM agent_audit_log WHERE token_id = ? AND action = 'comparison_candidates.save' ORDER BY id",
  ).all(tokenId) as { meta: string }[];
}

async function rateUsed(tokenId: number) {
  const { agentRateUsed } = await import('../src/lib/agent-token');
  const database = await db();
  return {
    add: agentRateUsed(tokenId, 'add', database),
    add_url: agentRateUsed(tokenId, 'add_url', database),
    add_day: agentRateUsed(tokenId, 'add_day', database),
  };
}

test('案内: initialize の冒頭・ツール一覧・llms.txt から、比較候補／同じ商品の店舗比較／独立した登録を選び分けられる', () => serial(async () => {
  await createMember('cc-guidance');
  const write = await createToken(['write'], 'cc-guidance-write');
  const read = await createToken(['read'], 'cc-guidance-read');

  const init = await rpc(write.token, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  const lines = (init.result!.instructions ?? '').split('\n');
  // 冒頭付近（認証の1行の直後）に、英語と日本語の保存方法の使い分けがある。
  const head = lines.slice(0, 3).join('\n');
  for (const name of [TOOL, 'add_item_by_url']) {
    assert.ok(lines[1].includes(name), `English guidance names ${name}`);
    assert.ok(lines[2].includes(name), `日本語の案内に ${name} がある`);
  }
  assert.match(head, /separately/i);
  assert.match(head, /別々/);
  assert.match(head, /only when the user asks to save/i);
  assert.match(head, /保存を頼まれたときだけ/);

  const writeTools = (await rpc(write.token, 'tools/list')).result!.tools!;
  const saveTool = writeTools.find((entry) => entry.name === TOOL);
  assert.ok(saveTool, 'write トークンには見える');
  assert.equal(saveTool.annotations.readOnlyHint, false);
  assert.equal(saveTool.annotations.destructiveHint, false);
  assert.equal(saveTool.annotations.idempotentHint, true);
  const schema = saveTool.inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: { candidates: { minItems: number; maxItems: number } };
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['name', 'candidates']);
  assert.equal(schema.properties.candidates.minItems, 2);
  assert.equal(schema.properties.candidates.maxItems, 10);
  // 3 つの保存方法が、互いの説明から選び分けられる。
  assert.match(saveTool.description, /異なる商品/);
  assert.match(saveTool.description, /add_item_by_url/);
  const addByUrl = writeTools.find((entry) => entry.name === 'add_item_by_url')!;
  assert.match(addByUrl.description, /同じ商品/);
  assert.ok(addByUrl.description.includes(TOOL));
  assert.ok(writeTools.find((entry) => entry.name === 'create_comparison_group')!.description.includes(TOOL));

  const readTools = (await rpc(read.token, 'tools/list')).result!.tools!.map((entry) => entry.name);
  assert.equal(readTools.includes(TOOL), false, 'read だけのトークンには出さない');

  const llms = readFileSync(join(process.cwd(), 'public', 'llms.txt'), 'utf8');
  assert.ok(llms.includes(`| ${TOOL} | write |`));
  assert.ok(llms.includes(`"name": "${TOOL}"`));
  assert.match(llms, /Choosing how to save/);
  assert.match(llms, /別々に入れて/);
  // 上限の説明は、消費のあとの失敗では戻らないことを書く（「拒否は一切消費しない」とは書かない）。
  assert.doesNotMatch(llms, /Rejected calls and no-change retries cost nothing/);
  assert.match(llms, /not refunded/);
  for (const code of ['CANDIDATE_IN_OTHER_GROUP', 'SAVED_REQUEST_CHANGED', 'CANDIDATES_CHANGED', 'URL_AMBIGUOUS']) {
    assert.ok(llms.includes(code), `llms.txt に ${code} がある`);
    assert.ok(saveTool.description.includes(code), `ツールの説明に ${code} がある`);
  }
}));

test('新規 URL と登録済み ID を1回で同じ手作業比較グループへ保存し、Web の比較表示にも出る', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-mixed');
    const auth = await createToken(['read', 'write'], 'cc-mixed');
    const database = await db();
    const existingId = insertItem(database, owner.id, '登録済みのヘッドホン', 'https://example.com/products/headphone-b', {
      notes: '店頭で試聴済み', price: 39800,
    });
    const before = database.prepare('SELECT * FROM items WHERE id = ?').get(existingId) as Record<string, unknown>;

    const result = saved(await tool(auth.token, TOOL, {
      name: '  ヘッドホンの比較  ',
      candidates: [{ url: PITAKA_URL }, { item_id: existingId }],
    }));

    assert.equal(result.status, 'saved');
    assert.equal(result.changed, true);
    assert.equal(result.replayed, false);
    assert.equal(result.group.name, 'ヘッドホンの比較');
    assert.equal(result.group.origin, null, '同じ商品の店舗比較（photo）ではなく手作業比較');
    assert.equal(result.group.created, true);
    assert.equal(result.group.item_count, 2);
    assert.deepEqual(result.candidates.map((entry) => [entry.position, entry.result]), [
      [1, 'created'], [2, 'added_to_group'],
    ]);
    assert.equal(result.candidates[0].name, PITAKA_NAME);
    assert.equal(result.candidates[0].current_price, PITAKA_PRICE, '価格はサーバ取得');
    assert.equal(result.candidates[1].item_id, existingId);
    assert.deepEqual(result.item_ids, result.candidates.map((entry) => entry.item_id));
    assert.deepEqual(result.media_fetch_errors, []);
    assert.deepEqual(fetched, [PITAKA_URL], '登録済み ID は取得しない');

    // 各候補は独立した商品のまま（名前・URL が別、店の行としてまとめない）。
    const rows = database.prepare(
      'SELECT id, name, url, comparison_group_id, added_by_agent_token_id FROM items WHERE user_id = ? ORDER BY id',
    ).all(owner.id) as { id: number; name: string; url: string; comparison_group_id: number; added_by_agent_token_id: number | null }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.comparison_group_id === result.group.id));
    assert.notEqual(rows[0].name, rows[1].name);
    const created = rows.find((row) => row.id !== existingId)!;
    assert.equal(created.added_by_agent_token_id, auth.record.id);
    // 登録済みの商品は、所属以外を変えない。
    const afterRow = database.prepare('SELECT * FROM items WHERE id = ?').get(existingId) as Record<string, unknown>;
    assert.deepEqual(
      { ...afterRow, comparison_group_id: null, updated_at: null },
      { ...before, comparison_group_id: null, updated_at: null },
    );
    assert.equal(afterRow.added_by_agent_token_id, null, '既存品目に「エージェントが追加」の印は付けない');
    assert.deepEqual(
      database.prepare('SELECT id, origin, capture_id FROM comparison_groups WHERE user_id = ?').all(owner.id),
      [{ id: result.group.id, origin: null, capture_id: null }],
    );

    // MCP の読み取りと Web の API の両方で同じ結果が見える。
    const listed = await tool(auth.token, 'list_comparison_groups');
    assert.deepEqual(listed.result!.structuredContent!.data.groups, [
      { id: result.group.id, name: 'ヘッドホンの比較', origin: null, item_count: 2 },
    ]);
    await setTestUser(owner);
    const webGroups = await call(webGroupsPath, 'GET', '/api/comparison-groups');
    assert.equal(webGroups.status, 200);
    const webGroup = (webGroups.json as { id: number; name: string; origin: string | null; item_count: number }[])
      .find((row) => row.id === result.group.id);
    assert.deepEqual(
      { name: webGroup?.name, origin: webGroup?.origin, item_count: webGroup?.item_count },
      { name: 'ヘッドホンの比較', origin: null, item_count: 2 },
    );
    const webItems = await call(webItemsPath, 'GET', '/api/items');
    assert.equal(webItems.status, 200);
    const inGroup = (webItems.json as {
      id: number; comparison_group_id: number | null; comparison_group_name: string | null; comparison_group_origin: string | null;
    }[]).filter((row) => row.comparison_group_id === result.group.id);
    assert.deepEqual(inGroup.map((row) => row.id).sort(), [...result.item_ids].sort());
    assert.ok(inGroup.every((row) => row.comparison_group_name === 'ヘッドホンの比較' && row.comparison_group_origin === null));

    // 上限は取得した URL 件数分。操作ログは1件。
    assert.deepEqual(await rateUsed(auth.record.id), { add: 1, add_url: 1, add_day: 1 });
    const audit = auditRows(database, auth.record.id);
    assert.equal(audit.length, 1);
    const meta = JSON.parse(audit[0].meta) as { group_id: number; tool: string; scope: string };
    assert.deepEqual({ group_id: meta.group_id, tool: meta.tool, scope: meta.scope }, {
      group_id: result.group.id, tool: TOOL, scope: 'write',
    });
  });
}));

test('候補の1件が登録できないと、空グループ・一部だけの登録・所属変更を残さない', () => serial(async () => {
  const { port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-atomic');
    const other = await createMember('cc-atomic-other');
    await setTestUser(owner);
    const auth = await createToken(['read', 'write'], 'cc-atomic');
    const database = await db();
    const existingId = insertItem(database, owner.id, '登録済み', 'https://example.com/products/owned');
    const foreignId = insertItem(database, other.id, '他人の商品', 'https://example.com/products/foreign');
    const untouched = snapshot(database, owner.id);
    const foreignBefore = snapshot(database, other.id);

    const cases: { candidates: unknown[]; code: string; text: RegExp }[] = [
      // 名前を取得できない URL（name の指定なし）
      { candidates: [{ url: PITAKA_URL }, { item_id: existingId }, { url: FAIL_URL }], code: 'NAME_REQUIRED', text: /候補3/ },
      // 存在しない ID
      { candidates: [{ url: PITAKA_URL }, { item_id: 999_999 }], code: 'ITEM_NOT_FOUND', text: /候補2/ },
      // 他人の ID（存在を漏らさず 404）
      { candidates: [{ item_id: existingId }, { item_id: foreignId }], code: 'ITEM_NOT_FOUND', text: /候補2/ },
      // 内部向けの URL
      { candidates: [{ item_id: existingId }, { url: 'http://127.0.0.1/admin', name: '内部' }], code: 'URL_BLOCKED', text: /候補2/ },
    ];
    for (const entry of cases) {
      const failed = failure(await tool(auth.token, TOOL, { name: '失敗する比較', candidates: entry.candidates }));
      assert.equal(failed.code, entry.code, failed.text);
      assert.match(failed.text, entry.text);
      assert.match(failed.text, /何も保存・変更していません/);
      assert.deepEqual(snapshot(database, owner.id), untouched, `${entry.code} のあと何も残さない`);
    }
    assert.deepEqual(snapshot(database, other.id), foreignBefore);
    assert.equal(auditRows(database, auth.record.id).length, 0, '失敗は成功を装う記録を残さない');

    // 取得に失敗しても name があれば、従来の登録と同じく名前と URL で保存し、失敗理由を返す。
    const partial = saved(await tool(auth.token, TOOL, {
      name: '失敗を含む比較',
      candidates: [{ url: FAIL_URL, name: '取得できない店の商品' }, { item_id: existingId }],
    }));
    assert.equal(partial.candidates[0].name, '取得できない店の商品');
    assert.equal(partial.candidates[0].current_price, null);
    assert.deepEqual(partial.media_fetch_errors.map((entry) => [entry.url, entry.code]), [[FAIL_URL, 'FETCH_FAILED']]);
    assert.equal(partial.group.item_count, 2);
    // 再送でも、取得できなかったことが同じ形で伝わる。
    const partialRetry = saved(await tool(auth.token, TOOL, {
      name: '失敗を含む比較',
      candidates: [{ url: FAIL_URL, name: '取得できない店の商品' }, { item_id: existingId }],
    }));
    assert.equal(partialRetry.replayed, true);
    assert.deepEqual(partialRetry.media_fetch_errors, partial.media_fetch_errors);
  });
}));

test('応答が途切れて同じ要求を再送しても、グループも商品も重複しない', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-replay');
    const auth = await createToken(['read', 'write'], 'cc-replay');
    const database = await db();
    const existingId = insertItem(database, owner.id, '登録済み', 'https://example.com/products/replay-b');
    const args = { name: 'イヤホンの比較', candidates: [{ url: AMAZON_PRODUCT_URL }, { item_id: existingId }] };

    // 1回目は成功したが、クライアントは応答を受け取れなかったものとする。
    const first = saved(await tool(auth.token, TOOL, args));
    assert.equal(first.changed, true);
    const afterFirst = snapshot(database, owner.id);
    const rateAfterFirst = await rateUsed(auth.record.id);

    // 候補の順序や計測パラメータが違っても同じ要求として扱う。
    const retries = [
      args,
      { name: 'イヤホンの比較', candidates: [{ item_id: existingId }, { url: `${AMAZON_PRODUCT_URL}?tag=affiliate-22` }] },
    ];
    for (const retry of retries) {
      const replay = saved(await tool(auth.token, TOOL, retry));
      assert.equal(replay.status, 'already_saved');
      assert.equal(replay.changed, false);
      assert.equal(replay.replayed, true);
      assert.deepEqual(
        { id: replay.group.id, name: replay.group.name, created: replay.group.created, item_count: replay.group.item_count },
        { id: first.group.id, name: 'イヤホンの比較', created: false, item_count: 2 },
      );
      assert.deepEqual([...replay.item_ids].sort(), [...first.item_ids].sort());
      assert.ok(replay.candidates.every((entry) => entry.result === 'already_in_group'));
      // 最初の保存で何が起きたかを同じ内容で返す。
      assert.equal(replay.replay_of?.group_created, true);
      assert.deepEqual(
        [...replay.replay_of!.candidates].sort((a, b) => a.item_id - b.item_id).map((entry) => [entry.item_id, entry.result]),
        [...first.candidates].sort((a, b) => a.item_id - b.item_id).map((entry) => [entry.item_id, entry.result]),
      );
      assert.deepEqual(snapshot(database, owner.id), afterFirst, '再送は保存済みの状態を変えない');
    }
    assert.deepEqual(fetched, [AMAZON_PRODUCT_URL], '再送では取得し直さない');
    assert.deepEqual(await rateUsed(auth.record.id), rateAfterFirst, '再送は上限を消費しない');
    assert.equal(auditRows(database, auth.record.id).length, 1);

    // グループ名だけ変えた要求は別の依頼。同じ候補を2つ目のグループへ重複させず、既存のグループにも触らない。
    const renamed = failure(await tool(auth.token, TOOL, { ...args, name: 'イヤホン比較（言い換え）' }));
    assert.equal(renamed.code, 'CANDIDATE_IN_OTHER_GROUP', renamed.text);
    assert.match(renamed.text, /イヤホンの比較/);
    assert.deepEqual(snapshot(database, owner.id), afterFirst);
    assert.deepEqual(await rateUsed(auth.record.id), rateAfterFirst);
  });
}));

test('外部取得の最中に同じ要求が重なっても、保存は1回分だけ', () => serial(async () => {
  const owner = await createMember('cc-concurrent');
  const auth = await createToken(['read', 'write'], 'cc-concurrent');
  const database = await db();
  const args = { name: 'ケースの比較', candidates: [{ url: PITAKA_URL }, { url: AMAZON_PRODUCT_URL }] };
  let second: Promise<McpResponse> | null = null;
  let groupsWhenSecondStarted = -1;
  const { fetched, port } = recordingPort(() => {
    if (second) return;
    // 1回目が最初の URL を取得している最中（まだ何も保存していない）に、同じ要求をもう一度送る。
    groupsWhenSecondStarted = snapshot(database, owner.id).groups.length;
    second = tool(auth.token, TOOL, args);
  });
  await withPort(port, async () => {
    const firstBody = await tool(auth.token, TOOL, args);
    assert.ok(second, 'the overlapping request was sent');
    const results = [saved(firstBody), saved(await second)];
    assert.equal(groupsWhenSecondStarted, 0);
    assert.ok(fetched.length > 2, '2回目も保存の前に取得まで進んでいる');

    const state = snapshot(database, owner.id);
    assert.equal(state.groups.length, 1);
    assert.equal(state.items.length, 2);
    assert.equal(state.history.length, 2);
    assert.deepEqual(results.map((entry) => entry.changed).sort(), [false, true], '保存したのは片方だけ');
    const [winner, replay] = results[0].changed ? results : [results[1], results[0]];
    assert.equal(replay.status, 'already_saved');
    assert.equal(replay.replayed, true);
    assert.equal(replay.group.id, winner.group.id);
    assert.deepEqual(replay.item_ids, winner.item_ids);
    assert.equal(auditRows(database, auth.record.id).length, 1);
  });
}));

test('外部取得の最中に候補の状態が変わったら、取得結果を捨てて何も保存しない', () => serial(async () => {
  const owner = await createMember('cc-race');
  const auth = await createToken(['read', 'write'], 'cc-race');
  const database = await db();
  const existingId = insertItem(database, owner.id, '取得中にゴミ箱へ入る商品', 'https://example.com/products/race');
  const { port } = recordingPort(() => {
    database.prepare("UPDATE items SET deleted_at = '2026-11-06 00:00:00' WHERE id = ?").run(existingId);
  });
  await withPort(port, async () => {
    const failed = failure(await tool(auth.token, TOOL, {
      name: '競合する比較', candidates: [{ url: PITAKA_URL }, { item_id: existingId }],
    }));
    assert.equal(failed.code, 'ITEM_TRASHED');
    const state = snapshot(database, owner.id);
    assert.equal(state.groups.length, 0, '空グループを残さない');
    assert.equal(state.items.length, 1, '取得できた側だけを登録しない');
    assert.equal((state.items[0] as { deleted_at: string | null }).deleted_at, '2026-11-06 00:00:00', '勝手に復元しない');
    assert.equal(auditRows(database, auth.record.id).length, 0);
  });
}));

test('既登録 URL・別グループ所属・ゴミ箱・購入済みの候補は、定義どおりに扱い、既存の商品を移動も復元もしない', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-policy');
    const auth = await createToken(['read', 'write'], 'cc-policy');
    const database = await db();

    // 既登録 URL（ほしいものリスト・グループなし）: 重複登録も再取得もせず、その商品をグループへ入れる。
    const registeredId = insertItem(database, owner.id, '登録済みの URL', `${PITAKA_URL}?utm_source=mail`, { price: 1000 });
    const plainId = insertItem(database, owner.id, '候補B', 'https://example.com/products/policy-b');
    const reused = saved(await tool(auth.token, TOOL, {
      name: '既登録を含む比較', candidates: [{ url: PITAKA_URL }, { item_id: plainId }],
    }));
    assert.deepEqual(reused.candidates.map((entry) => [entry.item_id, entry.result]), [
      [registeredId, 'added_to_group'], [plainId, 'added_to_group'],
    ]);
    assert.equal(reused.candidates[0].current_price, 1000, '保存済みの価格を取得で上書きしない');
    assert.deepEqual(fetched, []);
    assert.equal(snapshot(database, owner.id).items.length, 2);
    // 取得しない保存は、グループ作成1回分だけ上限を使う（create_comparison_group と同じ）。
    assert.deepEqual(await rateUsed(auth.record.id), { add: 1, add_url: 0, add_day: 1 });
    const groupA = reused.group.id;

    // 候補の一部が、指定と同じ名前の手作業比較グループにいる: そのグループへ残りを足す。既存の所属は動かさない。
    const joined = saved(await tool(auth.token, TOOL, {
      name: ' 既登録を含む比較 ', candidates: [{ item_id: registeredId }, { url: AMAZON_PRODUCT_URL }],
    }));
    assert.equal(joined.status, 'saved');
    assert.equal(joined.changed, true);
    assert.deepEqual(
      { id: joined.group.id, name: joined.group.name, created: joined.group.created, item_count: joined.group.item_count },
      { id: groupA, name: '既登録を含む比較', created: false, item_count: 3 },
    );
    assert.deepEqual(joined.candidates.map((entry) => entry.result), ['already_in_group', 'created']);
    assert.equal(joined.candidates[1].name, AMAZON_NAME);
    assert.equal(joined.candidates[1].current_price, AMAZON_PRICE);
    assert.equal(snapshot(database, owner.id).groups.length, 1, '新しいグループは作らない');

    // ここから先は拒否。どれも保存済みの状態を変えない。
    const groupB = insertGroup(database, owner.id, '別の比較');
    const inOtherGroupId = insertItem(database, owner.id, '別グループの商品', 'https://example.com/products/policy-c', { group: groupB });
    const photoGroup = insertGroup(database, owner.id, '同じ商品の店舗比較', 'photo');
    const storeRowId = insertItem(database, owner.id, '店の行', 'https://example.com/products/policy-store', { group: photoGroup });
    const trashedId = insertItem(database, owner.id, 'ゴミ箱の商品', 'https://example.com/products/policy-trash', { deleted: true });
    const trashedUrlId = insertItem(database, owner.id, 'ゴミ箱の URL', RAKUTEN_URL, { deleted: true });
    const purchasedId = insertItem(database, owner.id, '購入済みの商品', 'https://example.com/products/policy-bought', { purchased: true });
    const freeId = insertItem(database, owner.id, '候補D', 'https://example.com/products/policy-d');
    const frozen = snapshot(database, owner.id);
    const fetchedBefore = fetched.length;

    const refusals: { candidates: unknown[]; code: string; text: RegExp }[] = [
      // 別々の手作業比較グループにいる候補同士: どちらも移動しない。
      { candidates: [{ item_id: registeredId }, { item_id: inOtherGroupId }], code: 'CANDIDATES_IN_DIFFERENT_GROUPS', text: /別の比較/ },
      // 指定と違う名前のグループにいる候補: そのグループへ足しも、そこから移しもしない。
      { candidates: [{ item_id: registeredId }, { item_id: freeId }], code: 'CANDIDATE_IN_OTHER_GROUP', text: /候補1.*既登録を含む比較/ },
      // 同じ商品の店舗比較（photo）の店の行は、手作業比較へ移さない。
      { candidates: [{ item_id: freeId }, { item_id: storeRowId }], code: 'ITEM_IN_STORE_GROUP', text: /候補2/ },
      // ゴミ箱の ID・ゴミ箱にだけある URL は復元しない。
      { candidates: [{ item_id: freeId }, { item_id: trashedId }], code: 'ITEM_TRASHED', text: /候補2/ },
      { candidates: [{ url: RAKUTEN_URL }, { item_id: freeId }], code: 'URL_IN_TRASH', text: /候補1/ },
      // 購入済みは比較候補にしない（ID でも URL でも）。
      { candidates: [{ item_id: freeId }, { item_id: purchasedId }], code: 'ITEM_PURCHASED', text: /候補2/ },
      { candidates: [{ item_id: freeId }, { url: 'https://example.com/products/policy-bought' }], code: 'ITEM_PURCHASED', text: /候補2/ },
    ];
    for (const entry of refusals) {
      const refused = failure(await tool(auth.token, TOOL, { name: '拒否される比較', candidates: entry.candidates }));
      assert.equal(refused.code, entry.code, refused.text);
      assert.match(refused.text, entry.text);
      assert.deepEqual(snapshot(database, owner.id), frozen, `${entry.code} は何も変えない`);
    }
    assert.equal(fetched.length, fetchedBefore, '拒否が決まっている要求は外部取得まで進まない');
    assert.ok(trashedUrlId > 0);
  });
}));

test('権限・所有者・入力・登録件数の上限は既存の決まりのまま適用する', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-limits');
    const database = await db();
    const read = await createToken(['read'], 'cc-limits-read');
    const write = await createToken(['write'], 'cc-limits-write');
    const firstId = insertItem(database, owner.id, '候補1', 'https://example.com/products/limits-1');
    const secondId = insertItem(database, owner.id, '候補2', 'https://example.com/products/limits-2');
    const untouched = snapshot(database, owner.id);
    const valid = [{ item_id: firstId }, { item_id: secondId }];

    const denied = await tool(read.token, TOOL, { name: '権限なし', candidates: valid });
    assert.equal(denied.error?.data?.code, 'AGENT_SCOPE_DENIED');

    const invalid: Record<string, unknown>[] = [
      { candidates: valid },
      { name: ' \n ', candidates: valid },
      { name: 'a'.repeat(201), candidates: valid },
      { name: '比較' },
      { name: '比較', candidates: 'not-an-array' },
      { name: '比較', candidates: [{ item_id: firstId }] },
      { name: '比較', candidates: Array.from({ length: 11 }, (_, index) => ({ url: `https://example.com/p/${index}` })) },
      { name: '比較', candidates: [{ item_id: firstId }, { item_id: firstId }] },
      { name: '比較', candidates: [{ url: PITAKA_URL }, { url: `${PITAKA_URL}?utm_campaign=x` }] },
      { name: '比較', candidates: [{ item_id: firstId }, {}] },
      { name: '比較', candidates: [{ item_id: firstId }, { item_id: secondId, url: PITAKA_URL }] },
      { name: '比較', candidates: [{ item_id: firstId }, { item_id: 0 }] },
      { name: '比較', candidates: [{ item_id: firstId }, { item_id: '2' }] },
      { name: '比較', candidates: [{ item_id: firstId }, { url: 'ftp://example.com/file' }] },
      { name: '比較', candidates: [{ item_id: firstId }, { url: 'manual://local' }] },
      { name: '比較', candidates: [{ item_id: firstId }, { item_id: secondId, name: '既存の改名' }] },
      { name: '比較', candidates: [{ item_id: firstId }, { url: PITAKA_URL, current_price: 100 }] },
      { name: '比較', candidates: [{ item_id: firstId }, 'https://example.com/p'] },
      { name: '比較', candidates: valid, user_id: 1 },
      { name: '比較', candidates: valid, origin: 'photo' },
    ];
    for (const args of invalid) {
      const rejected = failure(await tool(write.token, TOOL, args));
      assert.equal(rejected.code, 'INVALID_INPUT', `${JSON.stringify(args).slice(0, 120)} → ${rejected.text}`);
    }
    assert.deepEqual(snapshot(database, owner.id), untouched);
    assert.deepEqual(await rateUsed(write.record.id), { add: 0, add_url: 0, add_day: 0 }, '拒否は上限を消費しない');
    assert.deepEqual(fetched, []);

    // 他の会員のトークンからは、ID を知っていても使えない。
    await createMember('cc-limits-stranger');
    const stranger = await createToken(['write'], 'cc-limits-stranger');
    assert.equal(failure(await tool(stranger.token, TOOL, { name: '他人', candidates: valid })).code, 'ITEM_NOT_FOUND');
    assert.deepEqual(snapshot(database, owner.id), untouched);

    // URL 追加の上限（分あたり）を超える要求は、丸ごと拒否して何も保存しない。
    const { consumeAgentRates } = await import('../src/lib/agent-token');
    const { AGENT_RATE_LIMITS } = await import('../src/lib/agent-access-limits');
    consumeAgentRates(write.record.id, ['add_url'], AGENT_RATE_LIMITS.add_url - 1);
    const limited = await tool(write.token, TOOL, {
      name: '上限超え', candidates: [{ url: PITAKA_URL }, { url: AMAZON_PRODUCT_URL }],
    });
    assert.equal(limited.error?.data?.code, 'AGENT_RATE_LIMITED');
    assert.deepEqual(snapshot(database, owner.id), untouched);
    assert.deepEqual(fetched, []);
    assert.deepEqual(await rateUsed(write.record.id), { add: 0, add_url: AGENT_RATE_LIMITS.add_url - 1, add_day: 0 });

    // 日次の登録上限を使い切ったトークンは、取得を伴わないグループ作成もできない。
    await setTestUser(owner);
    const daily = await createToken(['write'], 'cc-limits-daily');
    consumeAgentRates(daily.record.id, ['add_day'], AGENT_RATE_LIMITS.add_day);
    const dailyLimited = await tool(daily.token, TOOL, { name: '日次上限', candidates: valid });
    assert.equal(dailyLimited.error?.data?.code, 'AGENT_RATE_LIMITED');
    assert.deepEqual(snapshot(database, owner.id), untouched);
  });
}));

test('指定した名前のグループだけを使う: 別の名前のグループにいる候補は 409、名前が同じだけの無関係なグループには入れない', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-named');
    const auth = await createToken(['read', 'write'], 'cc-named');
    const database = await db();
    const a = insertItem(database, owner.id, '候補A', 'https://example.com/products/named-a');
    const b = insertItem(database, owner.id, '候補B', 'https://example.com/products/named-b');

    const commute = saved(await tool(auth.token, TOOL, { name: '通勤用', candidates: [{ item_id: a }, { item_id: b }] }));
    const afterCommute = snapshot(database, owner.id);
    const rateAfterCommute = await rateUsed(auth.record.id);

    // A + C を「別用途」で: C を「通勤用」へ足さない。A を移さない。新しいグループも作らない。
    const refused = failure(await tool(auth.token, TOOL, {
      name: '別用途', candidates: [{ item_id: a }, { url: PITAKA_URL }],
    }));
    assert.equal(refused.code, 'CANDIDATE_IN_OTHER_GROUP', refused.text);
    assert.match(refused.text, /候補1/);
    assert.match(refused.text, /通勤用/);
    assert.match(refused.text, /update_item/);
    assert.match(refused.text, /何も保存・変更していません/);
    assert.deepEqual(snapshot(database, owner.id), afterCommute);
    assert.deepEqual(fetched, [], '拒否が決まっている要求は取得しない');
    assert.deepEqual(await rateUsed(auth.record.id), rateAfterCommute);
    assert.equal(auditRows(database, auth.record.id).length, 1);

    // 同じ名前（整形後）を指定すれば、そのグループへ足す。
    const joined = saved(await tool(auth.token, TOOL, {
      name: '  通勤用 ', candidates: [{ item_id: a }, { url: PITAKA_URL }],
    }));
    assert.deepEqual(
      { id: joined.group.id, created: joined.group.created, item_count: joined.group.item_count },
      { id: commute.group.id, created: false, item_count: 3 },
    );
    assert.deepEqual(joined.candidates.map((entry) => entry.result), ['already_in_group', 'created']);

    // 候補がどのグループにもいなければ、同じ名前の無関係なグループがあっても、そこへは入れない。
    const d = insertItem(database, owner.id, '候補D', 'https://example.com/products/named-d');
    const e = insertItem(database, owner.id, '候補E', 'https://example.com/products/named-e');
    const fresh = saved(await tool(auth.token, TOOL, { name: '通勤用', candidates: [{ item_id: d }, { item_id: e }] }));
    assert.equal(fresh.group.created, true);
    assert.notEqual(fresh.group.id, commute.group.id);
    assert.equal(fresh.group.item_count, 2);
    const members = database.prepare(
      'SELECT id FROM items WHERE user_id = ? AND comparison_group_id = ? ORDER BY id',
    ).all(owner.id, commute.group.id) as { id: number }[];
    assert.equal(members.length, 3, '無関係な同名グループの中身は変わらない');
    assert.ok(!members.some((row) => row.id === d || row.id === e));
  });
}));

test('再送は保存記録で判定する: 利用者があとで外した・消した内容を巻き戻さず、名前の変更や追加はそのまま返す', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-history');
    const auth = await createToken(['read', 'write'], 'cc-history');
    const database = await db();
    const existingId = insertItem(database, owner.id, '登録済み', 'https://example.com/products/history-b');
    const args = { name: '履歴の比較', candidates: [{ url: PITAKA_URL }, { item_id: existingId }] };
    const first = saved(await tool(auth.token, TOOL, args));
    const createdId = first.candidates[0].item_id;

    // 保存記録が古くなっても（間に多くの保存が挟まっても）、件数では切らずに見つける。
    const insertAudit = database.prepare(
      "INSERT INTO agent_audit_log (token_id, user_id, action, meta) VALUES (?, ?, 'comparison_candidates.save', ?)",
    );
    for (let index = 0; index < 250; index += 1) {
      insertAudit.run(auth.record.id, owner.id, JSON.stringify({ request_fingerprint: `other-${index}`, group_id: 1, results: [] }));
    }
    insertAudit.run(auth.record.id, owner.id, 'not json');

    // 利用者がグループ名を変え、別の商品を足したあとの再送: 何も書かず、今の名前で返す。
    database.prepare('UPDATE comparison_groups SET name = ? WHERE id = ?').run('改名した比較', first.group.id);
    insertItem(database, owner.id, 'あとから足した商品', 'https://example.com/products/history-extra', { group: first.group.id });
    const edited = snapshot(database, owner.id);
    const replay = saved(await tool(auth.token, TOOL, args));
    assert.equal(replay.status, 'already_saved');
    assert.equal(replay.replayed, true);
    assert.deepEqual(
      { id: replay.group.id, name: replay.group.name, item_count: replay.group.item_count },
      { id: first.group.id, name: '改名した比較', item_count: 3 },
    );
    assert.deepEqual(replay.item_ids, first.item_ids);
    assert.deepEqual(snapshot(database, owner.id), edited);

    // 利用者が両方をグループから外したあとで、遅れて届いた同じ要求: 2つ目のグループを作らない。
    for (const itemId of first.item_ids) {
      const removed = await tool(auth.token, 'update_item', { item_id: itemId, comparison_group_id: null });
      assert.equal(removed.result?.isError, false, JSON.stringify(removed));
    }
    const ungrouped = snapshot(database, owner.id);
    const rateBefore = await rateUsed(auth.record.id);
    const fetchedBefore = fetched.length;
    const reordered = { name: ' 履歴の比較 ', candidates: [{ item_id: existingId }, { url: `${PITAKA_URL}?utm_source=retry` }] };
    for (const retry of [args, reordered]) {
      const diverged = failure(await tool(auth.token, TOOL, retry));
      assert.equal(diverged.code, 'SAVED_REQUEST_CHANGED', diverged.text);
      assert.match(diverged.text, /何も保存・変更していません/);
      assert.deepEqual(snapshot(database, owner.id), ungrouped, '手作業の変更を巻き戻さない');
    }
    assert.equal(fetched.length, fetchedBefore);
    assert.deepEqual(await rateUsed(auth.record.id), rateBefore);
    assert.equal(
      auditRows(database, auth.record.id).filter((row) => row.meta.includes(`"group_id":${first.group.id},`)).length,
      1,
      '成功の記録は最初の1件だけ',
    );

    // 記録した品目が消され、同じ URL が別の行として同じグループに入り直していても、別の ID を
    // 最初の保存の結果として返さない。
    database.prepare('UPDATE items SET comparison_group_id = ? WHERE id = ?').run(first.group.id, existingId);
    database.prepare('DELETE FROM price_history WHERE item_id = ?').run(createdId);
    database.prepare('DELETE FROM items WHERE id = ?').run(createdId);
    const replacementId = insertItem(database, owner.id, '入れ直した商品', PITAKA_URL, { group: first.group.id });
    assert.notEqual(replacementId, createdId);
    const replaced = snapshot(database, owner.id);
    const stale = failure(await tool(auth.token, TOOL, args));
    assert.equal(stale.code, 'SAVED_REQUEST_CHANGED', stale.text);
    assert.deepEqual(snapshot(database, owner.id), replaced);
  });
}));

test('外部取得の最中に既存の候補が別グループへ移った・外れた・別の行に替わったら、書き先を変えずに 409', () => serial(async () => {
  const owner = await createMember('cc-moved');
  const database = await db();
  const NAME = '取得中に変わる比較';

  type Scenario = { label: string; setup: () => { candidates: unknown[]; mutate: () => void } };
  const scenarios: Scenario[] = [
    {
      label: '同じ名前の別グループへ移った',
      setup: () => {
        const groupA = insertGroup(database, owner.id, NAME);
        const groupB = insertGroup(database, owner.id, NAME);
        const itemId = insertItem(database, owner.id, '移る商品', 'https://example.com/products/moved-1', { group: groupA });
        return {
          candidates: [{ item_id: itemId }, { url: PITAKA_URL }],
          mutate: () => { database.prepare('UPDATE items SET comparison_group_id = ? WHERE id = ?').run(groupB, itemId); },
        };
      },
    },
    {
      label: 'グループから外れた',
      setup: () => {
        const groupA = insertGroup(database, owner.id, NAME);
        const itemId = insertItem(database, owner.id, '外れる商品', 'https://example.com/products/moved-2', { group: groupA });
        return {
          candidates: [{ item_id: itemId }, { url: PITAKA_URL }],
          mutate: () => { database.prepare('UPDATE items SET comparison_group_id = NULL WHERE id = ?').run(itemId); },
        };
      },
    },
    {
      label: 'グループなしの候補が別のグループへ入った',
      setup: () => {
        const groupB = insertGroup(database, owner.id, NAME);
        const itemId = insertItem(database, owner.id, '入る商品', 'https://example.com/products/moved-3');
        return {
          candidates: [{ item_id: itemId }, { url: PITAKA_URL }],
          mutate: () => { database.prepare('UPDATE items SET comparison_group_id = ? WHERE id = ?').run(groupB, itemId); },
        };
      },
    },
    {
      label: 'URL の候補が別の行に替わった',
      setup: () => {
        const url = 'https://example.com/products/moved-4';
        const itemId = insertItem(database, owner.id, '替わる商品', url);
        return {
          candidates: [{ url }, { url: PITAKA_URL }],
          mutate: () => {
            database.prepare('DELETE FROM items WHERE id = ?').run(itemId);
            insertItem(database, owner.id, '替わったあとの商品', url);
          },
        };
      },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    await setTestUser(owner);
    const auth = await createToken(['read', 'write'], `cc-moved-${index}`);
    const { candidates, mutate } = scenario.setup();
    let afterMutation: ReturnType<typeof snapshot> | null = null;
    const { fetched, port } = recordingPort(() => {
      if (afterMutation) return;
      mutate();
      afterMutation = snapshot(database, owner.id);
    });
    await withPort(port, async () => {
      const failed = failure(await tool(auth.token, TOOL, { name: NAME, candidates }));
      assert.equal(failed.code, 'CANDIDATES_CHANGED', `${scenario.label}: ${failed.text}`);
      assert.match(failed.text, /何も保存・変更していません/);
      assert.ok(fetched.length > 0, `${scenario.label}: 取得まで進んでいる`);
      assert.deepEqual(snapshot(database, owner.id), afterMutation, `${scenario.label}: 何も書かない`);
      assert.equal(auditRows(database, auth.record.id).length, 0);
      // 取得を始める前に消費した上限は、このあとの失敗では戻らない。
      assert.deepEqual(await rateUsed(auth.record.id), { add: 1, add_url: 1, add_day: 1 });
    });
  }
  assert.equal(
    (database.prepare('SELECT COUNT(*) AS count FROM items WHERE user_id = ? AND url = ?').get(owner.id, PITAKA_URL) as { count: number }).count,
    0,
    '取得できた側だけを登録しない',
  );
}));

test('同じ URL の登録が複数ある候補は、行を勝手に選ばず item_id の指定を求める', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-ambiguous');
    const auth = await createToken(['read', 'write'], 'cc-ambiguous');
    const database = await db();
    const groupA = insertGroup(database, owner.id, '重複Aの比較');
    const dupUrl = 'https://shop.example/item';
    const dupA = insertItem(database, owner.id, '重複A', `${dupUrl}?utm_source=old`, { group: groupA });
    const dupB = insertItem(database, owner.id, '重複B', dupUrl);
    const boughtUrl = 'https://shop.example/bought';
    const live = insertItem(database, owner.id, '買い直し候補', boughtUrl);
    const bought = insertItem(database, owner.id, '購入済みの同じURL', `${boughtUrl}?utm_medium=mail`, { purchased: true });
    const trashUrl = 'https://shop.example/once-trashed';
    insertItem(database, owner.id, 'ゴミ箱の同じURL', `${trashUrl}?utm_source=old`, { deleted: true });
    const liveWithTrash = insertItem(database, owner.id, '生きている側', trashUrl);
    const other = insertItem(database, owner.id, '別の商品', 'https://shop.example/other');
    const frozen = snapshot(database, owner.id);

    const cases: { candidates: unknown[]; ids: number[]; position: RegExp }[] = [
      // リスト上に2行（片方は比較グループ所属）
      { candidates: [{ url: dupUrl }, { item_id: other }], ids: [dupA, dupB], position: /候補1/ },
      // 重複の片方を item_id で、もう片方を URL で指した混在
      { candidates: [{ item_id: dupA }, { url: `${dupUrl}?utm_campaign=x` }], ids: [dupA, dupB], position: /候補2/ },
      // リスト上の行と購入済みの行
      { candidates: [{ item_id: other }, { url: boughtUrl }], ids: [live, bought], position: /候補2/ },
    ];
    for (const entry of cases) {
      const refused = failure(await tool(auth.token, TOOL, { name: '重複Aの比較', candidates: entry.candidates }));
      assert.equal(refused.code, 'URL_AMBIGUOUS', refused.text);
      assert.match(refused.text, entry.position);
      assert.match(refused.text, /item_id/);
      for (const id of entry.ids) assert.ok(refused.text.includes(String(id)), `${id} を案内する: ${refused.text}`);
      assert.deepEqual(snapshot(database, owner.id), frozen);
    }
    assert.deepEqual(fetched, []);
    assert.deepEqual(await rateUsed(auth.record.id), { add: 0, add_url: 0, add_day: 0 });

    // item_id で1件を指定すれば保存できる。もう一方の重複行には触らない。
    const explicit = saved(await tool(auth.token, TOOL, {
      name: '重複Aの比較', candidates: [{ item_id: dupA }, { item_id: other }],
    }));
    assert.equal(explicit.group.id, groupA);
    assert.deepEqual(explicit.candidates.map((entry) => entry.result), ['already_in_group', 'added_to_group']);
    assert.equal(
      (database.prepare('SELECT comparison_group_id FROM items WHERE id = ?').get(dupB) as { comparison_group_id: number | null }).comparison_group_id,
      null,
    );

    // 生きている行が1件だけ（もう1件はゴミ箱）なら、これまでどおりその行を使う。
    const single = saved(await tool(auth.token, TOOL, {
      name: 'ゴミ箱と重なる比較', candidates: [{ url: trashUrl }, { item_id: live }],
    }));
    assert.deepEqual(single.item_ids, [liveWithTrash, live]);
  });
}));

test('write だけのトークンには、ID と操作の結果だけを返す（保存・再送・拒否のどれでも）', () => serial(async () => {
  const { port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-receipt');
    const write = await createToken(['write'], 'cc-receipt-write');
    const database = await db();
    const SECRET_GROUP = 'ないしょのグループ名';
    const first = insertItem(database, owner.id, 'ないしょの商品名1', 'https://example.com/products/hidden-path-1', { price: 987654, notes: 'ないしょのメモ' });
    const second = insertItem(database, owner.id, 'ないしょの商品名2', 'https://example.com/products/hidden-path-2', { price: 876543 });
    const hidden = ['ないしょ', 'hidden-path', '987654', '876543', PITAKA_NAME, String(PITAKA_PRICE)];
    const assertNothingLeaks = (body: McpResponse, label: string) => {
      const text = JSON.stringify(body);
      for (const value of hidden) assert.equal(text.includes(value), false, `${label}: ${value} を返さない`);
    };
    const assertReceiptShape = (result: Saved) => {
      assert.deepEqual(Object.keys(result.group).sort(), ['created', 'id', 'origin']);
      for (const entry of result.candidates) {
        assert.deepEqual(Object.keys(entry).sort(), ['item_id', 'position', 'result']);
      }
    };

    // 登録済み2件 + 新規 URL 1件を保存。
    const args = { name: '受領だけの比較', candidates: [{ item_id: first }, { item_id: second }, { url: PITAKA_URL }] };
    const body = await tool(write.token, TOOL, args);
    const result = saved(body);
    assert.equal(result.status, 'saved');
    assertReceiptShape(result);
    assert.deepEqual(result.candidates.map((entry) => [entry.position, entry.result]), [
      [1, 'added_to_group'], [2, 'added_to_group'], [3, 'created'],
    ]);
    assert.deepEqual(result.item_ids.slice(0, 2), [first, second]);
    assert.match(result.message, /read 権限が無い/);
    assertNothingLeaks(body, '保存');

    // 利用者がグループ名を変えたあとの再送: 変更後の名前も、保存済みの取得結果も返さない。
    database.prepare('UPDATE comparison_groups SET name = ? WHERE id = ?').run(SECRET_GROUP, result.group.id);
    database.prepare("UPDATE items SET current_price = NULL, image_url = NULL, scrape_status = 'failed', scrape_error = 'hidden-path-error' WHERE id = ?")
      .run(result.item_ids[2]);
    const replayBody = await tool(write.token, TOOL, args);
    const replay = saved(replayBody);
    assert.equal(replay.status, 'already_saved');
    assert.equal(replay.replayed, true);
    assertReceiptShape(replay);
    assert.deepEqual(replay.item_ids, result.item_ids);
    assert.deepEqual(replay.media_fetch_errors, []);
    assert.deepEqual(replay.replay_of?.candidates.map((entry) => Object.keys(entry).sort()), [
      ['item_id', 'position', 'result'], ['item_id', 'position', 'result'], ['item_id', 'position', 'result'],
    ]);
    assertNothingLeaks(replayBody, '再送');

    // 保存記録の無い「変更なし」（別の組）でも同じ。
    database.prepare('UPDATE comparison_groups SET name = ? WHERE id = ?').run('受領だけの比較', result.group.id);
    const unchangedBody = await tool(write.token, TOOL, { name: '受領だけの比較', candidates: [{ item_id: second }, { item_id: first }] });
    const unchanged = saved(unchangedBody);
    assert.equal(unchanged.replayed, false);
    assert.equal(unchanged.changed, false);
    assertReceiptShape(unchanged);
    assertNothingLeaks(unchangedBody, '変更なし');

    // 拒否の文面にも、既存のグループ名や商品名を出さない。
    database.prepare('UPDATE comparison_groups SET name = ? WHERE id = ?').run(SECRET_GROUP, result.group.id);
    const otherGroup = insertGroup(database, owner.id, 'ないしょの別グループ');
    const elsewhere = insertItem(database, owner.id, 'ないしょの商品名3', 'https://example.com/products/hidden-path-3', { group: otherGroup });
    const photoGroup = insertGroup(database, owner.id, 'ないしょの店舗比較', 'photo');
    const storeRow = insertItem(database, owner.id, 'ないしょの店の行', 'https://example.com/products/hidden-path-4', { group: photoGroup });
    const free = insertItem(database, owner.id, 'ないしょの商品名5', 'https://example.com/products/hidden-path-5');
    const refusals: [unknown[], string][] = [
      [[{ item_id: first }, { item_id: free }], 'CANDIDATE_IN_OTHER_GROUP'],
      [[{ item_id: first }, { item_id: elsewhere }], 'CANDIDATES_IN_DIFFERENT_GROUPS'],
      [[{ item_id: free }, { item_id: storeRow }], 'ITEM_IN_STORE_GROUP'],
    ];
    for (const [candidates, code] of refusals) {
      const refusedBody = await tool(write.token, TOOL, { name: '拒否の比較', candidates });
      assert.equal(failure(refusedBody).code, code, JSON.stringify(refusedBody));
      assertNothingLeaks(refusedBody, code);
    }
    database.prepare('UPDATE items SET comparison_group_id = NULL WHERE id = ?').run(first);
    const divergedBody = await tool(write.token, TOOL, args);
    assert.equal(failure(divergedBody).code, 'SAVED_REQUEST_CHANGED');
    assertNothingLeaks(divergedBody, '保存後の変更');

    // read もあるトークンには、これまでどおり名前・URL・価格・件数を返す。
    await setTestUser(owner);
    const both = await createToken(['read', 'write'], 'cc-receipt-both');
    const full = saved(await tool(both.token, TOOL, { name: SECRET_GROUP, candidates: [{ item_id: second }, { item_id: free }] }));
    assert.equal(full.group.name, SECRET_GROUP);
    assert.equal(full.group.item_count, 3);
    assert.deepEqual(full.candidates[0], {
      position: 1, item_id: second, result: 'already_in_group',
      name: 'ないしょの商品名2', url: 'https://example.com/products/hidden-path-2', current_price: 876543,
    });
    assert.doesNotMatch(full.message, /read 権限が無い/);
  });
}));

test('従来の登録はそのまま: 単品は独立した商品、同じ商品の複数店舗は1商品、別々の指定は独立2件', () => serial(async () => {
  const { port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('cc-legacy');
    const auth = await createToken(['read', 'write'], 'cc-legacy');
    const database = await db();

    // 「このモニターと、それに使うケーブルを入れて」「今回は別々に入れて」: 1商品ずつ登録すると独立2件。
    const single = [];
    for (const url of [PITAKA_URL, AMAZON_PRODUCT_URL]) {
      const added = await tool(auth.token, 'add_item_by_url', { url });
      assert.equal(added.result?.isError, false, JSON.stringify(added));
      single.push((added.result!.structuredContent!.data as { item: { id: number; comparison_group_id: number | null } }).item);
    }
    assert.notEqual(single[0].id, single[1].id);
    assert.deepEqual(single.map((item) => item.comparison_group_id), [null, null]);
    assert.equal(snapshot(database, owner.id).groups.length, 0);

    // 「公式と量販店の両方を残して」: 同じ商品の店舗比較は、1商品（photo グループ）に店が2つ。
    const stores = await tool(auth.token, 'add_item_by_url', {
      urls: [RAKUTEN_URL, 'https://example.com/products/same-product-other-store'],
      name: '同じ型番の商品',
    });
    assert.equal(stores.result?.isError, false, JSON.stringify(stores));
    const product = stores.result!.structuredContent!.data as {
      item: { comparison_group_id: number; name: string };
      stores: { item_id: number }[];
    };
    assert.equal(product.stores.length, 2);
    const groups = snapshot(database, owner.id).groups as { id: number; origin: string | null }[];
    assert.deepEqual(groups.map((group) => [group.id, group.origin]), [[product.item.comparison_group_id, 'photo']]);

    // 手作業比較グループを作って update_item で入れる従来の手順も使える。
    const created = await tool(auth.token, 'create_comparison_group', { name: '従来の手順' });
    const groupId = (created.result!.structuredContent!.data as { group: { id: number } }).group.id;
    const moved = await tool(auth.token, 'update_item', { item_id: single[0].id, comparison_group_id: groupId });
    assert.equal(moved.result?.isError, false, JSON.stringify(moved));
  });
}));

test('同じ要求の判定は、候補の順序と URL の計測パラメータに依らない', async () => {
  const { comparisonCandidatesFingerprint, parseComparisonCandidatesInput } = await import('../src/lib/agent-comparison-candidates');
  const candidate = fc.oneof(
    fc.integer({ min: 1, max: 5000 }).map((id) => ({ item_id: id } as Record<string, unknown>)),
    fc.integer({ min: 1, max: 5000 }).map((id) => ({ url: `https://shop.example/products/${id}` } as Record<string, unknown>)),
  );
  const candidates = fc.uniqueArray(candidate, { minLength: 2, maxLength: 10, selector: (entry) => JSON.stringify(entry) });
  fc.assert(fc.property(candidates, fc.nat(), (list, seed) => {
    const shuffled = list
      .map((entry, index) => ({ entry, key: (index * 7919 + seed) % 104729 }))
      .sort((a, b) => a.key - b.key)
      .map(({ entry }) => (typeof entry.url === 'string' ? { url: `${entry.url}?utm_source=retry${seed}` } : entry));
    const base = comparisonCandidatesFingerprint(parseComparisonCandidatesInput({ name: '比較', candidates: list }));
    assert.equal(comparisonCandidatesFingerprint(parseComparisonCandidatesInput({ name: ' 比較 ', candidates: shuffled })), base);
    assert.notEqual(comparisonCandidatesFingerprint(parseComparisonCandidatesInput({ name: '別の比較', candidates: list })), base);
  }), { seed: 20261110, numRuns: 60 });
});
