// MCP tools/call add_item_by_url のゴミ箱復元（#364 / #365）。
// 所有者ごとの境界、保存データの保全、復元より優先する重複、複数店での部分更新なしを
// 実際の /api/mcp 経路で固定する。DB は一時ファイル、取得は fixture だけ。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { after, before, mock, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import {
  AMAZON_NAME,
  AMAZON_PRICE,
  AMAZON_PRODUCT_URL,
  EMPTY_URL,
  PITAKA_URL,
  regressionLookup,
} from '../src/lib/product-regression-fixtures';
import type { ProductFixture } from '../src/lib/product-regression-fixtures';
import { FIXED_NOW_SQLITE, installFrozenClock } from './trash-restore-clock';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const mcpPath = '../src/app/api/mcp/route.ts';

const sameOrigin = { origin: 'http://localhost' } as const;
const sameOriginUrl = 'http://localhost';

let releaseClock: (() => void) | null = null;
before(async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  // JS の Date とこの一時 DB の datetime('now') を同じ時刻に固定する（createMember より先）。
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

type Scope = 'read' | 'write' | 'extension';

/** 現在のテストユーザー（createMember 直後の会員）向けトークン。 */
async function createToken(scopes: Scope[], name: string) {
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

type McpToolResult = {
  isError: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: { data: Record<string, unknown> };
  _meta?: { code?: string; httpStatus?: number };
};

type McpResponse = {
  jsonrpc: string;
  id: number | string | null;
  result?: McpToolResult;
  error?: { code: number; message: string; data?: { httpStatus?: number; code?: string } };
};

let rpcId = 100;

async function mcpTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await call(mcpPath, 'POST', '/api/mcp', {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'tools/call',
    params: { name, arguments: args },
  }, undefined, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/event-stream',
  });
  return { status: response.status, text: response.text, body: response.json as McpResponse };
}

async function mcpAddByUrl(token: string, args: Record<string, unknown>) {
  return mcpTool(token, 'add_item_by_url', args);
}

async function mcpTrash(token: string, itemId: number) {
  const response = await mcpTool(token, 'trash_item', { item_id: itemId });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.result?.isError, false, response.text);
  return response.body;
}

type RestoreData = {
  item: {
    id: number;
    name: string;
    notes: string | null;
    deleted_at: string | null;
    current_price: number | null;
    quantity: number;
    priority: number;
    is_purchased: boolean;
    purchased_at: string | null;
    category_id: number | null;
    comparison_group_id: number | null;
    added_by_agent: boolean;
    added_by_agent_token_id: number | null;
  };
  stores: unknown[];
  media_fetched: boolean;
  media_fetch_errors: unknown[];
  restored_from_trash?: boolean;
  restore_message?: string;
};

function restoreData(body: McpResponse): RestoreData {
  assert.ok(body.result, 'tools/call must return a result');
  assert.equal(body.result.isError, false, JSON.stringify(body));
  assert.ok(body.result.structuredContent, JSON.stringify(body));
  return body.result.structuredContent.data as unknown as RestoreData;
}

/** fixture を使いながら、どの URL を取りに行ったかを記録する。 */
function recordingPort() {
  const fetched: string[] = [];
  return {
    fetched,
    port: {
      lookup: (url: URL): ProductFixture | undefined => {
        fetched.push(url.href);
        return regressionLookup(url);
      },
      timeoutMs: 400,
    },
  };
}

async function withPort<T>(port: { lookup: (url: URL) => ProductFixture | undefined; timeoutMs?: number }, run: () => Promise<T>): Promise<T> {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(port);
  try {
    return await run();
  } finally {
    installProductFetchPort(null);
  }
}

type ItemRow = Record<string, unknown> & { id: number; deleted_at: string | null };

function itemRow(database: Awaited<ReturnType<typeof db>>, id: number): ItemRow {
  const row = database.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  assert.ok(row, `item ${id} must exist`);
  return row;
}

function countItems(database: Awaited<ReturnType<typeof db>>, userId: number): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(userId) as { n: number }).n;
}

function countGroups(database: Awaited<ReturnType<typeof db>>, userId: number): number {
  return (database.prepare('SELECT COUNT(*) AS n FROM comparison_groups WHERE user_id = ?').get(userId) as { n: number }).n;
}

function priceHistory(database: Awaited<ReturnType<typeof db>>, itemId: number) {
  return database.prepare(
    'SELECT id, price, recorded_at FROM price_history WHERE item_id = ? ORDER BY id',
  ).all(itemId) as { id: number; price: number; recorded_at: string }[];
}

test('mcp add_item_by_url: trash via MCP then re-add returns the same item, no scrape, no new row', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-roundtrip');
    const first = await createToken(['read', 'write'], 'first-agent');
    const second = await createToken(['read', 'write'], 'second-agent');
    const database = await db();

    const added = restoreData((await mcpAddByUrl(first.token, {
      url: AMAZON_PRODUCT_URL,
      notes: 'first-note',
      quantity: 2,
    })).body);
    assert.equal(added.restored_from_trash, undefined);
    assert.equal(added.item.name, AMAZON_NAME);
    assert.equal(added.item.current_price, AMAZON_PRICE);
    assert.equal(added.item.added_by_agent_token_id, first.record.id);
    const itemId = added.item.id;
    assert.deepEqual(fetched, [AMAZON_PRODUCT_URL]);
    const historyBefore = priceHistory(database, itemId);
    assert.equal(historyBefore.length, 1);

    await mcpTrash(first.token, itemId);
    assert.ok(itemRow(database, itemId).deleted_at, 'trash_item must soft-delete');
    const trashedRow = itemRow(database, itemId);

    // 別トークン・トラッキング付き URL・上書きしそうな入力で再追加する。
    fetched.length = 0;
    const response = await mcpAddByUrl(second.token, {
      url: `${AMAZON_PRODUCT_URL}?utm_source=mcp&tag=agent-22`,
      notes: 'must-not-overwrite',
      quantity: 9,
      priority: 1,
    });
    assert.equal(response.status, 200, response.text);
    const restored = restoreData(response.body);
    assert.equal(restored.item.id, itemId);
    assert.equal(restored.restored_from_trash, true);
    assert.equal(typeof restored.restore_message, 'string');
    assert.match(restored.restore_message as string, /ゴミ箱/);
    assert.match(restored.restore_message as string, /復元/);
    assert.equal(restored.media_fetched, false);
    assert.deepEqual(restored.media_fetch_errors, []);
    assert.equal(restored.item.deleted_at, null);
    assert.equal(restored.item.notes, 'first-note');
    assert.equal(restored.item.quantity, 2);
    assert.equal(restored.item.current_price, AMAZON_PRICE);
    assert.equal(restored.item.added_by_agent, true);
    assert.equal(restored.item.added_by_agent_token_id, first.record.id, 'provenance stays with the first agent');

    // content テキストにも復元メッセージが入る（MCP クライアントが読む文面）。
    const text = response.body.result?.content?.map((entry) => entry.text).join('\n') ?? '';
    assert.match(text, /ゴミ箱/);
    assert.match(text, /restored_from_trash/);

    assert.deepEqual(fetched, [], 'restore must not fetch the product page');
    assert.equal(countItems(database, owner.id), 1);
    assert.deepEqual(priceHistory(database, itemId), historyBefore);

    const rowAfter = itemRow(database, itemId);
    assert.equal(rowAfter.deleted_at, null);
    for (const column of Object.keys(trashedRow)) {
      if (column === 'deleted_at' || column === 'updated_at') continue;
      assert.deepEqual(rowAfter[column], trashedRow[column], `column ${column} must survive restore`);
    }
  });
}));

test('mcp add_item_by_url: restore keeps every stored field of a web-added purchased item', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-preserve');
    const token = await createToken(['read', 'write'], 'preserve-agent');
    const database = await db();

    const categoryId = Number(database.prepare(
      "INSERT INTO categories (user_id, name, color) VALUES (?, '本', '#112233')",
    ).run(owner.id).lastInsertRowid);
    const groupId = Number(database.prepare(
      "INSERT INTO comparison_groups (user_id, name, priority, origin) VALUES (?, '手作業グループ', 2, NULL)",
    ).run(owner.id).lastInsertRowid);
    const url = 'https://www.amazon.co.jp/dp/B0PRESERVE1';
    const itemId = Number(database.prepare(`
      INSERT INTO items (
        user_id, name, url, image_url, current_price, original_price, source, source_name,
        priority, planned_purchase_date, comparison_group_id, category_id, notes,
        is_purchased, purchased_at, target_price, target_currency, quantity, sort_order,
        last_scraped_at, scrape_status, scrape_error, source_item_code, price_fetched_at,
        deleted_at, created_at, updated_at
      ) VALUES (
        ?, '買った本', ?, 'https://m.media-amazon.com/images/I/book.jpg', 1200, 1500, 'amazon', 'Amazon',
        5, '2026-12-24', ?, ?, '大事なメモ',
        1, '2026-10-01 09:00:00', 1000, 'JPY', 3, 7,
        '2026-10-02 00:00:00', 'success', NULL, 'B0PRESERVE1', '2026-10-02 00:00:00',
        '2026-10-03 00:00:00', '2026-09-01 00:00:00', '2026-10-03 00:00:00'
      )
    `).run(owner.id, url, groupId, categoryId).lastInsertRowid);
    database.prepare("INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, 1500, '2026-09-01 00:00:00')").run(itemId);
    database.prepare("INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, 1200, '2026-10-02 00:00:00')").run(itemId);
    const rowBefore = itemRow(database, itemId);
    const historyBefore = priceHistory(database, itemId);
    assert.equal(historyBefore.length, 2);

    const response = await mcpAddByUrl(token.token, {
      url: `${url}?ref_=cm_sw&utm_source=x`,
      name: '別の名前',
      notes: 'ignore-me',
      quantity: 1,
      priority: 1,
      planned_purchase_date: '2027-01-01',
    });
    assert.equal(response.status, 200, response.text);
    const restored = restoreData(response.body);
    assert.equal(restored.item.id, itemId);
    assert.equal(restored.restored_from_trash, true);
    assert.equal(restored.item.deleted_at, null);
    assert.equal(restored.item.name, '買った本');
    assert.equal(restored.item.notes, '大事なメモ');
    assert.equal(restored.item.quantity, 3);
    assert.equal(restored.item.priority, 5);
    assert.equal(restored.item.is_purchased, true);
    assert.equal(restored.item.purchased_at, '2026-10-01 09:00:00');
    assert.equal(restored.item.category_id, categoryId);
    assert.equal(restored.item.comparison_group_id, groupId);
    assert.equal(restored.item.added_by_agent, false, 'a web-added item must not become agent-added on restore');
    assert.equal(restored.item.added_by_agent_token_id, null);

    const rowAfter = itemRow(database, itemId);
    assert.equal(rowAfter.deleted_at, null);
    assert.notEqual(rowAfter.updated_at, rowBefore.updated_at);
    assert.equal(rowAfter.updated_at, FIXED_NOW_SQLITE, 'restore stamps updated_at with the frozen clock');
    for (const column of Object.keys(rowBefore)) {
      if (column === 'deleted_at' || column === 'updated_at') continue;
      assert.deepEqual(rowAfter[column], rowBefore[column], `column ${column} must survive restore`);
    }
    assert.deepEqual(priceHistory(database, itemId), historyBefore);
    assert.equal(countItems(database, owner.id), 1);
    assert.equal(countGroups(database, owner.id), 1);
    assert.deepEqual(fetched, []);
  });
}));

test('mcp add_item_by_url: read-only and extension-only tokens are denied and the trash row stays trashed', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-readonly');
    const readOnly = await createToken(['read'], 'read-only');
    const extensionOnly = await createToken(['extension'], 'extension-only');
    const database = await db();
    const itemId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, '読み取り専用', ?, 'keep', datetime('now'))
    `).run(owner.id, AMAZON_PRODUCT_URL).lastInsertRowid);
    const rowBefore = itemRow(database, itemId);

    for (const denied of [readOnly, extensionOnly]) {
      const response = await mcpAddByUrl(denied.token, { url: AMAZON_PRODUCT_URL });
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.result, undefined, 'scope denial is a JSON-RPC error, not a tool result');
      assert.ok(response.body.error, response.text);
      assert.equal(response.body.error.code, -32003);
      assert.equal(response.body.error.data?.httpStatus, 403);
      assert.equal(response.body.error.data?.code, 'AGENT_SCOPE_DENIED');

      const audited = database.prepare(
        "SELECT COUNT(*) AS n FROM agent_audit_log WHERE token_id = ? AND action = 'auth.scope_denied'",
      ).get(denied.record.id) as { n: number };
      assert.equal(audited.n, 1);
    }

    const rowAfter = itemRow(database, itemId);
    assert.ok(rowAfter.deleted_at, 'denied call must not restore');
    assert.deepEqual(rowAfter, rowBefore);
    assert.equal(countItems(database, owner.id), 1);
    assert.deepEqual(fetched, []);
  });
}));

test('mcp add_item_by_url: another member\'s trash neither restores nor blocks; each owner restores only their own row', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const ownerA = await createMember('mcp-owner-a');
    const tokenA = await createToken(['read', 'write'], 'owner-a');
    const ownerB = await createMember('mcp-owner-b');
    const tokenB = await createToken(['read', 'write'], 'owner-b');
    const database = await db();

    const trashedA = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, current_price, deleted_at)
      VALUES (?, 'A の本', ?, 'a-note', 999, datetime('now'))
    `).run(ownerA.id, AMAZON_PRODUCT_URL).lastInsertRowid);

    // B が同じ URL を足すと、A のゴミ箱は使わず B の新規行になる。
    const addedB = restoreData((await mcpAddByUrl(tokenB.token, { url: AMAZON_PRODUCT_URL })).body);
    assert.equal(addedB.restored_from_trash, undefined);
    assert.notEqual(addedB.item.id, trashedA);
    assert.equal(addedB.item.name, AMAZON_NAME);
    assert.equal(addedB.item.notes, null);
    assert.equal(addedB.media_fetched, true);
    assert.deepEqual(fetched, [AMAZON_PRODUCT_URL]);
    assert.equal(itemRow(database, addedB.item.id).user_id, ownerB.id);
    assert.ok(itemRow(database, trashedA).deleted_at, 'A\'s trash row is untouched by B');
    assert.equal(countItems(database, ownerA.id), 1);
    assert.equal(countItems(database, ownerB.id), 1);

    // B のアクティブ行があっても、A は自分のゴミ箱行を復元できる（409 にならない）。
    fetched.length = 0;
    const restoredA = restoreData((await mcpAddByUrl(tokenA.token, { url: `${AMAZON_PRODUCT_URL}?utm_source=a` })).body);
    assert.equal(restoredA.item.id, trashedA);
    assert.equal(restoredA.restored_from_trash, true);
    assert.equal(restoredA.item.notes, 'a-note');
    assert.equal(restoredA.item.current_price, 999);
    assert.deepEqual(fetched, []);
    assert.equal(itemRow(database, trashedA).deleted_at, null);
    assert.equal(itemRow(database, addedB.item.id).deleted_at, null);
    assert.equal(countItems(database, ownerA.id), 1);
    assert.equal(countItems(database, ownerB.id), 1);

    // B がもう一度足すと、B 自身のアクティブ行で 409（A の行は無関係）。
    const dupeB = await mcpAddByUrl(tokenB.token, { url: AMAZON_PRODUCT_URL });
    assert.equal(dupeB.status, 200, dupeB.text);
    assert.equal(dupeB.body.result?.isError, true);
    assert.equal(dupeB.body.result?._meta?.code, 'URL_TAKEN');
    assert.equal(countItems(database, ownerB.id), 1);
  });
}));

test('mcp add_item_by_url: an active row with the same cleaned URL wins over trash (list and purchased)', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-active-wins');
    const token = await createToken(['read', 'write'], 'active-wins');
    const database = await db();

    // UNIQUE(user_id, url) は生の文字列で効くので、トラッキング付きと無しは別行として保存できる。
    const trashedId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, deleted_at)
      VALUES (?, '捨てた', 'https://www.amazon.co.jp/dp/B0ACTIVE01?utm_source=old', datetime('now', '-2 days'))
    `).run(owner.id).lastInsertRowid);
    const activeId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url)
      VALUES (?, 'リストにある', 'https://www.amazon.co.jp/dp/B0ACTIVE01')
    `).run(owner.id).lastInsertRowid);
    const trashedDeletedAt = itemRow(database, trashedId).deleted_at;
    assert.ok(trashedDeletedAt);

    const listed = await mcpAddByUrl(token.token, { url: 'https://www.amazon.co.jp/dp/B0ACTIVE01?tag=shop-22' });
    assert.equal(listed.status, 200, listed.text);
    assert.equal(listed.body.result?.isError, true);
    assert.equal(listed.body.result?._meta?.code, 'URL_TAKEN');
    assert.equal(listed.body.result?._meta?.httpStatus, 409);
    assert.match(listed.body.result?.content?.[0]?.text ?? '', /ほしいもの/);
    assert.equal(itemRow(database, trashedId).deleted_at, trashedDeletedAt, 'trash row must not be restored');
    assert.equal(itemRow(database, activeId).deleted_at, null);

    database.prepare("UPDATE items SET is_purchased = 1, purchased_at = '2026-02-02 00:00:00' WHERE id = ?").run(activeId);
    const purchased = await mcpAddByUrl(token.token, { url: 'https://www.amazon.co.jp/dp/B0ACTIVE01' });
    assert.equal(purchased.status, 200, purchased.text);
    assert.equal(purchased.body.result?.isError, true);
    assert.equal(purchased.body.result?._meta?.code, 'URL_TAKEN');
    assert.match(purchased.body.result?.content?.[0]?.text ?? '', /購入済み/);
    assert.equal(itemRow(database, trashedId).deleted_at, trashedDeletedAt);

    assert.equal(countItems(database, owner.id), 2);
    assert.deepEqual(fetched, [], 'duplicate rejection happens before any fetch');
  });
}));

test('mcp add_item_by_url: with two trashed variants only the most recently trashed row comes back', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-latest-trash');
    const token = await createToken(['read', 'write'], 'latest-trash');
    const database = await db();

    // 保持期間（7日）の内側で、順序だけが決まるように相対時刻で捨てる。
    const olderId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, '古いほう', 'https://www.amazon.co.jp/dp/B0LATEST01?utm_source=older', 'older', datetime('now', '-2 days'))
    `).run(owner.id).lastInsertRowid);
    const newerId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, '新しいほう', 'https://www.amazon.co.jp/dp/B0LATEST01', 'newer', datetime('now', '-1 day'))
    `).run(owner.id).lastInsertRowid);
    const olderDeletedAt = itemRow(database, olderId).deleted_at;
    assert.ok(olderDeletedAt);

    const restored = restoreData((await mcpAddByUrl(token.token, {
      url: 'https://www.amazon.co.jp/dp/B0LATEST01?utm_source=now',
    })).body);
    assert.equal(restored.item.id, newerId);
    assert.equal(restored.restored_from_trash, true);
    assert.equal(restored.item.notes, 'newer');
    assert.equal(itemRow(database, newerId).deleted_at, null);
    assert.equal(itemRow(database, olderId).deleted_at, olderDeletedAt, 'the older trash row stays in trash');
    assert.equal(countItems(database, owner.id), 2);
    assert.deepEqual(fetched, []);
  });
}));

test('mcp add_item_by_url: multi-store add with a late trash URL writes nothing and creates no group', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-multi-trash');
    const token = await createToken(['read', 'write'], 'multi-trash');
    const database = await db();

    const trashedId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, '捨てた店', ?, 'trash-note', datetime('now', '-1 day'))
    `).run(owner.id, EMPTY_URL).lastInsertRowid);
    const trashedBefore = itemRow(database, trashedId);
    assert.equal(countGroups(database, owner.id), 0);

    // 新規グループ: 先頭は取得できる URL、2本目がゴミ箱。
    const rejected = await mcpAddByUrl(token.token, {
      urls: [AMAZON_PRODUCT_URL, EMPTY_URL],
      name: '複数店',
    });
    assert.equal(rejected.status, 200, rejected.text);
    assert.equal(rejected.body.result?.isError, true);
    assert.equal(rejected.body.result?._meta?.code, 'URL_IN_TRASH');
    assert.equal(rejected.body.result?._meta?.httpStatus, 409);
    assert.match(rejected.body.result?.content?.[0]?.text ?? '', /ゴミ箱/);
    assert.deepEqual(itemRow(database, trashedId), trashedBefore, 'trash row is neither restored nor touched');
    assert.equal(countItems(database, owner.id), 1, 'the fetchable first URL must not be saved alone');
    assert.equal(countGroups(database, owner.id), 0);
    assert.ok(!fetched.includes(EMPTY_URL), 'the trashed URL itself is never fetched');

    // 既存品目への店追加: 既存行はグループへ移されず、名前も変わらない。
    const existingId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, priority, notes)
      VALUES (?, '既存の単独品目', ?, 4, 'existing-note')
    `).run(owner.id, PITAKA_URL).lastInsertRowid);
    const existingBefore = itemRow(database, existingId);
    fetched.length = 0;

    const attachRejected = await mcpAddByUrl(token.token, {
      item_id: existingId,
      urls: [AMAZON_PRODUCT_URL, EMPTY_URL],
      name: '上書きしない名前',
      priority: 1,
    });
    assert.equal(attachRejected.status, 200, attachRejected.text);
    assert.equal(attachRejected.body.result?.isError, true);
    assert.equal(attachRejected.body.result?._meta?.code, 'URL_IN_TRASH');
    assert.deepEqual(itemRow(database, existingId), existingBefore, 'existing item must not be renamed or grouped');
    assert.deepEqual(itemRow(database, trashedId), trashedBefore);
    assert.equal(countItems(database, owner.id), 2);
    assert.equal(countGroups(database, owner.id), 0);
    assert.ok(!fetched.includes(EMPTY_URL));
  });
}));

test('mcp add_item (name + url): a trashed URL restores the same row before any fetch', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-add-item-restore');
    const token = await createToken(['read', 'write'], 'add-item-restore');
    const database = await db();
    const itemId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, current_price, deleted_at)
      VALUES (?, '元の名前', ?, 'kept', 500, datetime('now', '-1 day'))
    `).run(owner.id, AMAZON_PRODUCT_URL).lastInsertRowid);
    const rowBefore = itemRow(database, itemId);

    const response = await mcpTool(token.token, 'add_item', {
      name: '新しい名前',
      url: `${AMAZON_PRODUCT_URL}?utm_source=add-item`,
      notes: 'new-note',
    });
    assert.equal(response.status, 200, response.text);
    const restored = restoreData(response.body);
    assert.equal(restored.item.id, itemId);
    assert.equal(restored.restored_from_trash, true);
    assert.match(restored.restore_message ?? '', /ゴミ箱/);
    assert.equal(restored.media_fetched, false);
    assert.deepEqual(restored.media_fetch_errors, []);
    assert.equal(restored.item.name, '元の名前');
    assert.equal(restored.item.notes, 'kept');
    assert.equal(restored.item.current_price, 500);
    assert.equal(restored.item.deleted_at, null);

    const rowAfter = itemRow(database, itemId);
    for (const column of Object.keys(rowBefore)) {
      if (column === 'deleted_at' || column === 'updated_at') continue;
      assert.deepEqual(rowAfter[column], rowBefore[column], `column ${column} must survive restore`);
    }
    assert.equal(countItems(database, owner.id), 1);
    assert.deepEqual(fetched, []);
  });
}));

test('mcp update_item: moving an active item onto a trashed URL is URL_IN_TRASH and touches neither row', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-update-trash-twin');
    const token = await createToken(['read', 'write'], 'update-trash-twin');
    const database = await db();
    const trashedId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, '捨てた双子', ?, 'twin', datetime('now', '-1 day'))
    `).run(owner.id, AMAZON_PRODUCT_URL).lastInsertRowid);
    const activeId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes)
      VALUES (?, '動かす品目', ?, 'active')
    `).run(owner.id, PITAKA_URL).lastInsertRowid);
    const trashedBefore = itemRow(database, trashedId);
    const activeBefore = itemRow(database, activeId);

    const response = await mcpTool(token.token, 'update_item', {
      item_id: activeId,
      url: `${AMAZON_PRODUCT_URL}?utm_source=move`,
      notes: 'should-not-apply',
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.result?.isError, true, response.text);
    assert.equal(response.body.result?._meta?.code, 'URL_IN_TRASH');
    assert.equal(response.body.result?._meta?.httpStatus, 409);
    assert.match(response.body.result?.content?.[0]?.text ?? '', /ゴミ箱/);

    assert.deepEqual(itemRow(database, trashedId), trashedBefore, 'the trashed twin is neither restored nor touched');
    assert.deepEqual(itemRow(database, activeId), activeBefore, 'the active item keeps its URL and notes');
    assert.equal(countItems(database, owner.id), 2);
    assert.deepEqual(fetched, []);
  });
}));

/**
 * 取得中に、別の経路（拡張の一括 import など、取得しない登録）で同じ URL が登録されて
 * すぐゴミ箱に入った状況。取得後の再検査で復元されるが、応答も「復元」でなければならない。
 */
function injectTrashDuringFetch(database: Awaited<ReturnType<typeof db>>, userId: number, url: string) {
  const state: { injectedId: number | null } = { injectedId: null };
  const port = {
    lookup: (target: URL): ProductFixture | undefined => {
      if (state.injectedId == null && target.href === url) {
        state.injectedId = Number(database.prepare(`
          INSERT INTO items (user_id, name, url, notes, deleted_at)
          VALUES (?, '取得中に捨てた', ?, 'race-note', datetime('now'))
        `).run(userId, url).lastInsertRowid);
      }
      return regressionLookup(target);
    },
    timeoutMs: 400,
  };
  return { state, port };
}

test('mcp add_item_by_url: a same-URL row trashed while the page is fetched is restored and reported as a restore', () => serial(async () => {
  const owner = await createMember('mcp-race-by-url');
  const token = await createToken(['read', 'write'], 'race-by-url');
  const database = await db();
  const { state, port } = injectTrashDuringFetch(database, owner.id, AMAZON_PRODUCT_URL);

  await withPort(port, async () => {
    const response = await mcpAddByUrl(token.token, { url: AMAZON_PRODUCT_URL, notes: 'from-agent' });
    assert.equal(response.status, 200, response.text);
    const data = restoreData(response.body);
    assert.ok(state.injectedId, 'the fixture must have injected the trashed row during the fetch');
    assert.equal(data.item.id, state.injectedId);
    assert.equal(data.item.deleted_at, null);
    assert.equal(data.item.notes, 'race-note');
    assert.equal(data.item.current_price, null, 'restore keeps the stored row; the fetched price is not written');
    assert.equal(data.restored_from_trash, true);
    assert.match(data.restore_message ?? '', /ゴミ箱/);
    assert.equal(data.media_fetched, false);
    assert.deepEqual(data.media_fetch_errors, []);
    assert.equal(countItems(database, owner.id), 1);
    assert.equal(priceHistory(database, state.injectedId as number).length, 0);
  });
}));

test('mcp add_item (name + url): a same-URL row trashed while the page is fetched is restored and reported as a restore', () => serial(async () => {
  const owner = await createMember('mcp-race-add-item');
  const token = await createToken(['read', 'write'], 'race-add-item');
  const database = await db();
  const { state, port } = injectTrashDuringFetch(database, owner.id, AMAZON_PRODUCT_URL);

  await withPort(port, async () => {
    const response = await mcpTool(token.token, 'add_item', { name: '名前つき', url: AMAZON_PRODUCT_URL });
    assert.equal(response.status, 200, response.text);
    const data = restoreData(response.body);
    assert.ok(state.injectedId, 'the fixture must have injected the trashed row during the fetch');
    assert.equal(data.item.id, state.injectedId);
    assert.equal(data.item.deleted_at, null);
    assert.equal(data.item.name, '取得中に捨てた');
    assert.equal(data.item.current_price, null);
    assert.equal(data.restored_from_trash, true);
    assert.match(data.restore_message ?? '', /ゴミ箱/);
    assert.equal(data.media_fetched, false);
    assert.deepEqual(data.media_fetch_errors, []);
    assert.equal(countItems(database, owner.id), 1);
    assert.equal(priceHistory(database, state.injectedId as number).length, 0);
  });
}));

// ---- purge_item（#381）: ゴミ箱内の自分の品目 1 件だけを完全削除し、同じ URL を再取得で登録し直せる ----

type PurgeData = { purged: boolean; item: { id: number; name: string; url: string } };

type ToolDescriptor = {
  name: string;
  description: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  inputSchema: { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean };
};

function findItemRow(database: Awaited<ReturnType<typeof db>>, id: number): ItemRow | undefined {
  return database.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
}

function countChildren(database: Awaited<ReturnType<typeof db>>, itemId: number) {
  const history = (database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(itemId) as { n: number }).n;
  const notifications = (database.prepare(
    'SELECT COUNT(*) AS n FROM notification_settings WHERE item_id = ?',
  ).get(itemId) as { n: number }).n;
  return { history, notifications };
}

async function mcpToolsList(token: string): Promise<ToolDescriptor[]> {
  const response = await call(mcpPath, 'POST', '/api/mcp', {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'tools/list',
  }, undefined, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, text/event-stream',
  });
  assert.equal(response.status, 200, response.text);
  return (response.json as { result: { tools: ToolDescriptor[] } }).result.tools;
}

test('mcp purge_item: hard-deletes one trashed item with its children, then the same URL is a fresh insert that fetches again', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-purge');
    const token = await createToken(['read', 'write'], 'purge-agent');
    const database = await db();

    const added = restoreData((await mcpAddByUrl(token.token, { url: AMAZON_PRODUCT_URL, notes: 'stale-fetch' })).body);
    const itemId = added.item.id;
    database.prepare('INSERT INTO notification_settings (item_id, target_price) VALUES (?, 1000)').run(itemId);
    assert.deepEqual(countChildren(database, itemId), { history: 1, notifications: 1 });

    await mcpTrash(token.token, itemId);
    fetched.length = 0;

    const purged = await mcpTool(token.token, 'purge_item', { item_id: itemId });
    assert.equal(purged.status, 200, purged.text);
    assert.equal(purged.body.result?.isError, false, purged.text);
    const data = purged.body.result?.structuredContent?.data as unknown as PurgeData;
    assert.equal(data.purged, true);
    assert.equal(data.item.id, itemId);
    assert.equal(data.item.url, AMAZON_PRODUCT_URL);
    assert.equal(data.item.name, AMAZON_NAME);
    assert.equal(findItemRow(database, itemId), undefined, 'the items row must be gone');
    assert.deepEqual(countChildren(database, itemId), { history: 0, notifications: 0 }, 'child rows must not be orphaned');
    assert.equal(countItems(database, owner.id), 0);
    assert.deepEqual(fetched, [], 'purge never fetches the product page');

    const audited = database.prepare(
      "SELECT meta FROM agent_audit_log WHERE token_id = ? AND action = 'items.purge'",
    ).all(token.record.id) as { meta: string | null }[];
    assert.equal(audited.length, 1, 'purge is written to the audit log once, after it succeeded');
    const auditMeta = JSON.parse(audited[0].meta ?? '{}') as { item_id?: number; tool?: string; scope?: string };
    assert.equal(auditMeta.item_id, itemId);
    assert.equal(auditMeta.tool, 'purge_item');
    assert.equal(auditMeta.scope, 'write');

    // 2回目は行が無いので 404（trash_item のような冪等成功にはしない）
    const again = await mcpTool(token.token, 'purge_item', { item_id: itemId });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.body.result?.isError, true);
    assert.equal(again.body.result?._meta?.code, 'ITEM_NOT_FOUND');
    assert.equal(again.body.result?._meta?.httpStatus, 404);

    // 同じ URL は復元ではなく新規 INSERT。取得が走り、古いメモは戻らない。
    const readded = restoreData((await mcpAddByUrl(token.token, { url: `${AMAZON_PRODUCT_URL}?utm_source=retry` })).body);
    assert.equal(readded.restored_from_trash, undefined);
    assert.equal(readded.restore_message, undefined);
    assert.notEqual(readded.item.id, itemId);
    assert.equal(readded.item.name, AMAZON_NAME);
    assert.equal(readded.item.current_price, AMAZON_PRICE);
    assert.equal(readded.item.notes, null);
    assert.equal(readded.item.deleted_at, null);
    assert.equal(readded.media_fetched, true);
    assert.deepEqual(fetched, [AMAZON_PRODUCT_URL], 're-add after purge fetches the page again');
    assert.equal(countItems(database, owner.id), 1);
    assert.equal(priceHistory(database, readded.item.id).length, 1);
  });
}));

test('mcp purge_item: refuses list, purchased, foreign, missing, read-only, and malformed calls without touching any row', () => serial(async () => {
  const { fetched, port } = recordingPort();
  await withPort(port, async () => {
    const owner = await createMember('mcp-purge-refuse');
    const token = await createToken(['read', 'write'], 'purge-refuse');
    const readOnly = await createToken(['read'], 'purge-read-only');
    const stranger = await createMember('mcp-purge-stranger');
    const strangerToken = await createToken(['read', 'write'], 'purge-stranger');
    const database = await db();

    const activeId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes) VALUES (?, 'ほしいもの', 'https://example.com/products/active-keep', 'keep')
    `).run(owner.id).lastInsertRowid);
    const purchasedId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, is_purchased, purchased_at)
      VALUES (?, '購入済み', 'https://example.com/products/purchased-keep', 1, '2026-10-01 00:00:00')
    `).run(owner.id).lastInsertRowid);
    const trashedId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, deleted_at)
      VALUES (?, 'ゴミ箱', ?, datetime('now', '-1 day'))
    `).run(owner.id, AMAZON_PRODUCT_URL).lastInsertRowid);
    for (const id of [activeId, purchasedId, trashedId]) {
      database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 1234)').run(id);
      database.prepare('INSERT INTO notification_settings (item_id, target_price) VALUES (?, 1000)').run(id);
    }
    const before = new Map([activeId, purchasedId, trashedId].map((id) => [id, itemRow(database, id)]));

    for (const [id, label] of [[activeId, 'list'], [purchasedId, 'purchased']] as const) {
      const response = await mcpTool(token.token, 'purge_item', { item_id: id });
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.result?.isError, true, `${label}: ${response.text}`);
      assert.equal(response.body.result?._meta?.code, 'ITEM_NOT_TRASHED', label);
      assert.equal(response.body.result?._meta?.httpStatus, 409, label);
      const text = response.body.result?.content?.[0]?.text ?? '';
      assert.match(text, /ゴミ箱/, label);
      assert.match(text, /trash_item/, label);
    }

    // 他人のゴミ箱行と存在しない ID は 404（存在を教えない）
    const foreign = await mcpTool(strangerToken.token, 'purge_item', { item_id: trashedId });
    assert.equal(foreign.body.result?.isError, true, foreign.text);
    assert.equal(foreign.body.result?._meta?.code, 'ITEM_NOT_FOUND');
    assert.equal(foreign.body.result?._meta?.httpStatus, 404);

    const missing = await mcpTool(token.token, 'purge_item', { item_id: 987_654_321 });
    assert.equal(missing.body.result?.isError, true, missing.text);
    assert.equal(missing.body.result?._meta?.code, 'ITEM_NOT_FOUND');

    // read だけのトークンは scope 拒否（JSON-RPC エラー）
    const denied = await mcpTool(readOnly.token, 'purge_item', { item_id: trashedId });
    assert.equal(denied.status, 200, denied.text);
    assert.equal(denied.body.result, undefined, 'scope denial is a JSON-RPC error, not a tool result');
    assert.equal(denied.body.error?.code, -32003);
    assert.equal(denied.body.error?.data?.code, 'AGENT_SCOPE_DENIED');

    // 引数は宣言どおり item_id（正の整数）だけ。別名 id・混在・余分なキー・型違いは、
    // 有効なゴミ箱行を指していても 400 で拒否し、何も消さない。
    const malformed: Record<string, unknown>[] = [
      {},
      { id: trashedId },
      { item_id: trashedId, id: trashedId },
      { item_id: trashedId, extra: true },
      { item_id: trashedId, item: trashedId },
      { item_id: String(trashedId) },
      { item_id: trashedId + 0.5 },
      { item_id: 0 },
      { item_id: -trashedId },
      { item_id: Number.MAX_SAFE_INTEGER + 2 },
      { item_id: null },
      { item_id: [trashedId] },
      { item_id: { id: trashedId } },
    ];
    for (const args of malformed) {
      const invalid = await mcpTool(token.token, 'purge_item', args);
      assert.equal(invalid.status, 200, invalid.text);
      assert.equal(invalid.body.result?.isError, true, JSON.stringify(args));
      assert.equal(invalid.body.result?._meta?.code, 'INVALID_INPUT', JSON.stringify(args));
      assert.equal(invalid.body.result?._meta?.httpStatus, 400, JSON.stringify(args));
      assert.match(invalid.body.result?.content?.[0]?.text ?? '', /item_id/, JSON.stringify(args));
    }

    // 既存ツールの互換: 別名 id は purge_item 以外では今までどおり通る
    const aliasRead = await mcpTool(token.token, 'get_item', { id: trashedId });
    assert.equal(aliasRead.body.result?.isError, false, aliasRead.text);
    assert.equal((aliasRead.body.result?.structuredContent?.data as { id: number }).id, trashedId);

    for (const [id, row] of before) {
      assert.deepEqual(itemRow(database, id), row, `item ${id} must be untouched`);
      assert.deepEqual(countChildren(database, id), { history: 1, notifications: 1 }, `children of ${id} must be untouched`);
    }
    assert.equal(countItems(database, owner.id), 3);
    assert.equal(countItems(database, stranger.id), 0);
    assert.deepEqual(fetched, []);

    // 拒否された呼び出し（409 / 404 / 403 / 400）は、成功を装う items.purge を操作ログに残さない
    for (const record of [token.record, readOnly.record, strangerToken.record]) {
      const purgeAudits = (database.prepare(
        "SELECT COUNT(*) AS n FROM agent_audit_log WHERE token_id = ? AND action = 'items.purge'",
      ).get(record.id) as { n: number }).n;
      assert.equal(purgeAudits, 0, `token ${record.id} must have no items.purge audit entry`);
    }
    const scopeDenied = (database.prepare(
      "SELECT COUNT(*) AS n FROM agent_audit_log WHERE token_id = ? AND action = 'auth.scope_denied'",
    ).get(readOnly.record.id) as { n: number }).n;
    assert.equal(scopeDenied, 1, 'the scope denial itself is still audited');
  });
}));

test('mcp tools/list: purge_item is a write-only destructive tool for one item, and no empty-trash tool exists', () => serial(async () => {
  await createMember('mcp-purge-list');
  const write = await createToken(['read', 'write'], 'purge-list-write');
  const read = await createToken(['read'], 'purge-list-read');

  const tools = await mcpToolsList(write.token);
  const purge = tools.find((tool) => tool.name === 'purge_item');
  assert.ok(purge, 'purge_item must be listed for a write token');
  assert.deepEqual(purge.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(purge.inputSchema.required, ['item_id']);
  assert.deepEqual(Object.keys(purge.inputSchema.properties ?? {}), ['item_id']);
  assert.equal(purge.inputSchema.additionalProperties, false);
  assert.match(purge.description, /ゴミ箱/);
  assert.match(purge.description, /1件/);

  // 破壊的なツールは trash_item と purge_item だけ。ゴミ箱全件や複数件を消すツールは無い。
  const destructive = tools.filter((tool) => tool.annotations.destructiveHint).map((tool) => tool.name).sort();
  assert.deepEqual(destructive, ['purge_item', 'trash_item']);
  const trashLike = tools.map((tool) => tool.name).filter((name) => /trash|purge|delete|empty|clear/i.test(name)).sort();
  assert.deepEqual(trashLike, ['purge_item', 'trash_item']);

  const readTools = (await mcpToolsList(read.token)).map((tool) => tool.name);
  assert.equal(readTools.includes('purge_item'), false, 'read-only tokens must not see purge_item');
}));

test('mcp purge_item: deletion and its audit row are one transaction; an audit failure rolls the purge back and a retry works', () => serial(async () => {
  const owner = await createMember('mcp-purge-atomic');
  const token = await createToken(['read', 'write'], 'purge-atomic');
  const database = await db();
  const seedTrashed = (name: string, url: string) => {
    const id = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, deleted_at) VALUES (?, ?, ?, datetime('now', '-1 day'))
    `).run(owner.id, name, url).lastInsertRowid);
    database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 777)').run(id);
    database.prepare('INSERT INTO notification_settings (item_id, target_price) VALUES (?, 700)').run(id);
    return id;
  };
  const itemId = seedTrashed('記録できない削除', 'https://example.com/products/atomic-purge');
  const purgeAudits = () => database.prepare(
    "SELECT meta FROM agent_audit_log WHERE token_id = ? AND action = 'items.purge' ORDER BY id",
  ).all(token.record.id) as { meta: string | null }[];

  // items.purge の INSERT だけを失敗させる一時トリガ。削除と記録が同じトランザクションなら削除も戻る。
  database.exec(`CREATE TEMP TRIGGER fail_purge_audit BEFORE INSERT ON agent_audit_log
    WHEN NEW.action = 'items.purge' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  try {
    const failed = await mcpTool(token.token, 'purge_item', { item_id: itemId });
    assert.equal(failed.status, 200, failed.text);
    assert.equal(failed.body.result, undefined, 'a rolled-back purge is a JSON-RPC error, not a tool result');
    assert.equal(failed.body.error?.code, -32603, failed.text);
    assert.equal(failed.body.error?.data?.httpStatus, 500);
    assert.equal(failed.body.error?.data?.code, 'PURGE_FAILED');

    const row = findItemRow(database, itemId);
    assert.ok(row, 'the item must survive when its audit row cannot be written');
    assert.ok(row.deleted_at, 'the item is still in the trash');
    assert.deepEqual(countChildren(database, itemId), { history: 1, notifications: 1 }, 'both child types survive');
    assert.equal(purgeAudits().length, 0);
  } finally {
    database.exec('DROP TRIGGER fail_purge_audit');
  }

  // トリガを外せば同じ呼び出しがそのまま通る
  const retried = await mcpTool(token.token, 'purge_item', { item_id: itemId });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.body.result?.isError, false, retried.text);
  assert.equal((retried.body.result?.structuredContent?.data as unknown as PurgeData).item.id, itemId);
  assert.equal(findItemRow(database, itemId), undefined);
  assert.deepEqual(countChildren(database, itemId), { history: 0, notifications: 0 });
  const afterRetry = purgeAudits();
  assert.equal(afterRetry.length, 1);
  assert.deepEqual(JSON.parse(afterRetry[0].meta ?? '{}'), { scope: 'write', tool: 'purge_item', item_id: itemId });

  // executeAgentTool を直接呼ぶ経路（tools/call を経ない）でも同じ記録が残る
  const { executeAgentTool } = await import('../src/lib/agent-tools');
  const { findAgentTokenByPlaintext } = await import('../src/lib/agent-token');
  const auth = findAgentTokenByPlaintext(token.token);
  assert.ok(auth, 'the token must resolve to an auth context');
  const directId = seedTrashed('直接実行', 'https://example.com/products/atomic-purge-direct');
  const direct = await executeAgentTool('purge_item', { item_id: directId }, auth) as { data: PurgeData };
  assert.equal(direct.data.purged, true);
  assert.equal(findItemRow(database, directId), undefined);
  assert.deepEqual(countChildren(database, directId), { history: 0, notifications: 0 });
  const afterDirect = purgeAudits();
  assert.equal(afterDirect.length, 2, 'the direct executor is audited exactly like tools/call');
  assert.deepEqual(JSON.parse(afterDirect[1].meta ?? '{}'), { scope: 'write', tool: 'purge_item', item_id: directId });
}));
