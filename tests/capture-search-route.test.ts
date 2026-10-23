import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { createMember, db, setTestUser } from './regression-harness';
import { CaptureMessages } from '../src/lib/capture/contract';
import { installSearchTransportForTests } from '../src/lib/capture/live-search';
import { createYahooRateGate, type YahooFetch } from '../src/lib/capture/yahoo';
import { RAKUTEN_ENDPOINT, createRakutenLimiter, type RakutenHttp, type RakutenHttpRequest } from '../src/lib/capture/rakuten';
import { registerCapturedCandidates } from '../src/lib/capture/register';
import { POST as searchPost } from '../src/app/api/capture/search/route';

const YAHOO_APP_ID = 'test-app-id';
const RAKUTEN_APP_ID = 'app-123';
const ACCESS_KEY = 'super-secret-access-key';
const ASSOCIATE = 'test-tag-22';
const NOW = Date.parse('2026-10-22T00:00:00.000Z');
const JAN = '4900000000009';
const SECRET_NAMES = ['YAHOO_SHOPPING_APP_ID', 'RAKUTEN_APP_ID', 'RAKUTEN_ACCESS_KEY', 'AMAZON_ASSOCIATE_TAG', 'CAPTURE_SECRETS_FILE'] as const;

type YahooCall = { url: string };
type Transport = {
  yahoo?: YahooFetch;
  rakuten?: RakutenHttp;
  yahooSchedule?: (callback: () => void, delayMs: number) => () => void;
  rakutenTimeoutMs?: number;
};

function yahooHit() {
  return {
    name: 'テスト用ゲルボールペン 0.5',
    url: 'https://store.shopping.yahoo.co.jp/example/pen',
    code: 'example_pen',
    price: 980,
    janCode: JAN,
    image: { medium: 'https://store.shopping.yahoo.co.jp/example/pen.jpg' },
    seller: { name: 'テストショップ' },
  };
}

function rakutenItem() {
  return {
    itemName: 'テスト用ゲルボールペン 0.5',
    itemPrice: 1200,
    itemUrl: 'https://item.rakuten.co.jp/example/pen',
    itemCode: 'example:pen',
    shopName: 'テスト楽天店',
    janCode: JAN,
    mediumImageUrls: ['https://item.rakuten.co.jp/example/pen.jpg'],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function install(transport: Transport = {}) {
  const yahooCalls: YahooCall[] = [];
  const rakutenCalls: RakutenHttpRequest[] = [];
  const yahooFetch: YahooFetch = transport.yahoo ?? (async () => jsonResponse({ hits: [yahooHit()] }));
  const rakutenHttp: RakutenHttp = transport.rakuten ?? (async () => ({ status: 200, body: JSON.stringify({ items: [rakutenItem()] }) }));
  installSearchTransportForTests({
    yahooFetch: async (url, init) => {
      yahooCalls.push({ url });
      return yahooFetch(url, init);
    },
    yahooGate: createYahooRateGate(),
    yahooSchedule: transport.yahooSchedule,
    rakutenHttp: async (request) => {
      rakutenCalls.push(request);
      return rakutenHttp(request);
    },
    rakutenLimiter: createRakutenLimiter(),
    rakutenTimeoutMs: transport.rakutenTimeoutMs,
    now: () => new Date(NOW),
  });
  return { yahooCalls, rakutenCalls };
}

function searchRequest(body: unknown, origin = 'https://example.test') {
  return new NextRequest(`${origin}/api/capture/search`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const name of Object.keys(values)) {
    previous.set(name, process.env[name]);
    const next = values[name];
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  }
  try {
    await fn();
  } finally {
    for (const [name, prior] of previous) {
      if (prior === undefined) delete process.env[name];
      else process.env[name] = prior;
    }
    installSearchTransportForTests(null);
    await setTestUser(null);
  }
}

function liveEnv(extra: Record<string, string | undefined> = {}) {
  return {
    CAPTURE_ENABLED: 'true',
    CAPTURE_TEST_HOOKS: undefined,
    CAPTURE_SECRETS_FILE: undefined,
    YAHOO_SHOPPING_APP_ID: YAHOO_APP_ID,
    RAKUTEN_APP_ID: RAKUTEN_APP_ID,
    RAKUTEN_ACCESS_KEY: ACCESS_KEY,
    AMAZON_ASSOCIATE_TAG: ASSOCIATE,
    ...extra,
  };
}

function candidateRows(database: Awaited<ReturnType<typeof db>>, userId: number) {
  return database.prepare(
    `SELECT id, source, source_name, shop_name, name, url, image_url, price, source_item_code, price_fetched_at, jan, capture_id, expires_at
     FROM capture_candidates WHERE user_id = ? ORDER BY id`,
  ).all(userId) as Record<string, unknown>[];
}

test('search calls Yahoo and Rakuten, keeps the Amazon link, and stores the candidates', async () => {
  const database = await db();
  const owner = await createMember('search-owner');
  const other = await createMember('search-other');
  const logs: unknown[][] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const original = Object.fromEntries(methods.map((method) => [method, console[method]])) as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { logs.push(args); };
  }
  try {
    await withEnv(liveEnv(), async () => {
      await setTestUser(owner);
      const { yahooCalls, rakutenCalls } = install();
      const response = await searchPost(searchRequest({
        name: 'テスト用ゲルボールペン 0.5',
        brand: '物欲文具',
        model: 'BY-05',
        jan: JAN,
      }));
      assert.equal(response.status, 200);
      const body = await response.json() as {
        captureId: number;
        amazonUrl: string;
        failures: unknown[];
        candidates: { id: string; candidateId: number; site: string; price: number; url: string; jan: string }[];
      };
      assert.deepEqual(body.failures, []);
      assert.deepEqual(body.candidates.map((item) => item.site), ['yahoo', 'rakuten']);
      assert.equal(body.candidates[0].id, 'yahoo:example-pen');
      assert.equal(body.candidates[1].id, 'rakuten:example-pen');
      const amazon = new URL(body.amazonUrl);
      assert.equal(amazon.hostname, 'www.amazon.co.jp');
      assert.equal(amazon.pathname, '/s');
      assert.equal(amazon.searchParams.get('k'), JAN);
      assert.equal(amazon.searchParams.get('tag'), ASSOCIATE);

      assert.equal(yahooCalls.length, 1);
      const yahooUrl = new URL(yahooCalls[0].url);
      assert.equal(yahooUrl.origin + yahooUrl.pathname, 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch');
      assert.equal(yahooUrl.searchParams.get('appid'), YAHOO_APP_ID);
      assert.equal(yahooUrl.searchParams.get('jan_code'), JAN);
      assert.equal(yahooUrl.searchParams.get('results'), '10');
      assert.equal(rakutenCalls.length, 1);
      const rakutenUrl = new URL(rakutenCalls[0].url);
      assert.equal(`${rakutenUrl.origin}${rakutenUrl.pathname}`, RAKUTEN_ENDPOINT);
      assert.equal(rakutenUrl.searchParams.get('applicationId'), RAKUTEN_APP_ID);
      assert.equal(rakutenUrl.searchParams.get('keyword'), JAN);
      assert.equal(rakutenUrl.searchParams.get('accessKey'), null);
      assert.equal(rakutenCalls[0].headers.accessKey, ACCESS_KEY);
      assert.equal(rakutenCalls[0].headers.Referer, 'https://example.test');

      const capture = database.prepare(
        'SELECT id, user_id, estimated_name, jan, status FROM captures WHERE id = ?',
      ).get(body.captureId) as { id: number; user_id: number; estimated_name: string; jan: string; status: string };
      assert.equal(capture.user_id, owner.id);
      assert.equal(capture.estimated_name, 'テスト用ゲルボールペン 0.5');
      assert.equal(capture.jan, JAN);
      assert.equal(capture.status, 'open');
      const rows = candidateRows(database, owner.id);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.source_item_code), ['yahoo:example-pen', 'rakuten:example-pen']);
      assert.equal(rows[0].source, 'yahoo');
      assert.equal(rows[0].source_name, 'Yahoo!ショッピング');
      assert.equal(rows[0].shop_name, 'テストショップ');
      assert.equal(rows[0].price, 980);
      assert.equal(rows[0].url, 'https://store.shopping.yahoo.co.jp/example/pen');
      assert.equal(rows[0].image_url, 'https://store.shopping.yahoo.co.jp/example/pen.jpg');
      assert.equal(rows[0].price_fetched_at, new Date(NOW).toISOString());
      assert.equal(rows[0].jan, JAN);
      assert.equal(rows[0].capture_id, body.captureId);
      assert.ok(Number(rows[0].expires_at) > NOW);
      assert.equal(rows[1].source, 'rakuten');
      assert.equal(rows[1].source_name, '楽天');
      assert.equal(rows[1].shop_name, 'テスト楽天店');
      assert.equal(rows[1].price, 1200);
      assert.equal(rows[1].url, 'https://item.rakuten.co.jp/example/pen');
      assert.equal(rows[1].image_url, 'https://item.rakuten.co.jp/example/pen.jpg');
      assert.deepEqual(body.candidates.map((item) => item.candidateId), rows.map((row) => Number(row.id)));
      assert.equal(candidateRows(database, other.id).length, 0);

      const registered = registerCapturedCandidates(database, owner.id, body.candidates.map((item) => item.candidateId));
      assert.equal(registered.ok, true);
      if (registered.ok) assert.equal(registered.itemIds.length, 2);

      const leaked = JSON.stringify({ body, logs });
      assert.equal(leaked.includes(ACCESS_KEY), false);
      assert.equal(leaked.includes(YAHOO_APP_ID), false);
      assert.equal(leaked.includes(RAKUTEN_APP_ID), false);
    });
  } finally {
    for (const method of methods) console[method] = original[method];
  }
});

test('a Yahoo failure still stores Rakuten candidates and the Amazon link, and is not retried', async () => {
  const database = await db();
  const owner = await createMember('search-partial');
  await withEnv(liveEnv(), async () => {
    await setTestUser(owner);
    let yahooCalls = 0;
    const { rakutenCalls } = install({
      yahoo: async () => {
        yahooCalls += 1;
        throw new Error('yahoo down');
      },
    });
    const before = candidateRows(database, owner.id).length;
    const response = await searchPost(searchRequest({ name: 'ペン', jan: JAN }));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      amazonUrl: string;
      failures: { site: string }[];
      candidates: { site: string; candidateId: number }[];
    };
    assert.equal(yahooCalls, 1);
    assert.equal(rakutenCalls.length, 1);
    assert.deepEqual(body.candidates.map((item) => item.site), ['rakuten']);
    assert.deepEqual(body.failures.map((failure) => failure.site), ['yahoo']);
    assert.equal(new URL(body.amazonUrl).hostname, 'www.amazon.co.jp');
    const rows = candidateRows(database, owner.id);
    assert.equal(rows.length, before + 1);
    assert.equal(rows[0].source, 'rakuten');
    assert.equal(body.candidates[0].candidateId, Number(rows[0].id));
  });
});

test('timeouts from both shops fail once, store nothing, and still hide the keys', async () => {
  const database = await db();
  const owner = await createMember('search-timeout');
  await withEnv(liveEnv(), async () => {
    await setTestUser(owner);
    let yahooCalls = 0;
    let rakutenCalls = 0;
    install({
      yahoo: () => {
        yahooCalls += 1;
        return new Promise(() => undefined);
      },
      rakuten: () => {
        rakutenCalls += 1;
        return new Promise(() => undefined);
      },
      yahooSchedule: (callback) => {
        callback();
        return () => undefined;
      },
      rakutenTimeoutMs: 20,
    });
    const response = await searchPost(searchRequest({ name: 'ペン' }));
    const body = await response.json() as { code: string; error: string; candidates?: unknown };
    assert.equal(response.status, 504);
    assert.equal(body.code, 'SEARCH_TIMEOUT');
    assert.equal(body.error, CaptureMessages.searchFailed);
    assert.equal(body.candidates, undefined);
    assert.equal(yahooCalls, 1);
    assert.equal(rakutenCalls, 1);
    assert.equal(candidateRows(database, owner.id).length, 0);
    assert.equal(JSON.stringify(body).includes(ACCESS_KEY), false);
  });
});

test('missing shop keys do not call the shops or throw', async () => {
  const database = await db();
  const owner = await createMember('search-nokey');
  await withEnv(liveEnv({
    YAHOO_SHOPPING_APP_ID: undefined,
    RAKUTEN_APP_ID: undefined,
    RAKUTEN_ACCESS_KEY: undefined,
    AMAZON_ASSOCIATE_TAG: undefined,
  }), async () => {
    await setTestUser(owner);
    const { yahooCalls, rakutenCalls } = install();
    const response = await searchPost(searchRequest({ name: 'ペン' }));
    const body = await response.json() as { code: string; error: string };
    assert.equal(response.status, 503);
    assert.equal(body.code, 'SEARCH_NOT_CONFIGURED');
    assert.equal(body.error, CaptureMessages.searchUnconfigured);
    assert.equal(body.error.includes('もう一度'), false);
    assert.equal(yahooCalls.length, 0);
    assert.equal(rakutenCalls.length, 0);
    assert.equal(candidateRows(database, owner.id).length, 0);
    assert.equal(JSON.stringify(body).includes('YAHOO_SHOPPING_APP_ID'), false);
  });
});

test('one configured shop still returns candidates when the other key is missing', async () => {
  const database = await db();
  const owner = await createMember('search-one-key');
  await withEnv(liveEnv({
    RAKUTEN_APP_ID: undefined,
    RAKUTEN_ACCESS_KEY: undefined,
  }), async () => {
    await setTestUser(owner);
    const { yahooCalls, rakutenCalls } = install();
    const response = await searchPost(searchRequest({ name: 'ペン', jan: JAN }));
    const body = await response.json() as {
      code?: string;
      error?: string;
      candidates: { site: string }[];
      failures: { code: string; site: string }[];
    };
    assert.equal(response.status, 200);
    assert.equal(body.code, undefined);
    assert.equal(body.error, undefined);
    assert.deepEqual(body.candidates.map((item) => item.site), ['yahoo']);
    assert.deepEqual(body.failures.map((failure) => failure.site), ['rakuten']);
    assert.equal(body.failures[0].code, 'SEARCH_NOT_CONFIGURED');
    assert.equal(yahooCalls.length, 1);
    assert.equal(rakutenCalls.length, 0);
    assert.equal(candidateRows(database, owner.id).length, 1);
  });
});

test('the test scenario still uses fakes and does not call the shop transports', async () => {
  const database = await db();
  const owner = await createMember('search-fake');
  await withEnv(liveEnv({ CAPTURE_TEST_HOOKS: '1' }), async () => {
    await setTestUser(owner);
    let called = 0;
    install({
      yahoo: async () => {
        called += 1;
        throw new Error('live yahoo');
      },
      rakuten: async () => {
        called += 1;
        throw new Error('live rakuten');
      },
    });
    const response = await searchPost(searchRequest({ name: 'ペン', jan: JAN }));
    assert.equal(response.status, 200);
    const body = await response.json() as { candidates: { id: string; candidateId: number }[]; amazonUrl: string };
    assert.equal(called, 0);
    assert.deepEqual(body.candidates.map((item) => item.id), ['yahoo:fake-pen', 'rakuten:fake-pen']);
    assert.equal(new URL(body.amazonUrl).hostname, 'www.amazon.co.jp');
    const rows = candidateRows(database, owner.id);
    assert.deepEqual(rows.map((row) => row.source_item_code), ['yahoo:fake-pen', 'rakuten:fake-pen']);
    assert.deepEqual(body.candidates.map((item) => item.candidateId), rows.map((row) => Number(row.id)));
  });
});

test('search wiring does not put secret names or logs in the route', () => {
  const route = readFileSync('src/app/api/capture/search/route.ts', 'utf8');
  const live = readFileSync('src/lib/capture/live-search.ts', 'utf8');
  assert.match(route, /resolveSearchPorts\(/);
  assert.match(route, /saveSearchCandidates\(/);
  assert.match(live, /createYahooSearch\(/);
  assert.match(live, /createRakutenSearch\(/);
  for (const name of SECRET_NAMES) {
    assert.equal(route.includes(name), false, name);
    assert.equal(live.includes(name), false, name);
  }
  assert.equal(route.includes('console.'), false);
  assert.equal(live.includes('console.'), false);
});
