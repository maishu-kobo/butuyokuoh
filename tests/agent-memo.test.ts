/**
 * #396: エージェントが商品メモ（notes）を登録・読取・編集し、
 * 登録結果でユーザーへ事後報告するよう誘導されること。
 */
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, mock, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import {
  AMAZON_NAME,
  AMAZON_PRODUCT_URL,
  regressionFetchPort,
} from '../src/lib/product-regression-fixtures';
import { installFrozenClock } from './trash-restore-clock';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const itemsPath = '../src/app/api/agent/v1/items/route.ts';
const byUrlPath = '../src/app/api/agent/v1/items/by-url/route.ts';
const itemIdPath = '../src/app/api/agent/v1/items/[id]/route.ts';
const mcpPath = '../src/app/api/mcp/route.ts';
const sameOrigin = { origin: 'http://localhost' } as const;

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

async function createToken(scopes: ('read' | 'write')[] = ['read', 'write'], name = 'memo') {
  const created = await call(
    tokensPath,
    'POST',
    '/api/agent-tokens',
    { name, scopes, expiresInDays: 90 },
    undefined,
    sameOrigin,
    'http://localhost/api/agent-tokens',
  );
  assert.equal(created.status, 201, created.text);
  return created.json as { token: string; record: { id: number } };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

type MemoFollowUp = {
  field: 'notes';
  saved: boolean;
  text: string | null;
  tell_user: { ja: string; en: string };
  ask_edit: { ja: string; en: string };
  agent_instructions: { ja: string; en: string };
};

function assertMemoReport(memo: MemoFollowUp, expectedText: string) {
  assert.equal(memo.field, 'notes');
  assert.equal(memo.saved, true);
  assert.equal(memo.text, expectedText);
  assert.match(memo.tell_user.ja, /以下のメモを追加しました/);
  assert.match(memo.ask_edit.ja, /追加や修正/);
  assert.match(memo.agent_instructions.ja, /登録の前にメモの確認は取らない/);
  assert.match(memo.agent_instructions.ja, /以下のメモを追加しました/);
  assert.match(memo.agent_instructions.en, /Do not ask for memo confirmation before registering/i);
}

type McpResponse = {
  result?: {
    isError?: boolean;
    content?: { type: string; text: string }[];
    structuredContent?: { data: Record<string, unknown> };
    tools?: {
      name: string;
      description: string;
      inputSchema: {
        properties?: Record<string, { description?: string; maxLength?: number }>;
      };
    }[];
    instructions?: string;
  };
  error?: { code: number; message: string };
};

let rpcId = 0;
async function rpc(token: string, method: string, params?: unknown): Promise<McpResponse> {
  const response = await call(mcpPath, 'POST', '/api/mcp', {
    jsonrpc: '2.0', id: ++rpcId, method, params,
  }, undefined, { ...bearer(token), Accept: 'application/json, text/event-stream' });
  assert.equal(response.status, 200, response.text);
  return response.json as McpResponse;
}

function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  return rpc(token, 'tools/call', { name, arguments: args });
}

test('buildMemoFollowUp: 登録成功時は報告文言と登録前確認の禁止を返す', async () => {
  const { buildMemoFollowUp } = await import('../src/lib/agent-memo');
  const withText = buildMemoFollowUp('公式が安い。A社と比較', 'add');
  assertMemoReport(withText, '公式が安い。A社と比較');

  const empty = buildMemoFollowUp(null, 'add');
  assert.equal(empty.saved, false);
  assert.equal(empty.text, null);
  assert.match(empty.agent_instructions.ja, /メモが空/);
  assert.match(empty.agent_instructions.ja, /登録の前に確認は挟まない/);
});

test('案内: initialize・ツール説明・llms.txt がメモ欄の使い方を伝える (#396)', () => serial(async () => {
  await createMember('memo-guidance');
  const both = await createToken(['read', 'write'], 'memo-guidance-both');

  const init = await rpc(both.token, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  const instructions = init.result!.instructions ?? '';
  assert.match(instructions, /memo field \(`notes`\)/i);
  assert.match(instructions, /Do not ask the user to confirm the memo before registering/);
  assert.match(instructions, /以下のメモを追加しました/);
  assert.match(instructions, /メモ欄（notes）/);
  assert.match(instructions, /登録の前にメモの確認は取らない/);

  const tools = (await rpc(both.token, 'tools/list')).result!.tools!;
  const addByUrl = tools.find((entry) => entry.name === 'add_item_by_url');
  const addItem = tools.find((entry) => entry.name === 'add_item');
  const update = tools.find((entry) => entry.name === 'update_item');
  const list = tools.find((entry) => entry.name === 'list_items');
  const get = tools.find((entry) => entry.name === 'get_item');
  assert.ok(addByUrl && addItem && update && list && get);

  assert.match(addByUrl.description, /notes/);
  assert.match(addByUrl.description, /登録の前にメモの確認は取らない/);
  assert.match(addByUrl.description, /以下のメモを追加しました/);
  assert.match(addItem.description, /notes/);
  assert.match(update.description, /notes/);
  assert.match(list.description, /notes/);
  assert.match(get.description, /notes/);

  const notesProp = addByUrl.inputSchema.properties?.notes;
  assert.ok(notesProp);
  assert.equal(notesProp.maxLength, 2000);
  assert.match(notesProp.description ?? '', /会話の短い要約/);
  assert.match(notesProp.description ?? '', /登録の前にユーザーへ確認しない/);

  const llms = readFileSync(path.join(process.cwd(), 'public/llms.txt'), 'utf8');
  assert.match(llms, /Product memo \(`notes`\)/);
  assert.match(llms, /以下のメモを追加しました/);
  assert.match(llms, /Do not.*confirm the memo before registering/i);
}));

test('MCP/REST: notes を追加で受け、読取で返し、編集でき、追加結果が報告を指示する (#396)', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const { AGENT_NOTES_MAX } = await import('../src/lib/agent-items');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('memo-owner');
    const both = await createToken(['read', 'write'], 'memo-both');
    const memoText = 'Amazon 3499円。公式と比較。デスクで使いたい';

    const added = await tool(both.token, 'add_item_by_url', {
      url: AMAZON_PRODUCT_URL,
      notes: memoText,
      priority: 2,
    });
    assert.equal(added.result?.isError, false, JSON.stringify(added));
    const addData = added.result!.structuredContent!.data as {
      item: { id: number; name: string; notes: string | null };
      memo: MemoFollowUp;
    };
    assert.equal(addData.item.name, AMAZON_NAME);
    assert.equal(addData.item.notes, memoText);
    assertMemoReport(addData.memo, memoText);
    // ツール結果の text にも報告ガイドが入る（エージェントが読む）
    const contentText = added.result!.content?.[0]?.text ?? '';
    assert.match(contentText, /以下のメモを追加しました/);
    assert.match(contentText, /登録の前にメモの確認は取らない/);
    const itemId = addData.item.id;

    const got = await tool(both.token, 'get_item', { item_id: itemId });
    assert.equal(got.result?.isError, false, JSON.stringify(got));
    const gotItem = (got.result!.structuredContent!.data as { item?: { notes: string | null }; notes?: string | null });
    // get_item は品目オブジェクトそのもの（withAgentNotice の data）
    const notes = gotItem.item?.notes ?? gotItem.notes;
    assert.equal(notes, memoText);

    const listed = await tool(both.token, 'list_items', { status: 'active', q: 'デスク' });
    assert.equal(listed.result?.isError, false, JSON.stringify(listed));
    const listData = listed.result!.structuredContent!.data as { items: { id: number; notes: string | null }[] };
    assert.ok(listData.items.some((row) => row.id === itemId && row.notes === memoText));

    const editedText = `${memoText}／色は黒がいい`;
    const patched = await tool(both.token, 'update_item', { item_id: itemId, notes: editedText });
    assert.equal(patched.result?.isError, false, JSON.stringify(patched));
    const patchData = patched.result!.structuredContent!.data as {
      notes: string | null;
      memo: MemoFollowUp;
    };
    assert.equal(patchData.notes, editedText);
    assert.equal(patchData.memo.saved, true);
    assert.equal(patchData.memo.text, editedText);
    assert.match(patchData.memo.tell_user.ja, /更新しました/);
    assert.match(patchData.memo.agent_instructions.ja, /メモを更新しました/);

    // 長すぎるメモは 400。制御文字は落ちる（既存サニタイズ）
    const tooLong = await tool(both.token, 'update_item', {
      item_id: itemId,
      notes: 'あ'.repeat(AGENT_NOTES_MAX + 1),
    });
    assert.equal(tooLong.result?.isError, true);
    assert.match(tooLong.result?.content?.[0]?.text ?? '', /文字以内/);

    // REST 経路でも memo が付く
    const restAdd = await call(itemsPath, 'POST', '/api/agent/v1/items', {
      name: 'メモ付き手動',
      notes: 'ケーブルも一緒に買う',
    }, undefined, bearer(both.token));
    assert.equal(restAdd.status, 201, restAdd.text);
    const restBody = restAdd.json as {
      data: { item: { id: number; notes: string | null }; memo: MemoFollowUp };
    };
    assert.equal(restBody.data.item.notes, 'ケーブルも一緒に買う');
    assertMemoReport(restBody.data.memo, 'ケーブルも一緒に買う');

    // 他人の品目のメモは触れない（所有者チェック）
    await createMember('memo-stranger');
    const stranger = await createToken(['read', 'write'], 'memo-stranger');
    const foreign = await tool(stranger.token, 'update_item', {
      item_id: itemId,
      notes: '盗むメモ',
    });
    assert.equal(foreign.result?.isError, true);
    // 所有者のメモは変わっていない
    const still = await call(
      itemIdPath,
      'GET',
      `/api/agent/v1/items/${itemId}`,
      undefined,
      { id: String(itemId) },
      bearer(both.token),
    );
    assert.equal(still.status, 200, still.text);
    assert.equal((still.json as { data: { notes: string } }).data.notes, editedText);
  } finally {
    installProductFetchPort(null);
  }
}));

test('REST by-url: notes 無しでも memo.saved=false で事後のメモ追加を案内する (#396)', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('memo-empty');
    const token = await createToken(['write'], 'memo-empty');
    const added = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: AMAZON_PRODUCT_URL,
    }, undefined, bearer(token.token));
    assert.equal(added.status, 201, added.text);
    const body = added.json as {
      data: { item: { notes: string | null }; memo: MemoFollowUp };
    };
    assert.equal(body.data.item.notes, null);
    assert.equal(body.data.memo.saved, false);
    assert.match(body.data.memo.agent_instructions.ja, /メモが空/);
    assert.match(body.data.memo.agent_instructions.ja, /update_item/);
  } finally {
    installProductFetchPort(null);
  }
}));
