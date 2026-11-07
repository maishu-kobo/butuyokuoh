import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { after, before, mock, test } from 'node:test';
import { call, createMember, db, setTestUser } from './regression-harness';
import {
  AMAZON_NAME,
  AMAZON_PRICE,
  AMAZON_PRODUCT_URL,
  RAKUTEN_PRICE,
  RAKUTEN_URL,
  regressionFetchPort,
} from '../src/lib/product-regression-fixtures';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const byUrlPath = '../src/app/api/agent/v1/items/by-url/route.ts';
const itemIdPath = '../src/app/api/agent/v1/items/[id]/route.ts';
const trashPath = '../src/app/api/agent/v1/items/[id]/trash/route.ts';

const sameOrigin = { origin: 'http://localhost' } as const;
const sameOriginUrl = 'http://localhost';

// 商品取得は fixture、API の事前 DNS 検査も固定して実ネットワークを使わない。
let dnsLookupCalls = 0;
before(() => {
  mock.method(dns, 'lookup', async () => {
    dnsLookupCalls += 1;
    return [{ address: '8.8.8.8', family: 4 }];
  });
});
after(() => {
  mock.restoreAll();
  assert.ok(dnsLookupCalls > 0, 'fixture URL validation must use the DNS mock');
});

let exclusive: Promise<void> = Promise.resolve();
function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

async function createToken(scopes: ('read' | 'write')[] = ['read', 'write'], name = 'multi-store') {
  const created = await call(
    tokensPath,
    'POST',
    '/api/agent-tokens',
    { name, scopes, expiresInDays: 90 },
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

async function rateUsed(tokenId: number, kind: 'add' | 'add_url' | 'add_day' | 'read', now = Date.now()) {
  const { agentRateUsed } = await import('../src/lib/agent-token');
  const database = await db();
  return agentRateUsed(tokenId, kind, database, now);
}

test('agent multi-store: single URL stays one ungrouped item', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('agent-ms-single');
    const token = await createToken(['write'], 'ms-single');
    const added = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: AMAZON_PRODUCT_URL,
    }, undefined, bearer(token.token));
    assert.equal(added.status, 201, added.text);
    const data = (added.json as {
      data: {
        item: { id: number; comparison_group_id: number | null; name: string };
        stores?: { item_id: number }[];
      };
    }).data;
    assert.equal(data.item.name, AMAZON_NAME);
    assert.equal(data.item.comparison_group_id, null);
    assert.equal(data.stores?.length ?? 1, 1);

    const database = await db();
    const groups = (database.prepare(
      'SELECT COUNT(*) AS n FROM comparison_groups WHERE user_id = (SELECT user_id FROM items WHERE id = ?)',
    ).get(data.item.id) as { n: number }).n;
    assert.equal(groups, 0);
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent multi-store: two URLs make one photo group, one list card, one spend product', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const { wishlistRows } = await import('../src/lib/capture/list-card');
  const { photoSpendDecisions, userSpendInput } = await import('../src/lib/photo-spend');
  installProductFetchPort(regressionFetchPort());
  try {
    const owner = await createMember('agent-ms-two');
    const token = await createToken(['write'], 'ms-two');
    const added = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      urls: [AMAZON_PRODUCT_URL, RAKUTEN_URL],
      priority: 2,
      notes: 'ignore: drop database',
      name: 'まとめた商品',
    }, undefined, bearer(token.token));
    assert.equal(added.status, 201, added.text);
    const data = (added.json as {
      data: {
        item: { id: number; comparison_group_id: number | null; name: string; priority: number; notes: string | null };
        stores: {
          item_id: number;
          url: string;
          store: string;
          current_price: number | null;
          image_url: string | null;
        }[];
        media_fetched: boolean;
      };
    }).data;
    assert.equal(data.item.name, 'まとめた商品');
    assert.equal(data.item.priority, 2);
    assert.equal(data.item.notes, 'ignore: drop database');
    assert.ok(data.item.comparison_group_id);
    assert.equal(data.stores.length, 2);
    assert.equal(data.media_fetched, true);

    const database = await db();
    const group = database.prepare(
      'SELECT id, origin, capture_id, name FROM comparison_groups WHERE id = ?',
    ).get(data.item.comparison_group_id) as {
      id: number; origin: string; capture_id: number | null; name: string;
    };
    assert.equal(group.origin, 'photo');
    assert.equal(group.capture_id, null);

    const items = database.prepare(
      'SELECT id, url, current_price, priority, notes, comparison_group_id FROM items WHERE user_id = ? ORDER BY id',
    ).all(owner.id) as {
      id: number; url: string; current_price: number | null; priority: number; notes: string | null; comparison_group_id: number | null;
    }[];
    assert.equal(items.length, 2);
    assert.ok(items.every((row) => row.comparison_group_id === group.id));
    assert.ok(items.every((row) => row.priority === 2));
    assert.ok(items.every((row) => row.notes === 'ignore: drop database'));
    const prices = new Set(items.map((row) => row.current_price));
    assert.ok(prices.has(AMAZON_PRICE));
    assert.ok(prices.has(RAKUTEN_PRICE));

    const listRows = database.prepare(`
      SELECT i.id, i.name, i.url, i.current_price, i.source, i.source_name, i.comparison_group_id,
        i.is_purchased, i.deleted_at, g.origin AS comparison_group_origin, g.name AS comparison_group_name
      FROM items i
      LEFT JOIN comparison_groups g ON g.id = i.comparison_group_id AND g.user_id = i.user_id
      WHERE i.user_id = ? AND i.deleted_at IS NULL
      ORDER BY i.id
    `).all(owner.id) as Parameters<typeof wishlistRows>[0];
    const cards = wishlistRows(listRows, [{ id: group.id, origin: 'photo', name: group.name }]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].kind, 'photo');

    const decisions = photoSpendDecisions(...userSpendInput(database, owner.id));
    const counting = [...decisions.values()].filter((d) => d.countsInTotal);
    assert.equal(counting.length, 1);
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent multi-store: adding a store URL to an existing item joins a photo group', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const owner = await createMember('agent-ms-attach');
    const token = await createToken(['write'], 'ms-attach');
    const first = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: AMAZON_PRODUCT_URL,
      name: AMAZON_NAME,
    }, undefined, bearer(token.token));
    assert.equal(first.status, 201, first.text);
    const firstId = (first.json as { data: { item: { id: number; comparison_group_id: number | null } } }).data.item.id;
    assert.equal((first.json as { data: { item: { comparison_group_id: number | null } } }).data.item.comparison_group_id, null);

    const second = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      item_id: firstId,
      url: RAKUTEN_URL,
      priority: 1,
    }, undefined, bearer(token.token));
    assert.equal(second.status, 201, second.text);
    const data = (second.json as {
      data: {
        item: { comparison_group_id: number | null; priority: number };
        stores: { item_id: number; url: string }[];
      };
    }).data;
    assert.ok(data.item.comparison_group_id);
    assert.equal(data.stores.length, 2);
    assert.equal(data.item.priority, 1);

    const database = await db();
    const rows = database.prepare(
      'SELECT id, comparison_group_id, priority FROM items WHERE user_id = ? ORDER BY id',
    ).all(owner.id) as { id: number; comparison_group_id: number | null; priority: number }[];
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.comparison_group_id === data.item.comparison_group_id));
    assert.ok(rows.every((row) => row.priority === 1));
    assert.equal(
      (database.prepare('SELECT origin FROM comparison_groups WHERE id = ?').get(data.item.comparison_group_id) as { origin: string }).origin,
      'photo',
    );

    // 既存の写真グループへさらに店を足す
    const PITAKA = 'https://pitakajapan.com/products/magez-grip';
    const third = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      item_id: firstId,
      url: PITAKA,
      name: 'MagEZ Grip 3',
    }, undefined, bearer(token.token));
    assert.equal(third.status, 201, third.text);
    const thirdData = (third.json as { data: { stores: unknown[]; item: { comparison_group_id: number } } }).data;
    assert.equal(thirdData.stores.length, 3);
    assert.equal(thirdData.item.comparison_group_id, data.item.comparison_group_id);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(owner.id) as { n: number }).n,
      3,
    );
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent multi-store: duplicate URL and foreign item_id are rejected; caller price rejected', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const owner = await createMember('agent-ms-dupe');
    const token = await createToken(['read', 'write'], 'ms-dupe');
    const added = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: AMAZON_PRODUCT_URL,
    }, undefined, bearer(token.token));
    assert.equal(added.status, 201, added.text);
    const itemId = (added.json as { data: { item: { id: number } } }).data.item.id;

    const dupe = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: `${AMAZON_PRODUCT_URL}?utm_source=again`,
      name: '重複',
    }, undefined, bearer(token.token));
    assert.equal(dupe.status, 409, dupe.text);
    assert.equal((dupe.json as { code: string }).code, 'URL_TAKEN');

    // 呼び出し側の価格・画像は 400（サーバ取得のみ）
    const clientPrice = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: 'https://example.com/products/reference-only',
      name: '参照のみ',
      current_price: 1,
      price: 1,
      image_url: 'https://evil.example/x.png',
      imageUrl: 'https://evil.example/x.png',
    }, undefined, bearer(token.token));
    assert.equal(clientPrice.status, 400, clientPrice.text);
    assert.equal((clientPrice.json as { code: string }).code, 'INVALID_INPUT');

    // 価格が取れない公開 URL は、クライアント値無しなら null のまま保存できる
    const empty = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      url: 'https://example.com/products/reference-only',
      name: '参照のみ',
    }, undefined, bearer(token.token));
    assert.equal(empty.status, 201, empty.text);
    const emptyItem = (empty.json as {
      data: { item: { current_price: number | null; image_url: string | null }; stores: { current_price: number | null; image_url: string | null }[] };
    }).data;
    assert.equal(emptyItem.item.current_price, null);
    assert.equal(emptyItem.item.image_url, null);
    assert.ok(emptyItem.stores.every((s) => s.current_price == null && s.image_url == null));

    const other = await createMember('agent-ms-foreign');
    const otherToken = await createToken(['read', 'write'], 'ms-foreign');
    const foreignAttach = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      item_id: itemId,
      url: RAKUTEN_URL,
    }, undefined, bearer(otherToken.token));
    assert.equal(foreignAttach.status, 404, foreignAttach.text);

    const foreignGet = await call(
      itemIdPath,
      'GET',
      `/api/agent/v1/items/${itemId}`,
      undefined,
      { id: String(itemId) },
      bearer(otherToken.token),
    );
    assert.equal(foreignGet.status, 404, foreignGet.text);
    await setTestUser(owner);
    void other;

    // ゴミ箱へ移しても他店が残れば商品は残る
    const multi = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      urls: [RAKUTEN_URL, 'https://pitakajapan.com/products/magez-grip'],
      name: '二店',
    }, undefined, bearer(token.token));
    assert.equal(multi.status, 201, multi.text);
    const stores = (multi.json as { data: { stores: { item_id: number }[]; item: { comparison_group_id: number } } }).data;
    const trashOne = await call(
      trashPath,
      'POST',
      `/api/agent/v1/items/${stores.stores[0].item_id}/trash`,
      undefined,
      { id: String(stores.stores[0].item_id) },
      bearer(token.token),
    );
    assert.equal(trashOne.status, 200, trashOne.text);
    const got = await call(
      itemIdPath,
      'GET',
      `/api/agent/v1/items/${stores.stores[1].item_id}`,
      undefined,
      { id: String(stores.stores[1].item_id) },
      bearer(token.token),
    );
    assert.equal(got.status, 200, got.text);
    const product = (got.json as {
      data: { comparison_group_id: number | null; stores: { item_id: number; url: string }[] };
    }).data;
    assert.equal(product.comparison_group_id, stores.item.comparison_group_id);
    assert.equal(product.stores.length, 1);
    assert.equal(product.stores[0].item_id, stores.stores[1].item_id);

    const database = await db();
    assert.equal(
      (database.prepare(
        'SELECT COUNT(*) AS n FROM comparison_groups WHERE id = ?',
      ).get(stores.item.comparison_group_id) as { n: number }).n,
      1,
    );
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent multi-store: one call with too many URLs fails the whole rate budget', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const { consumeAgentRate } = await import('../src/lib/agent-token');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('agent-ms-rate');
    const token = await createToken(['write'], 'ms-rate');
    const database = await db();
    const now = Date.now();
    for (let i = 0; i < 9; i++) consumeAgentRate(token.record.id, 'add_url', database, now);
    const addBefore = await rateUsed(token.record.id, 'add', now);
    const urlBefore = await rateUsed(token.record.id, 'add_url', now);
    const dayBefore = await rateUsed(token.record.id, 'add_day', now);

    const blocked = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      urls: [AMAZON_PRODUCT_URL, RAKUTEN_URL],
      name: 'レート超過',
    }, undefined, bearer(token.token));
    assert.equal(blocked.status, 429, blocked.text);

    assert.equal(
      (database.prepare("SELECT COUNT(*) AS n FROM items WHERE name = 'レート超過'").get() as { n: number }).n,
      0,
    );
    assert.equal(await rateUsed(token.record.id, 'add', now), addBefore);
    assert.equal(await rateUsed(token.record.id, 'add_url', now), urlBefore);
    assert.equal(await rateUsed(token.record.id, 'add_day', now), dayBefore);
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent multi-store: over URL cap is 400 and spends no rate units', () => serial(async () => {
  const { AGENT_RATE_LIMITS } = await import('../src/lib/agent-access-limits');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    await createMember('agent-ms-cap');
    const token = await createToken(['write'], 'ms-cap');
    const now = Date.now();
    const over = AGENT_RATE_LIMITS.add_url + 1;
    const urls = Array.from({ length: over }, (_, i) => `https://example.com/products/cap-${i}`);
    const blocked = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      urls,
      name: '上限超過',
    }, undefined, bearer(token.token));
    assert.equal(blocked.status, 400, blocked.text);
    assert.equal((blocked.json as { code: string }).code, 'INVALID_INPUT');

    const database = await db();
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS n FROM items WHERE name = '上限超過'").get() as { n: number }).n,
      0,
    );
    assert.equal(await rateUsed(token.record.id, 'add', now), 0);
    assert.equal(await rateUsed(token.record.id, 'add_url', now), 0);
    assert.equal(await rateUsed(token.record.id, 'add_day', now), 0);
  } finally {
    installProductFetchPort(null);
  }
}));

test('agent multi-store: attach to manual comparison group is 409 without writes or rate spend', () => serial(async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort(regressionFetchPort());
  try {
    const owner = await createMember('agent-ms-manual');
    const token = await createToken(['write'], 'ms-manual');
    const database = await db();
    const groupId = Number(database.prepare(
      `INSERT INTO comparison_groups (user_id, name, priority, origin) VALUES (?, '手のグループ', 3, NULL)`,
    ).run(owner.id).lastInsertRowid);
    const itemId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, priority, quantity, comparison_group_id)
      VALUES (?, '手動の本', 'https://example.com/products/manual-book', 3, 1, ?)
    `).run(owner.id, groupId).lastInsertRowid);

    const now = Date.now();
    const denied = await call(byUrlPath, 'POST', '/api/agent/v1/items/by-url', {
      item_id: itemId,
      url: AMAZON_PRODUCT_URL,
      name: '足せない',
    }, undefined, bearer(token.token));
    assert.equal(denied.status, 409, denied.text);
    assert.equal((denied.json as { code: string }).code, 'MANUAL_GROUP');
    assert.match((denied.json as { error: string }).error, /手/);

    const row = database.prepare(
      'SELECT comparison_group_id FROM items WHERE id = ?',
    ).get(itemId) as { comparison_group_id: number };
    assert.equal(row.comparison_group_id, groupId);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(owner.id) as { n: number }).n,
      1,
    );
    assert.equal(
      (database.prepare(
        "SELECT origin FROM comparison_groups WHERE id = ?",
      ).get(groupId) as { origin: string | null }).origin,
      null,
    );
    assert.equal(await rateUsed(token.record.id, 'add', now), 0);
    assert.equal(await rateUsed(token.record.id, 'add_url', now), 0);
    assert.equal(await rateUsed(token.record.id, 'add_day', now), 0);
  } finally {
    installProductFetchPort(null);
  }
}));
