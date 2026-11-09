// ゴミ箱の同一 URL を再追加すると復元する（#365）。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { after, before, mock, test } from 'node:test';
import { call, createMember, db, setTestUser } from './regression-harness';
import {
  AMAZON_PRODUCT_URL,
  regressionFetchPort,
} from '../src/lib/product-regression-fixtures';
import { installFrozenClock } from './trash-restore-clock';

const itemsPath = '../src/app/api/items/route.ts';
const trashItemPath = '../src/app/api/trash/[id]/route.ts';
const extensionPath = '../src/app/api/extension-add/route.ts';
const tokensPath = '../src/app/api/agent-tokens/route.ts';
const byUrlPath = '../src/app/api/agent/v1/items/by-url/route.ts';

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

test('findCleanedStoredUrlRegistration prefers active over trash', () => serial(async () => {
  const { findCleanedStoredUrlRegistration } = await import('../src/lib/item-input');
  const member = await createMember('url-state');
  await setTestUser(member);
  const database = await db();
  database.prepare(`
    INSERT INTO items (user_id, name, url, deleted_at)
    VALUES (?, '捨てた', ?, datetime('now'))
  `).run(member.id, 'https://www.amazon.co.jp/dp/B00TRASH01');
  database.prepare(`
    INSERT INTO items (user_id, name, url, is_purchased)
    VALUES (?, '買った', ?, 1)
  `).run(member.id, 'https://www.amazon.co.jp/dp/B00TRASH01?utm_source=x');

  const state = findCleanedStoredUrlRegistration(
    database,
    member.id,
    'https://www.amazon.co.jp/dp/B00TRASH01',
  );
  assert.equal(state.kind, 'active');
  if (state.kind === 'active') assert.equal(state.location, 'purchased');
}));

test('POST /api/items restores a trashed URL instead of rejecting', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('web-restore');
    await setTestUser(member);
    const database = await db();
    const inserted = database.prepare(`
      INSERT INTO items (user_id, name, url, current_price, notes, deleted_at)
      VALUES (?, '古い本', ?, 1200, 'メモ残す', datetime('now'))
    `).run(member.id, AMAZON_PRODUCT_URL);
    const itemId = Number(inserted.lastInsertRowid);

    const response = await call(itemsPath, 'POST', '/api/items', { url: `${AMAZON_PRODUCT_URL}?utm_source=readd` });
    assert.equal(response.status, 200, response.text);
    const body = response.json as {
      id: number;
      deleted_at: string | null;
      notes: string | null;
      restoredFromTrash: boolean;
      restoreMessage: string;
    };
    assert.equal(body.id, itemId);
    assert.equal(body.deleted_at, null);
    assert.equal(body.notes, 'メモ残す');
    assert.equal(body.restoredFromTrash, true);
    assert.match(body.restoreMessage, /ゴミ箱/);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(member.id) as { n: number }).n,
      1,
    );
  } finally {
    installProductFetchPort(null);
  }
}));

test('POST /api/items rejects active and purchased duplicates with clear Japanese errors', () => serial(async () => {
  const member = await createMember('web-dupe');
  await setTestUser(member);
  const database = await db();
  database.prepare(`
    INSERT INTO items (user_id, name, url) VALUES (?, 'リスト', 'https://example.test/list-item')
  `).run(member.id);
  database.prepare(`
    INSERT INTO items (user_id, name, url, is_purchased) VALUES (?, '購入', 'https://example.test/bought-item', 1)
  `).run(member.id);

  const list = await call(itemsPath, 'POST', '/api/items', { url: 'https://example.test/list-item' });
  assert.equal(list.status, 409, list.text);
  assert.equal((list.json as { code: string }).code, 'URL_TAKEN');
  assert.match(String((list.json as { error: string }).error), /ほしいもの/);

  const bought = await call(itemsPath, 'POST', '/api/items', { url: 'https://example.test/bought-item' });
  assert.equal(bought.status, 409, bought.text);
  assert.match(String((bought.json as { error: string }).error), /購入済み/);
}));

test('hard-deleted trash URL can be added again', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('hard-delete');
    await setTestUser(member);
    const database = await db();
    const inserted = database.prepare(`
      INSERT INTO items (user_id, name, url, deleted_at)
      VALUES (?, '消す本', ?, datetime('now'))
    `).run(member.id, AMAZON_PRODUCT_URL);
    const itemId = Number(inserted.lastInsertRowid);

    const purged = await call(trashItemPath, 'DELETE', `/api/trash/${itemId}`, undefined, { id: String(itemId) });
    assert.equal(purged.status, 200, purged.text);
    assert.equal(database.prepare('SELECT id FROM items WHERE id = ?').get(itemId), undefined);

    const added = await call(itemsPath, 'POST', '/api/items', { url: AMAZON_PRODUCT_URL });
    assert.equal(added.status, 201, added.text);
    assert.equal((added.json as { restoredFromTrash?: boolean }).restoredFromTrash, undefined);
    assert.notEqual((added.json as { id: number }).id, itemId);
  } finally {
    installProductFetchPort(null);
  }
}));

test('DELETE /api/trash/:id keeps 404 outside the trash and removes child rows for a trashed item (#381 shared purge)', () => serial(async () => {
  const member = await createMember('web-purge');
  await setTestUser(member);
  const database = await db();
  const children = (itemId: number) => ({
    history: (database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(itemId) as { n: number }).n,
    notifications: (database.prepare('SELECT COUNT(*) AS n FROM notification_settings WHERE item_id = ?').get(itemId) as { n: number }).n,
  });
  const seed = (name: string, url: string, trashed: boolean) => {
    const id = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, deleted_at)
      VALUES (?, ?, ?, ${trashed ? "datetime('now')" : 'NULL'})
    `).run(member.id, name, url).lastInsertRowid);
    database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 500)').run(id);
    database.prepare('INSERT INTO notification_settings (item_id, target_price) VALUES (?, 400)').run(id);
    return id;
  };
  const activeId = seed('リストの本', 'https://example.test/web-purge-active', false);
  const trashedId = seed('捨てた本', 'https://example.test/web-purge-trashed', true);
  const foreignTrashedId = seed('他人が消そうとする本', 'https://example.test/web-purge-foreign', true);
  const purgeRaw = (rawId: string) => call(trashItemPath, 'DELETE', `/api/trash/${encodeURIComponent(rawId)}`, undefined, { id: rawId });
  const purge = (id: number) => purgeRaw(String(id));

  // ゴミ箱に無い品目は Web でも 404 のまま。子レコードも消えない。
  const notTrashed = await purge(activeId);
  assert.equal(notTrashed.status, 404, notTrashed.text);
  assert.ok(database.prepare('SELECT id FROM items WHERE id = ?').get(activeId));
  assert.deepEqual(children(activeId), { history: 1, notifications: 1 });

  // パスの id は10進の数字だけ。同じ行を指す16進・指数・小数・空白・符号・末尾ゴミは 404 で、行も子も残る。
  const hex = `0x${trashedId.toString(16)}`;
  assert.equal(Number(hex), trashedId, 'the fixture must be a hex spelling of the same id');
  for (const rawId of [hex, `${trashedId}e0`, `${trashedId}.0`, ` ${trashedId}`, `${trashedId} `, `+${trashedId}`, `-${trashedId}`, `${trashedId}abc`, '0b1', 'Infinity', '']) {
    const refused = await purgeRaw(rawId);
    assert.equal(refused.status, 404, `${JSON.stringify(rawId)}: ${refused.text}`);
    assert.ok(database.prepare('SELECT id FROM items WHERE id = ?').get(trashedId), `${JSON.stringify(rawId)} must not delete the addressed row`);
    assert.deepEqual(children(trashedId), { history: 1, notifications: 1 }, JSON.stringify(rawId));
  }

  // 他人のゴミ箱行は 404 で残る
  const other = await createMember('web-purge-other');
  await setTestUser(other);
  const foreign = await purge(foreignTrashedId);
  assert.equal(foreign.status, 404, foreign.text);
  assert.ok(database.prepare('SELECT id FROM items WHERE id = ?').get(foreignTrashedId));
  assert.deepEqual(children(foreignTrashedId), { history: 1, notifications: 1 });
  await setTestUser(member);

  // 自分のゴミ箱行は本体と子レコードが消える（先頭ゼロ付きの10進は従来どおり同じ行）
  const purged = await purgeRaw(`0${trashedId}`);
  assert.equal(purged.status, 200, purged.text);
  assert.equal((purged.json as { success: boolean }).success, true);
  assert.equal(database.prepare('SELECT id FROM items WHERE id = ?').get(trashedId), undefined);
  assert.deepEqual(children(trashedId), { history: 0, notifications: 0 });

  const again = await purge(trashedId);
  assert.equal(again.status, 404, again.text);
}));

test('extension-add restores trashed URL', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('ext-restore');
    await setTestUser(member);
    const database = await db();
    const inserted = database.prepare(`
      INSERT INTO items (user_id, name, url, deleted_at)
      VALUES (?, '古い本', ?, datetime('now'))
    `).run(member.id, AMAZON_PRODUCT_URL);
    const itemId = Number(inserted.lastInsertRowid);
    const { generateToken } = await import('../src/lib/auth');
    const token = generateToken(member as never);

    const response = await call(extensionPath, 'POST', '/api/extension-add', {
      token,
      item: {
        name: '古い本',
        url: AMAZON_PRODUCT_URL,
        price: 100,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    });
    assert.equal(response.status, 200, response.text);
    const body = response.json as {
      success: boolean;
      id: number;
      restoredFromTrash: boolean;
      message: string;
    };
    assert.equal(body.success, true);
    assert.equal(body.id, itemId);
    assert.equal(body.restoredFromTrash, true);
    assert.match(body.message, /ゴミ箱/);
    assert.equal(
      (database.prepare('SELECT deleted_at FROM items WHERE id = ?').get(itemId) as { deleted_at: string | null }).deleted_at,
      null,
    );
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent add_item_by_url restores trashed single URL and rejects multi-store trash URL', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('agent-restore');
    await setTestUser(member);
    const database = await db();
    const inserted = database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, 'エージェント本', ?, 'agent-note', datetime('now'))
    `).run(member.id, AMAZON_PRODUCT_URL);
    const itemId = Number(inserted.lastInsertRowid);

    const created = await call(
      tokensPath,
      'POST',
      '/api/agent-tokens',
      { name: 'restore', scopes: ['write'], expiresInDays: 30 },
      undefined,
      sameOrigin,
      `${sameOriginUrl}/api/agent-tokens`,
    );
    assert.equal(created.status, 201, created.text);
    const token = (created.json as { token: string }).token;
    const headers = { Authorization: `Bearer ${token}` };

    const restored = await call(
      byUrlPath,
      'POST',
      '/api/agent/v1/items/by-url',
      { url: `${AMAZON_PRODUCT_URL}?utm_source=agent` },
      undefined,
      headers,
    );
    assert.equal(restored.status, 201, restored.text);
    const data = (restored.json as {
      data: {
        item: { id: number; deleted_at: string | null; notes: string | null };
        restored_from_trash: boolean;
        restore_message: string;
      };
    }).data;
    assert.equal(data.item.id, itemId);
    assert.equal(data.item.deleted_at, null);
    assert.equal(data.item.notes, 'agent-note');
    assert.equal(data.restored_from_trash, true);
    assert.match(data.restore_message, /ゴミ箱/);

    database.prepare(`
      UPDATE items SET deleted_at = datetime('now') WHERE id = ?
    `).run(itemId);

    const multi = await call(
      byUrlPath,
      'POST',
      '/api/agent/v1/items/by-url',
      {
        urls: [AMAZON_PRODUCT_URL, 'https://example.com/products/reference-only'],
        name: '複数店',
      },
      undefined,
      headers,
    );
    assert.equal(multi.status, 409, multi.text);
    assert.equal((multi.json as { code: string }).code, 'URL_IN_TRASH');
    assert.match(String((multi.json as { error: string }).error), /ゴミ箱/);
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent add_item_by_url restores trash before scrape; scrape failure does not block restore', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  // fixture miss / 待機ページ相当。復元が scrape より先ならここに到達しない。
  installProductFetchPort({ lookup: () => undefined });
  try {
    const member = await createMember('agent-restore-noscrape');
    await setTestUser(member);
    const database = await db();
    const url = 'https://www.amazon.co.jp/dp/B0TRASHFAIL1';
    const inserted = database.prepare(`
      INSERT INTO items (user_id, name, url, notes, current_price, deleted_at)
      VALUES (?, '取得できない本', ?, 'keep-me', 880, datetime('now'))
    `).run(member.id, url);
    const itemId = Number(inserted.lastInsertRowid);

    const created = await call(
      tokensPath,
      'POST',
      '/api/agent-tokens',
      { name: 'restore-fail', scopes: ['write'], expiresInDays: 30 },
      undefined,
      sameOrigin,
      `${sameOriginUrl}/api/agent-tokens`,
    );
    assert.equal(created.status, 201, created.text);
    const token = (created.json as { token: string }).token;

    const restored = await call(
      byUrlPath,
      'POST',
      '/api/agent/v1/items/by-url',
      { url },
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(restored.status, 201, restored.text);
    const data = (restored.json as {
      data: {
        item: { id: number; deleted_at: string | null; notes: string | null; current_price: number | null };
        restored_from_trash: boolean;
        media_fetched: boolean;
        media_fetch_errors: unknown[];
      };
    }).data;
    assert.equal(data.item.id, itemId);
    assert.equal(data.item.deleted_at, null);
    assert.equal(data.item.notes, 'keep-me');
    assert.equal(data.item.current_price, 880);
    assert.equal(data.restored_from_trash, true);
    assert.equal(data.media_fetched, false);
    assert.deepEqual(data.media_fetch_errors, []);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(member.id) as { n: number }).n,
      1,
    );
  } finally {
    installProductFetchPort(null);
  }
}));

test('extension-add with an extension-scope agent token audits the restore like an add', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('ext-agent-restore');
    await setTestUser(member);
    const database = await db();
    const itemId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, notes, deleted_at)
      VALUES (?, '拡張で捨てた', ?, 'ext-note', datetime('now', '-1 day'))
    `).run(member.id, AMAZON_PRODUCT_URL).lastInsertRowid);

    const created = await call(
      tokensPath,
      'POST',
      '/api/agent-tokens',
      { name: 'ext', scopes: ['extension'], expiresInDays: 30 },
      undefined,
      sameOrigin,
      `${sameOriginUrl}/api/agent-tokens`,
    );
    assert.equal(created.status, 201, created.text);
    const { token, record } = created.json as { token: string; record: { id: number } };

    const restore = () => call(extensionPath, 'POST', '/api/extension-add', {
      item: {
        name: '拡張で捨てた',
        url: AMAZON_PRODUCT_URL,
        price: 100,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    }, undefined, { Authorization: `Bearer ${token}` });
    database.exec(`CREATE TEMP TRIGGER fail_restore_audit BEFORE INSERT ON agent_audit_log
      WHEN NEW.action = 'extension.add' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
    try {
      assert.equal((await restore()).status, 500);
      const trashed = database.prepare('SELECT deleted_at FROM items WHERE id = ?').get(itemId) as { deleted_at: string | null };
      assert.ok(trashed.deleted_at, 'an audit failure leaves the item in the trash');
    } finally {
      database.exec('DROP TRIGGER fail_restore_audit');
    }
    const response = await restore();
    assert.equal(response.status, 200, response.text);
    const body = response.json as { success: boolean; id: number; restoredFromTrash: boolean; message: string };
    assert.equal(body.success, true);
    assert.equal(body.id, itemId);
    assert.equal(body.restoredFromTrash, true);
    assert.match(body.message, /ゴミ箱/);

    const row = database.prepare(
      'SELECT deleted_at, notes, added_by_agent_token_id FROM items WHERE id = ?',
    ).get(itemId) as { deleted_at: string | null; notes: string | null; added_by_agent_token_id: number | null };
    assert.equal(row.deleted_at, null);
    assert.equal(row.notes, 'ext-note');
    assert.equal(row.added_by_agent_token_id, null, 'restore keeps the original (web) provenance');
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(member.id) as { n: number }).n,
      1,
    );

    // エージェント用トークンによる書き込みは、新規追加と同じく操作ログに残る。
    const audits = database.prepare(
      'SELECT action, meta FROM agent_audit_log WHERE token_id = ? ORDER BY id',
    ).all(record.id) as { action: string; meta: string | null }[];
    const adds = audits.filter((entry) => entry.action === 'extension.add');
    assert.equal(adds.length, 1, `restore through an agent token must be audited: ${JSON.stringify(audits)}`);
    const meta = JSON.parse(adds[0].meta ?? '{}') as { scope?: string; item_id?: number; restored_from_trash?: boolean };
    assert.equal(meta.scope, 'extension');
    assert.equal(meta.item_id, itemId);
    assert.equal(meta.restored_from_trash, true);
  } finally {
    installProductFetchPort(null);
  }
}));

test('PATCH /api/items/[id] cannot move an active item onto a trashed URL', () => serial(async () => {
  const itemIdPath = '../src/app/api/items/[id]/route.ts';
  const member = await createMember('web-patch-trash-twin');
  await setTestUser(member);
  const database = await db();
  database.prepare(`
    INSERT INTO items (user_id, name, url, notes, deleted_at)
    VALUES (?, '捨てた双子', 'https://example.test/trashed-twin', 'twin', datetime('now', '-1 day'))
  `).run(member.id);
  const activeId = Number(database.prepare(`
    INSERT INTO items (user_id, name, url, notes)
    VALUES (?, '動かす品目', 'https://example.test/active-row', 'active')
  `).run(member.id).lastInsertRowid);
  const rowsBefore = database.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY id').all(member.id);

  const response = await call(
    itemIdPath,
    'PATCH',
    `/api/items/${activeId}`,
    { url: 'https://example.test/trashed-twin?utm_source=move', notes: 'should-not-apply' },
    { id: String(activeId) },
  );
  assert.equal(response.status, 409, response.text);
  assert.equal((response.json as { code: string }).code, 'URL_IN_TRASH');
  assert.match(String((response.json as { error: string }).error), /ゴミ箱/);
  assert.deepEqual(
    database.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY id').all(member.id),
    rowsBefore,
    'neither the trashed twin nor the active item changes',
  );
}));
