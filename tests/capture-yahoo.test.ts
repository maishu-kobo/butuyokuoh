import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CaptureMessages, type SearchQuery } from '../src/lib/capture/contract';
import { createFakePorts, searchWithPorts } from '../src/lib/capture/fakes';
import {
  createYahooRateGate,
  createYahooSearch,
  type YahooFetch,
  type YahooRateGate,
  type YahooRequest,
  type YahooSchedule,
} from '../src/lib/capture/yahoo';

const APP_ID = 'test-app-id';
const NOW = Date.parse('2026-10-22T00:00:00.000Z');
const UNAVAILABLE = 'この店の検索は使えません。商品名を入れて手入力してください';
const TIMEOUT = '候補の取得が時間内に終わりませんでした';
const LIMITED_SECOND = '全体の検索は1秒に1回までです';
const LIMITED_MINUTE = '全体の検索は1分に25回までです';
const LIMITED_USER_MINUTE = 'この検索は1分に5回までです';
const LIMITED_USER_DAY = 'この検索は1日に50回までです';
const UPSTREAM_LIMITED = 'Yahoo!ショッピングの検索が制限されています';

const janQuery: SearchQuery = {
  name: 'テスト用ゲルボールペン 0.5',
  brand: '物欲文具',
  model: 'BY-05',
  jan: '4900000000009',
};
const nameQuery: SearchQuery = { name: 'ペン <太>', brand: '物欲文具', model: 'BY-05', jan: null };

function hit(overrides: Record<string, unknown> = {}) {
  return {
    name: 'テスト用ゲルボールペン 0.5',
    url: 'https://store.shopping.yahoo.co.jp/example/pen',
    code: 'example_pen',
    price: 980,
    janCode: '4900000000009',
    image: { medium: 'https://item-shopping.c.yimg.jp/i/g/example_pen' },
    seller: { name: 'テストショップ' },
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function harness(options: {
  appId?: string | null;
  userId?: string;
  gate?: YahooRateGate;
  clock?: { t: number };
  body?: unknown;
  status?: number;
  fetch?: YahooFetch;
  schedule?: YahooSchedule;
} = {}) {
  const calls: { url: string; init: YahooRequest }[] = [];
  const clock = options.clock ?? { t: NOW };
  const gate = options.gate ?? createYahooRateGate();
  const fetch: YahooFetch = options.fetch ?? (async (url, init) => {
    calls.push({ url, init });
    return json(options.body ?? { hits: [hit()] }, options.status ?? 200);
  });
  const search = createYahooSearch({
    appId: options.appId === undefined ? APP_ID : options.appId,
    userId: options.userId ?? 'user-1',
    gate,
    now: () => clock.t,
    fetch,
    schedule: options.schedule ?? (() => () => {}),
  });
  return { calls, clock, gate, search };
}

test('JAN search calls itemSearch with jan_code and keeps an allowed candidate', async () => {
  const original = globalThis.fetch;
  let leaked = 0;
  globalThis.fetch = (async () => {
    leaked += 1;
    throw new Error('network disabled');
  }) as typeof fetch;
  try {
    const { calls, search } = harness();
    const result = await search.search(janQuery);
    assert.equal(leaked, 0);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'shopping.yahooapis.jp');
    assert.equal(url.pathname, '/ShoppingWebService/V3/itemSearch');
    assert.equal(url.searchParams.get('appid'), APP_ID);
    assert.equal(url.searchParams.get('jan_code'), janQuery.jan);
    assert.equal(url.searchParams.has('query'), false);
    assert.equal(url.searchParams.get('results'), '10');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.length, 1);
    const item = result.value[0];
    assert.equal(item.id, 'yahoo:example-pen');
    assert.equal(item.site, 'yahoo');
    assert.equal(item.title, 'テスト用ゲルボールペン 0.5');
    assert.equal(item.price, 980);
    assert.equal(item.url, 'https://store.shopping.yahoo.co.jp/example/pen');
    assert.equal(item.shopName, 'テストショップ');
    assert.equal(item.jan, janQuery.jan);
    assert.equal(item.fetchedAt, '2026-10-22T00:00:00.000Z');
    assert.equal(item.imageUrl, undefined);
    assert.equal(JSON.stringify(item).includes('yimg.jp'), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('name search sends the escaped keyword and does not send jan_code', async () => {
  const { calls, search } = harness({
    body: { hits: [hit({ name: 'ペン <script>alert(1)</script> & "特"', janCode: '', seller: { name: '店<A>' } })] },
  });
  const result = await search.search(nameQuery);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('query'), 'ペン <太> 物欲文具 BY-05');
  assert.equal(url.searchParams.has('jan_code'), false);
  assert.equal(calls[0].url.includes('<'), false);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  const item = result.value[0];
  assert.equal(item.title.includes('<'), false);
  assert.equal(item.title.includes('alert(1)'), true);
  assert.equal(item.title.includes('&'), true);
  assert.equal(item.title.includes('&amp;'), false);
  assert.equal(item.shopName.includes('<'), false);
  assert.equal(item.shopName.includes('店'), true);
  assert.equal('jan' in item, false);
});

test('an invalid JAN falls back to the name, and an empty query does not call', async () => {
  const { calls, search } = harness();
  const fallback = await search.search({ name: 'ペン', brand: null, model: null, jan: '4900000000008' });
  assert.equal(fallback.ok, true);
  assert.equal(new URL(calls[0].url).searchParams.get('query'), 'ペン');
  assert.equal(new URL(calls[0].url).searchParams.has('jan_code'), false);

  const empty = await search.search({ name: '  ', brand: null, model: null, jan: null });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.error.code, 'INVALID_INPUT');
    assert.equal(empty.error.error, CaptureMessages.searchInput);
    assert.equal(empty.status, 400);
  }
  assert.equal(calls.length, 1);
});

test('a missing app id makes Yahoo unavailable and does not hide Rakuten', async () => {
  const { calls, search } = harness({ appId: '   ' });
  const missing = await search.search(janQuery);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.code, 'SEARCH_FAILED');
    assert.equal(missing.error.error, UNAVAILABLE);
    assert.equal(missing.status, 503);
  }
  assert.equal(calls.length, 0);

  const ports = createFakePorts('default', () => new Date(NOW));
  ports.yahoo = search;
  const found = await searchWithPorts(janQuery, ports, null);
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(found.value.candidates.map(item => item.site), ['rakuten']);
  assert.equal(found.value.failures[0].site, 'yahoo');
  assert.equal(found.value.failures[0].error, UNAVAILABLE);
});

test('global and per-user limits stop further calls without another request', async () => {
  const clock = { t: 0 };
  const gate = createYahooRateGate();
  const { calls, search } = harness({ clock, gate, userId: 'user-a' });
  const other = harness({ clock, gate, userId: 'user-b' });

  const first = await search.search(nameQuery);
  assert.equal(first.ok, true);
  const sameSecond = await other.search.search(nameQuery);
  assert.equal(sameSecond.ok, false);
  if (!sameSecond.ok) assert.equal(sameSecond.error.error, LIMITED_SECOND);
  assert.equal(calls.length + other.calls.length, 1);

  clock.t = 1_000;
  for (let i = 0; i < 4; i += 1) {
    const result = await search.search(nameQuery);
    assert.equal(result.ok, true, String(i));
    clock.t += 1_000;
  }
  const userLimited = await search.search(nameQuery);
  assert.equal(userLimited.ok, false);
  if (!userLimited.ok) assert.equal(userLimited.error.error, LIMITED_USER_MINUTE);
  const beforeOther = calls.length + other.calls.length;
  const otherOk = await other.search.search(nameQuery);
  assert.equal(otherOk.ok, true);
  assert.equal(calls.length + other.calls.length, beforeOther + 1);

  const burstClock = { t: 10_000 };
  const burstGate = createYahooRateGate();
  let burstCalls = 0;
  const burstFetch: YahooFetch = async () => {
    burstCalls += 1;
    return json({ hits: [hit()] });
  };
  for (let i = 0; i < 25; i += 1) {
    const burst = harness({ clock: burstClock, gate: burstGate, userId: `burst-${i}`, fetch: burstFetch });
    const result = await burst.search.search(nameQuery);
    assert.equal(result.ok, true, `burst ${i}`);
    burstClock.t += 1_000;
  }
  const minute = await harness({
    clock: burstClock,
    gate: burstGate,
    userId: 'burst-extra',
    fetch: burstFetch,
  }).search.search(nameQuery);
  assert.equal(minute.ok, false);
  if (!minute.ok) assert.equal(minute.error.error, LIMITED_MINUTE);
  assert.equal(burstCalls, 25);

  const dayClock = { t: 0 };
  const day = harness({ clock: dayClock, userId: 'day-user' });
  for (let i = 0; i < 50; i += 1) {
    const result = await day.search.search(nameQuery);
    assert.equal(result.ok, true, `day ${i}`);
    dayClock.t += 60_000;
  }
  const capped = await day.search.search(nameQuery);
  assert.equal(capped.ok, false);
  if (!capped.ok) assert.equal(capped.error.error, LIMITED_USER_DAY);
  assert.equal(day.calls.length, 50);
});

test('parallel searches still allow only one request per second', async () => {
  const { calls, search } = harness({ clock: { t: 0 } });
  const [left, right] = await Promise.all([search.search(nameQuery), search.search(nameQuery)]);
  assert.equal([left, right].filter(result => result.ok).length, 1);
  assert.equal(calls.length, 1);
});

test('a request is aborted at 6 seconds and is not sent again', async () => {
  const calls: string[] = [];
  let cancelled = false;
  const { search } = harness({
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, 6_000);
      callback();
      return () => { cancelled = true; };
    },
    fetch: async (_url, init) => {
      calls.push('once');
      if (init.signal.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return json({ hits: [hit()] });
    },
  });
  const timedOut = await search.search(nameQuery);
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) {
    assert.equal(timedOut.error.code, 'SEARCH_TIMEOUT');
    assert.equal(timedOut.error.error, TIMEOUT);
    assert.equal(timedOut.status, 504);
  }
  assert.deepEqual(calls, ['once']);
  assert.equal(cancelled, true);
});

test('failures are not retried and the app id stays out of the error', async () => {
  const secret = 'super-secret-app-id';
  const cases: { status?: number; body?: unknown; throwMessage?: string; location?: string }[] = [
    { status: 500, body: { Error: { Message: secret } } },
    { status: 429, body: { Error: { Message: 'rate' } } },
    { status: 302, location: 'http://169.254.169.254/latest' },
    { body: '{not json' },
  ];
  for (const item of cases) {
    const calls: string[] = [];
    const { search } = harness({
      appId: secret,
      fetch: async () => {
        calls.push('fetch');
        if (item.throwMessage) throw new Error(item.throwMessage);
        if (item.body === '{not json') return new Response('{not json', { status: 200 });
        return new Response(JSON.stringify(item.body ?? {}), {
          status: item.status ?? 200,
          headers: item.location ? { Location: item.location } : undefined,
        });
      },
    });
    const result = await search.search(nameQuery);
    assert.equal(calls.length, 1, JSON.stringify(item));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(JSON.stringify(result).includes(secret), false);
      assert.equal(JSON.stringify(result).includes('169.254.169.254'), false);
      if (item.status === 429) assert.equal(result.error.error, UPSTREAM_LIMITED);
      else assert.equal(result.error.error, CaptureMessages.searchFailed);
    }
  }

  const thrown = harness({
    appId: secret,
    fetch: async () => {
      throw new Error(`getaddrinfo appid=${secret}`);
    },
  });
  const failed = await thrown.search.search(nameQuery);
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes(secret), false);
});

test('only https links on the Yahoo shopping hosts are returned', async () => {
  const { search } = harness({
    body: {
      hits: [
        hit({ url: 'http://store.shopping.yahoo.co.jp/example/pen', code: 'http_pen' }),
        hit({ url: 'https://user:secret@store.shopping.yahoo.co.jp/example/pen', code: 'user_pen' }),
        hit({ url: 'https://evil.example/pen', code: 'evil_pen' }),
        hit({ url: 'https://shopping.yahoo.co.jp.evil.example/pen', code: 'suffix_pen' }),
        hit({ url: 'https://shopping.yahoo.co.jp/products/example', code: 'Good_Item', price: 1200, name: '良い商品' }),
        hit({ price: '980', code: 'string_price' }),
      ],
    },
  });
  const result = await search.search(nameQuery);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.map(item => item.id), ['yahoo:good-item']);
  assert.equal(result.value[0].url, 'https://shopping.yahoo.co.jp/products/example');
  assert.equal(JSON.stringify(result.value).includes('evil.example'), false);
  assert.equal(JSON.stringify(result.value).includes('secret'), false);
});

test('an empty hit list is an empty success, and unusable hits are a failure', async () => {
  const empty = harness({ body: { totalResultsReturned: 0, hits: [] } });
  const none = await empty.search.search(nameQuery);
  assert.equal(none.ok, true);
  if (none.ok) assert.deepEqual(none.value, []);

  const bad = harness({ body: { hits: [hit({ url: 'https://evil.example/pen' })] } });
  const failed = await bad.search.search(nameQuery);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error.code, 'SEARCH_FAILED');
});

test('yahoo search does not read the environment or the secrets loader', () => {
  const source = readFileSync(new URL('../src/lib/capture/yahoo.ts', import.meta.url), 'utf8');
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/YAHOO_SHOPPING_APP_ID/.test(source), false);
  assert.equal(/capture-secrets/.test(source), false);
  assert.equal(source.includes('https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch'), true);
});

test('a keyword with reserved characters stays inside the query parameter', async () => {
  const { calls, search } = harness();
  await search.search({ name: 'a&b=c\nペン', brand: null, model: null, jan: null });
  const url = new URL(calls[0].url);
  assert.equal(url.hostname, 'shopping.yahooapis.jp');
  assert.equal(url.searchParams.get('query'), 'a&b=c\nペン');
  assert.deepEqual([...url.searchParams.keys()], ['appid', 'results', 'query']);
  assert.equal(calls[0].url.includes('\n'), false);
  assert.equal(calls[0].url.includes('&b=c'), false);
});

test('an app id with a line break is not requested and is not logged', async () => {
  const secret = 'super-secret-app-id';
  const logs: unknown[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const original = Object.fromEntries(methods.map(method => [method, console[method]]));
  for (const method of methods) {
    console[method] = (...args: unknown[]) => { logs.push(args); };
  }
  try {
    const blocked = harness({ appId: `${secret}\r\nX-Injected: 1` });
    const denied = await blocked.search.search(nameQuery);
    assert.equal(blocked.calls.length, 0);
    assert.equal(denied.ok, false);
    assert.equal(JSON.stringify(denied).includes(secret), false);

    const { calls, search } = harness({ appId: secret });
    const result = await search.search(nameQuery);
    assert.equal(result.ok, true);
    assert.equal(calls[0].url.includes(secret), true);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(logs).includes(secret), false);
  } finally {
    for (const method of methods) console[method] = original[method];
  }
});

test('yahoo returns only a rebuilt https url on the shopping hosts', async () => {
  const { search } = harness({
    body: {
      hits: [
        hit({ code: 'good_item', url: 'https://shopping.yahoo.co.jp/products/example?ref=1' }),
        hit({ code: 'newline_item', url: 'https://store.shopping.yahoo.co.jp/example/pen\n@evil.example/' }),
        hit({ code: 'port_item', url: 'https://store.shopping.yahoo.co.jp:8443/example/pen' }),
        hit({
          code: 'slash_item',
          url: 'https://store.shopping.yahoo.co.jp\\@evil.example/x',
          image: { medium: 'https://shopping.yahoo.co.jp/a.jpg\n@evil.example/x' },
        }),
      ],
    },
  });
  const result = await search.search(nameQuery);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.map(item => item.url), ['https://shopping.yahoo.co.jp/products/example?ref=1']);
  assert.equal(JSON.stringify(result.value).includes('evil.example'), false);
  assert.equal(JSON.stringify(result.value).includes(':8443'), false);
  assert.equal(JSON.stringify(result.value).includes('\\'), false);
  assert.equal('imageUrl' in result.value[0], false);
});

test('yahoo returns at most ten hits from one response', async () => {
  const hits = Array.from({ length: 11 }, (_, index) => hit({
    code: `item_${index}`,
    name: `商品${index}`,
    url: 'https://shopping.yahoo.co.jp/products/example',
  }));
  const { search } = harness({ body: { hits } });
  const result = await search.search(nameQuery);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 10);
  assert.equal(result.value.some(item => item.id === 'yahoo:item-10'), false);
});

test('yahoo stops reading an oversized body even when content-length is small', async () => {
  let pulled = 0;
  const chunk = new Uint8Array(200_000);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > 12) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const { search } = harness({
    fetch: async () => new Response(stream, { status: 200, headers: { 'content-length': '10' } }),
  });
  const result = await search.search(nameQuery);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.error, CaptureMessages.searchFailed);
  assert.equal(pulled <= 8, true, `pulled ${pulled}`);
});

test('yahoo stops even when fetch ignores the abort signal', async () => {
  const { search } = harness({
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, 6_000);
      const timer = setTimeout(callback, 15);
      return () => clearTimeout(timer);
    },
    fetch: () => new Promise(() => {}),
  });
  const result = await Promise.race([
    search.search(nameQuery),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hung')), 300)),
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'SEARCH_TIMEOUT');
    assert.equal(result.status, 504);
    assert.equal(result.error.error, TIMEOUT);
  }
});
