/**
 * #396: エージェントが商品メモ（notes）を登録・読取・編集し、
 * 登録結果の tell_user をユーザーへそのまま伝えること。
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
  RAKUTEN_URL,
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
  action: string;
  saved: boolean;
  text: string | null;
  tell_user: { ja: string; en: string };
  relay: boolean;
  ask_edit: { ja: string; en: string };
  agent_instructions: { ja: string; en: string };
};

type McpResponse = {
  result?: {
    isError?: boolean;
    content?: { type: string; text: string }[];
    structuredContent?: { data: Record<string, unknown>; notice?: unknown };
    tools?: {
      name: string;
      description: string;
      inputSchema: {
        required?: string[];
        properties?: Record<string, { description?: string; maxLength?: number; type?: unknown }>;
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

test('buildMemoFollowUp: メモあり・付け忘れ・拒否・クリアの tell_user', async () => {
  const {
    buildMemoFollowUp,
    buildAddedTellUser,
    buildNoMemoTellUser,
  } = await import('../src/lib/agent-memo');

  const withText = buildMemoFollowUp('公式が安い。A社と比較', { kind: 'add' });
  assert.equal(withText.action, 'added');
  assert.equal(withText.relay, true);
  assert.deepEqual(withText.tell_user, buildAddedTellUser('公式が安い。A社と比較'));
  assert.match(withText.tell_user.ja, /^以下のメモを追加しました：公式が安い。A社と比較。編集・削除したい場合は教えてね$/);

  const omitted = buildMemoFollowUp(null, { kind: 'add' });
  assert.equal(omitted.action, 'omitted');
  assert.equal(omitted.relay, false);
  assert.deepEqual(omitted.tell_user, buildNoMemoTellUser());
  assert.match(omitted.agent_instructions.ja, /update_item/);
  assert.match(omitted.agent_instructions.ja, /必ずメモ/);

  const declined = buildMemoFollowUp(null, { kind: 'add', requestedNotes: null });
  assert.equal(declined.action, 'declined');
  assert.equal(declined.relay, true);
  assert.deepEqual(declined.tell_user, buildNoMemoTellUser());

  const cleared = buildMemoFollowUp(null, { kind: 'update' });
  assert.equal(cleared.action, 'cleared');
  assert.equal(cleared.relay, true);
  assert.match(cleared.tell_user.ja, /メモを消しました/);

  const restored = buildMemoFollowUp('古いメモ', {
    kind: 'restore',
    requestedNotes: '無視されるメモ',
  });
  assert.equal(restored.action, 'restored');
  assert.equal(restored.relay, true);
  assert.match(restored.tell_user.ja, /ゴミ箱から復元/);
  assert.doesNotMatch(restored.tell_user.ja, /以下のメモを追加しました/);
  assert.match(restored.agent_instructions.ja, /適用されていません/);

  const storeAttached = buildMemoFollowUp('既存メモ', {
    kind: 'store_attach',
    requestedNotes: '上書きしようとするメモ',
  });
  assert.equal(storeAttached.action, 'store_attached');
  assert.equal(storeAttached.relay, true);
  assert.match(storeAttached.tell_user.ja, /店舗ページを追加しました/);
  assert.doesNotMatch(storeAttached.tell_user.ja, /以下のメモを追加しました/);
  assert.match(storeAttached.agent_instructions.ja, /店追加/);
});

test('案内: initialize・ツール説明・llms.txt が「既定は必ずメモ」と tell_user リレーを伝える (#396)', () => serial(async () => {
  await createMember('memo-guidance');
  const both = await createToken(['read', 'write'], 'memo-guidance-both');

  const init = await rpc(both.token, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  const instructions = init.result!.instructions ?? '';
  assert.match(instructions, /DEFAULT \(strong\): ALWAYS write a short conversation summary/i);
  assert.match(instructions, /DEFAULT（強い既定）/);
  assert.match(instructions, /必ず（ALWAYS）/);
  assert.match(instructions, /memo\.tell_user/);
  assert.match(instructions, /以下のメモを追加しました/);
  assert.match(instructions, /メモは付けていません/);
  assert.match(instructions, /explicitly decline|メモ不要/);

  const tools = (await rpc(both.token, 'tools/list')).result!.tools!;
  const addByUrl = tools.find((entry) => entry.name === 'add_item_by_url');
  const update = tools.find((entry) => entry.name === 'update_item');
  assert.ok(addByUrl && update);
  assert.equal((addByUrl.inputSchema.required ?? []).includes('notes'), false, 'notes は必須にしない');
  assert.match(addByUrl.description, /DEFAULT は ALWAYS/);
  assert.match(addByUrl.description, /memo\.tell_user/);
  assert.match(addByUrl.description, /メモは付けていません/);
  assert.match(update.description, /空文字または null でメモを消せる/);

  const notesProp = addByUrl.inputSchema.properties?.notes;
  assert.ok(notesProp);
  assert.equal(notesProp.maxLength, 2000);
  assert.match(notesProp.description ?? '', /DEFAULT は ALWAYS 入れる/);

  const llms = readFileSync(path.join(process.cwd(), 'public/llms.txt'), 'utf8');
  assert.match(llms, /DEFAULT is: ALWAYS|強い既定|tell_user/);
  assert.match(llms, /以下のメモを追加しました/);
  assert.match(llms, /メモは付けていません/);
}));

test('MCP/REST: notes 保存・tell_user・クリア・他人拒否・付け忘れ案内 (#396)', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const { AGENT_NOTES_MAX } = await import('../src/lib/agent-items');
  const { buildAddedTellUser, buildNoMemoTellUser } = await import('../src/lib/agent-memo');
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
    assert.equal(addData.memo.relay, true);
    assert.deepEqual(addData.memo.tell_user, buildAddedTellUser(memoText));
    const contentText = added.result!.content?.[0]?.text ?? '';
    assert.ok(contentText.startsWith(buildAddedTellUser(memoText).ja), contentText.slice(0, 120));
    const itemId = addData.item.id;

    const got = await tool(both.token, 'get_item', { item_id: itemId });
    assert.equal(got.result?.isError, false, JSON.stringify(got));
    const gotItem = got.result!.structuredContent!.data as { notes?: string | null };
    assert.equal(gotItem.notes, memoText);

    const listed = await tool(both.token, 'list_items', { status: 'active', q: 'デスク' });
    const listData = listed.result!.structuredContent!.data as { items: { id: number; notes: string | null }[] };
    assert.ok(listData.items.some((row) => row.id === itemId && row.notes === memoText));

    const editedText = `${memoText}／色は黒がいい`;
    const patched = await tool(both.token, 'update_item', { item_id: itemId, notes: editedText });
    const patchData = patched.result!.structuredContent!.data as { notes: string | null; memo: MemoFollowUp };
    assert.equal(patchData.notes, editedText);
    assert.equal(patchData.memo.action, 'updated');
    assert.match(patchData.memo.tell_user.ja, /以下のメモに更新しました：/);

    // クリア（空文字）
    const cleared = await tool(both.token, 'update_item', { item_id: itemId, notes: '' });
    const clearedData = cleared.result!.structuredContent!.data as { notes: string | null; memo: MemoFollowUp };
    assert.equal(clearedData.notes, null);
    assert.equal(clearedData.memo.action, 'cleared');
    assert.match(clearedData.memo.tell_user.ja, /メモを消しました/);
    assert.ok((cleared.result!.content?.[0]?.text ?? '').startsWith('メモを消しました'));

    // null でもクリア
    await tool(both.token, 'update_item', { item_id: itemId, notes: '一時メモ' });
    const clearedNull = await tool(both.token, 'update_item', { item_id: itemId, notes: null as unknown as string });
    assert.equal((clearedNull.result!.structuredContent!.data as { notes: string | null }).notes, null);

    // 付け忘れ（notes キー無し）→ 登録は成功、tell_user あり、relay=false。text 先頭はエージェント向け案内（no-memo 文は出さない）
    const omitted = await tool(both.token, 'add_item', { name: 'メモ無し手動' });
    assert.equal(omitted.result?.isError, false, JSON.stringify(omitted));
    const omittedData = omitted.result!.structuredContent!.data as {
      item: { notes: string | null };
      memo: MemoFollowUp;
    };
    assert.equal(omittedData.item.notes, null);
    assert.equal(omittedData.memo.action, 'omitted');
    assert.equal(omittedData.memo.relay, false);
    assert.deepEqual(omittedData.memo.tell_user, buildNoMemoTellUser());
    assert.match(omittedData.memo.agent_instructions.ja, /update_item/);
    const omittedText = omitted.result!.content?.[0]?.text ?? '';
    assert.ok(omittedText.startsWith('【エージェント向け】'), omittedText.slice(0, 120));
    assert.match(omittedText, /update_item/);
    assert.doesNotMatch(omittedText.slice(0, omittedText.indexOf('{')), /メモは付けていません/);

    // 明示的に空＝拒否扱い
    const declined = await tool(both.token, 'add_item', { name: '拒否メモ', notes: null as unknown as string });
    const declinedData = declined.result!.structuredContent!.data as { memo: MemoFollowUp };
    assert.equal(declinedData.memo.action, 'declined');
    assert.equal(declinedData.memo.relay, true);
    assert.deepEqual(declinedData.memo.tell_user, buildNoMemoTellUser());

    // 長すぎるメモは 400
    const tooLong = await tool(both.token, 'update_item', {
      item_id: itemId,
      notes: 'あ'.repeat(AGENT_NOTES_MAX + 1),
    });
    assert.equal(tooLong.result?.isError, true);

    // REST でも tell_user
    const restAdd = await call(itemsPath, 'POST', '/api/agent/v1/items', {
      name: 'メモ付き手動',
      notes: 'ケーブルも一緒に買う',
    }, undefined, bearer(both.token));
    assert.equal(restAdd.status, 201, restAdd.text);
    const restBody = restAdd.json as {
      data: { item: { notes: string | null }; memo: MemoFollowUp };
    };
    assert.deepEqual(restBody.data.memo.tell_user, buildAddedTellUser('ケーブルも一緒に買う'));

    // 他人の品目は触れない
    await createMember('memo-stranger');
    const stranger = await createToken(['read', 'write'], 'memo-stranger');
    const foreign = await tool(stranger.token, 'update_item', {
      item_id: itemId,
      notes: '盗むメモ',
    });
    assert.equal(foreign.result?.isError, true);
    const still = await call(
      itemIdPath,
      'GET',
      `/api/agent/v1/items/${itemId}`,
      undefined,
      { id: String(itemId) },
      bearer(both.token),
    );
    assert.equal(still.status, 200, still.text);
    assert.equal((still.json as { data: { notes: string | null } }).data.notes, null);
  } finally {
    installProductFetchPort(null);
  }
}));

test('MCP: ゴミ箱復元では「メモを追加しました」と言わず tell_user は復元文面 (#396 Bugbot)', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('memo-restore');
    const token = await createToken(['read', 'write'], 'memo-restore');

    const first = await tool(token.token, 'add_item_by_url', {
      url: AMAZON_PRODUCT_URL,
      notes: '復元前のメモ',
    });
    const itemId = (first.result!.structuredContent!.data as { item: { id: number } }).item.id;
    await tool(token.token, 'trash_item', { item_id: itemId });

    const restored = await tool(token.token, 'add_item_by_url', {
      url: AMAZON_PRODUCT_URL,
      notes: '復元では無視される',
    });
    assert.equal(restored.result?.isError, false, JSON.stringify(restored));
    const data = restored.result!.structuredContent!.data as {
      restored_from_trash?: boolean;
      item: { id: number; notes: string | null };
      memo: MemoFollowUp;
    };
    assert.equal(data.restored_from_trash, true);
    assert.equal(data.item.id, itemId);
    assert.equal(data.item.notes, '復元前のメモ');
    assert.equal(data.memo.action, 'restored');
    assert.equal(data.memo.relay, true);
    assert.match(data.memo.tell_user.ja, /ゴミ箱から復元/);
    assert.doesNotMatch(data.memo.tell_user.ja, /以下のメモを追加しました/);
    assert.match(data.memo.agent_instructions.ja, /適用されていません/);
    assert.ok((restored.result!.content?.[0]?.text ?? '').startsWith('ゴミ箱から復元'));
  } finally {
    installProductFetchPort(null);
  }
}));

test('MCP: 店追加では既存メモを上書きせず「メモを追加しました」と言わない (#396 Bugbot)', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('memo-attach');
    const token = await createToken(['read', 'write'], 'memo-attach');

    const first = await tool(token.token, 'add_item_by_url', {
      url: AMAZON_PRODUCT_URL,
      notes: '既存の大事なメモ',
    });
    const itemId = (first.result!.structuredContent!.data as { item: { id: number } }).item.id;

    const attached = await tool(token.token, 'add_item_by_url', {
      item_id: itemId,
      url: RAKUTEN_URL,
      notes: 'DEFAULTで送ってしまう上書きメモ',
    });
    assert.equal(attached.result?.isError, false, JSON.stringify(attached));
    const data = attached.result!.structuredContent!.data as {
      store_attached?: boolean;
      item: { notes: string | null };
      stores: unknown[];
      memo: MemoFollowUp;
    };
    assert.equal(data.store_attached, true);
    assert.ok(data.stores.length >= 2);
    assert.equal(data.item.notes, '既存の大事なメモ');
    assert.equal(data.memo.action, 'store_attached');
    assert.equal(data.memo.relay, true);
    assert.equal(data.memo.text, '既存の大事なメモ');
    assert.match(data.memo.tell_user.ja, /店舗ページを追加しました/);
    assert.doesNotMatch(data.memo.tell_user.ja, /以下のメモを追加しました/);
    assert.match(data.memo.agent_instructions.ja, /適用されていません/);
    assert.ok((attached.result!.content?.[0]?.text ?? '').startsWith('店舗ページを追加しました'));

    const got = await tool(token.token, 'get_item', { item_id: itemId });
    const gotItem = got.result!.structuredContent!.data as { notes?: string | null };
    assert.equal(gotItem.notes, '既存の大事なメモ');
  } finally {
    installProductFetchPort(null);
  }
}));

test('REST by-url: notes 無しでも登録成功し tell_user が付く (#396)', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const { buildNoMemoTellUser } = await import('../src/lib/agent-memo');
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
    assert.equal(body.data.memo.action, 'omitted');
    assert.equal(body.data.memo.relay, false);
    assert.deepEqual(body.data.memo.tell_user, buildNoMemoTellUser());
  } finally {
    installProductFetchPort(null);
  }
}));
