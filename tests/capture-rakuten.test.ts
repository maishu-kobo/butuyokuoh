import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CaptureMessages, captureFailure, type CapturePorts, type SearchQuery } from '../src/lib/capture/contract';
import { createFakePorts, searchWithPorts } from '../src/lib/capture/fakes';
import {
  RAKUTEN_CREDIT,
  RAKUTEN_ENDPOINT,
  RAKUTEN_SEARCH_TIMEOUT_MS,
  RakutenMessages,
  createRakutenLimiter,
  createRakutenSearch,
  type RakutenHttp,
  type RakutenHttpRequest,
  type RakutenHttpResponse,
  type RakutenLimiter,
} from '../src/lib/capture/rakuten';

const SECRET = 'super-secret-access-key';
const APP_ID = 'app-123';
const JAN = '4900000000009';
const START = Date.parse('2026-10-22T00:00:00.000Z');
const query: SearchQuery = {
  name: 'テスト用ゲルボールペン 0.5',
  brand: '物欲文具',
  model: 'BY-05',
  jan: JAN,
};

function credentials() {
  return { applicationId: APP_ID, accessKey: SECRET };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    itemName: 'テスト用ゲルボールペン 0.5',
    itemPrice: 1200,
    itemUrl: 'https://item.rakuten.co.jp/example/pen',
    itemCode: 'example:pen',
    shopName: 'テスト楽天店',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): RakutenHttpResponse {
  return { status, body: JSON.stringify(body) };
}

function okHttp(body: unknown = { items: [item({ janCode: JAN })] }): RakutenHttp {
  return async () => jsonResponse(body);
}

function harness(options: {
  http?: RakutenHttp;
  credentials?: { applicationId: string; accessKey: string } | null;
  limiter?: RakutenLimiter;
  userId?: string;
  now?: () => Date;
  timeoutMs?: number;
  referer?: string | null;
} = {}) {
  const calls: RakutenHttpRequest[] = [];
  const http = options.http ?? okHttp();
  const search = createRakutenSearch({
    credentials: options.credentials === undefined ? credentials() : options.credentials,
    http: async request => {
      calls.push(request);
      return http(request);
    },
    limiter: options.limiter ?? createRakutenLimiter(),
    userId: options.userId,
    now: options.now,
    timeoutMs: options.timeoutMs,
    referer: options.referer,
  });
  return { search, calls };
}

test('Rakuten search sends the JAN as the only keyword and keeps the access key out of the URL', async () => {
  const { search, calls } = harness({ referer: 'https://butsuyokuoh.exe.xyz/' });
  const result = await search.search(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(calls.length, 1);
  const request = calls[0];
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, RAKUTEN_ENDPOINT);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('applicationId'), APP_ID);
  assert.equal(url.searchParams.get('keyword'), JAN);
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('formatVersion'), '2');
  assert.equal(url.searchParams.get('accessKey'), null);
  assert.equal(request.url.includes(SECRET), false);
  assert.equal(request.headers.accessKey, SECRET);
  assert.equal(request.headers.Referer, 'https://butsuyokuoh.exe.xyz/');
  assert.equal(request.method, 'GET');
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0].site, 'rakuten');
  assert.equal(result.value[0].id, 'rakuten:example-pen');
  assert.equal(result.value[0].price, 1200);
  assert.equal(result.value[0].jan, JAN);
  assert.equal(result.value[0].shopName, 'テスト楽天店');
  assert.equal(new URL(result.value[0].url).hostname, 'item.rakuten.co.jp');
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('without a JAN the keyword is the name, brand, and model, and a missing key does not call Rakuten', async () => {
  const named = harness();
  const result = await named.search.search({ name: 'ペン', brand: '物欲文具', model: null, jan: null });
  assert.equal(result.ok, true);
  assert.equal(new URL(named.calls[0].url).searchParams.get('keyword'), 'ペン 物欲文具');

  const longName = 'あ'.repeat(80);
  const truncated = harness();
  await truncated.search.search({ name: longName, brand: null, model: null, jan: null });
  const keyword = new URL(truncated.calls[0].url).searchParams.get('keyword') ?? '';
  assert.equal(Buffer.byteLength(keyword, 'utf8') <= 128, true);
  assert.equal(longName.startsWith(keyword), true);

  for (const missing of [null, { applicationId: '  ', accessKey: SECRET }, { applicationId: APP_ID, accessKey: '' }]) {
    const blocked = harness({ credentials: missing });
    const denied = await blocked.search.search(query);
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.error.code, 'SEARCH_NOT_CONFIGURED');
      assert.equal(denied.error.error, RakutenMessages.unavailable);
      assert.equal(denied.status, 503);
      assert.equal(denied.error.error.includes(SECRET), false);
    }
    assert.equal(blocked.calls.length, 0);
  }
});

test('an unavailable Rakuten key does not use up the rate limit', async () => {
  let clock = START;
  const limiter = createRakutenLimiter();
  const blocked = harness({ credentials: null, limiter, now: () => new Date(clock) });
  for (let count = 0; count < 10; count += 1) {
    const denied = await blocked.search.search(query);
    assert.equal(denied.ok, false);
  }
  const allowed = harness({ limiter, now: () => new Date(clock), http: okHttp() });
  for (let count = 0; count < 5; count += 1) {
    const result = await allowed.search.search(query);
    assert.equal(result.ok, true, `call ${count}`);
    clock += 1000;
  }
  assert.equal(allowed.calls.length, 5);
});

test('Rakuten answers are not retried, and an error is not an empty success', async () => {
  const statuses = harness({
    http: async () => jsonResponse({ error: 'system_error', error_description: 'api logic error' }, 500),
  });
  const failed = await statuses.search.search(query);
  assert.equal(statuses.calls.length, 1);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.error.code, 'SEARCH_FAILED');
    assert.equal(failed.error.error, RakutenMessages.failed);
    assert.equal(JSON.stringify(failed).includes('api logic error'), false);
    assert.equal(JSON.stringify(failed).includes(SECRET), false);
    assert.equal(JSON.stringify(failed).includes('item.rakuten.co.jp'), false);
  }

  const nested = harness({
    http: async () => jsonResponse({ errors: { errorCode: 'wrong_parameter', errorMessage: 'keyword parameter is not valid' } }, 400),
  });
  const invalid = await nested.search.search(query);
  assert.equal(nested.calls.length, 1);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.error, RakutenMessages.failed);
    assert.equal(JSON.stringify(invalid).includes('keyword parameter is not valid'), false);
  }

  const missing = harness({ http: async () => jsonResponse({ error: 'not_found', error_description: 'not found' }, 404) });
  const notFound = await missing.search.search(query);
  assert.equal(notFound.ok, false);

  const empty = harness({ http: async () => jsonResponse({ items: [] }) });
  const none = await empty.search.search(query);
  assert.equal(none.ok, true);
  if (none.ok) assert.deepEqual(none.value, []);

  const broken = harness({ http: async () => ({ status: 200, body: '{' }) });
  const unreadable = await broken.search.search(query);
  assert.equal(unreadable.ok, false);
  assert.equal(broken.calls.length, 1);
});

test('Rakuten drops unsafe item URLs and keeps a formatVersion 1 item', async () => {
  const { search } = harness({
    http: okHttp({
      Items: [
        { Item: item({ itemUrl: 'https://evil.example/pen', itemCode: 'evil:pen' }) },
        { Item: item({ itemCode: 'example:safe', mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/pen.jpg' }] }) },
        { Item: item({ itemCode: 'example:safe', itemUrl: 'https://item.rakuten.co.jp/example/other', itemPrice: 800 }) },
      ],
    }),
  });
  const result = await search.search(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.map(candidate => candidate.id), ['rakuten:example-safe', 'rakuten:example-safe-3']);
  assert.equal(JSON.stringify(result.value).includes('evil.example'), false);
  assert.equal(result.value[0].imageUrl, 'https://thumbnail.image.rakuten.co.jp/pen.jpg');
  assert.equal(result.value[0].price, 1200);
});

test('Rakuten rate limits are one per second, five per minute, and fifty per day, with no automatic retry', async () => {
  let clock = START;
  const limiter = createRakutenLimiter();
  const now = () => new Date(clock);
  let calls = 0;
  const http: RakutenHttp = async () => {
    calls += 1;
    return jsonResponse({ items: [item()] });
  };
  const user = (userId: string) => harness({ http, limiter, userId, now }).search;

  const first = await user('a').search(query);
  assert.equal(first.ok, true);
  const blockedGlobal = await user('b').search(query);
  assert.equal(blockedGlobal.ok, false);
  if (!blockedGlobal.ok) {
    assert.equal(blockedGlobal.error.error, RakutenMessages.globalRate);
    assert.equal(blockedGlobal.status, 429);
  }
  assert.equal(calls, 1);

  clock = START + 1000;
  const secondUser = await user('b').search(query);
  assert.equal(secondUser.ok, true);

  clock = START;
  const minute = harness({ http, limiter: createRakutenLimiter(), userId: 'solo', now });
  for (let count = 0; count < 5; count += 1) {
    const result = await minute.search.search(query);
    assert.equal(result.ok, true, `minute ${count}`);
    clock += 1000;
  }
  const sixth = await minute.search.search(query);
  assert.equal(sixth.ok, false);
  if (!sixth.ok) assert.equal(sixth.error.error, RakutenMessages.userMinute);

  clock = START + 60_000;
  const afterMinute = await minute.search.search(query);
  assert.equal(afterMinute.ok, true);

  clock = START;
  const day = harness({ http, limiter: createRakutenLimiter(), userId: 'day', now });
  for (let count = 0; count < 50; count += 1) {
    const result = await day.search.search(query);
    assert.equal(result.ok, true, `day ${count}`);
    clock += 60_000;
  }
  const fiftyFirst = await day.search.search(query);
  assert.equal(fiftyFirst.ok, false);
  if (!fiftyFirst.ok) assert.equal(fiftyFirst.error.error, RakutenMessages.userDay);
  const callsAfterCap = calls;
  const retried = await day.search.search(query);
  assert.equal(retried.ok, false);
  assert.equal(calls, callsAfterCap);

  clock = START + 24 * 60 * 60 * 1000;
  const nextDay = await day.search.search(query);
  assert.equal(nextDay.ok, true);
});

test('a Rakuten timeout or failure still returns the other site, and Amazon stays on www.amazon.co.jp', async () => {
  const portsFor = (rakutenHttp: RakutenHttp, yahooOk: boolean): CapturePorts => ({
    identifier: createFakePorts().identifier,
    yahoo: {
      async search() {
        if (!yahooOk) return captureFailure('SEARCH_FAILED', CaptureMessages.searchFailed, 502);
        const yahoo = await createFakePorts('default', () => new Date(START)).yahoo.search(query);
        return yahoo;
      },
    },
    rakuten: createRakutenSearch({
      credentials: credentials(),
      http: rakutenHttp,
      limiter: createRakutenLimiter(),
      now: () => new Date(START),
      timeoutMs: 100,
    }),
  });

  const rakutenDown = await searchWithPorts(
    query,
    portsFor(async () => jsonResponse({ error: 'system_error', error_description: 'api logic error' }, 500), true),
    null,
  );
  assert.equal(rakutenDown.ok, true);
  if (rakutenDown.ok) {
    assert.deepEqual(rakutenDown.value.candidates.map(candidate => candidate.site), ['yahoo']);
    assert.equal(rakutenDown.value.failures[0].site, 'rakuten');
    assert.equal(rakutenDown.value.failures[0].code, 'SEARCH_FAILED');
    assert.equal(rakutenDown.value.failures[0].error, RakutenMessages.failed);
    assert.equal(JSON.stringify(rakutenDown).includes('api logic error'), false);
  }

  const yahooDown = await searchWithPorts(
    query,
    portsFor(async () => jsonResponse({ items: [item({ janCode: JAN })] }), false),
    'test-tag-22',
  );
  assert.equal(yahooDown.ok, true);
  if (!yahooDown.ok) return;
  assert.deepEqual(yahooDown.value.candidates.map(candidate => candidate.site), ['rakuten']);
  assert.equal(yahooDown.value.failures[0].site, 'yahoo');
  const amazon = new URL(yahooDown.value.amazonUrl);
  assert.equal(amazon.protocol, 'https:');
  assert.equal(amazon.hostname, 'www.amazon.co.jp');
  assert.equal(amazon.pathname, '/s');
  assert.equal(amazon.searchParams.get('k'), JAN);
  assert.equal(amazon.searchParams.get('tag'), 'test-tag-22');
  assert.deepEqual([...amazon.searchParams.keys()].sort(), ['k', 'tag']);
  assert.equal(amazon.username, '');
  assert.equal(yahooDown.value.amazonUrl.includes('amazon.com'), false);

  const untagged = await searchWithPorts(
    { name: 'ペン', brand: null, model: null, jan: null },
    portsFor(async () => jsonResponse({ items: [item()] }), false),
    null,
  );
  assert.equal(untagged.ok, true);
  if (untagged.ok) {
    const plain = new URL(untagged.value.amazonUrl);
    assert.equal(plain.hostname, 'www.amazon.co.jp');
    assert.equal(plain.searchParams.get('k'), 'ペン');
    assert.equal(plain.searchParams.get('tag'), null);
    assert.deepEqual([...plain.searchParams.keys()], ['k']);
  }

  const both = await searchWithPorts(
    query,
    portsFor(async () => jsonResponse({ error: 'system_error', error_description: 'api logic error' }, 500), false),
    null,
  );
  assert.equal(both.ok, false);
  if (!both.ok) {
    assert.equal(both.error.code, 'SEARCH_FAILED');
    assert.deepEqual(both.error.failures?.map(failure => failure.site), ['yahoo', 'rakuten']);
  }
});

test('Rakuten search stops at the injected timeout and the default limit is 6 seconds', async () => {
  const slow: RakutenHttp = request => new Promise(resolve => {
    const timer = setTimeout(() => resolve(jsonResponse({ items: [] })), 2000);
    request.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(jsonResponse({ items: [] }));
    });
  });
  const { search, calls } = harness({ http: slow, timeoutMs: 30 });
  const started = Date.now();
  const result = await search.search(query);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'SEARCH_TIMEOUT');
    assert.equal(result.error.error, RakutenMessages.timeout);
    assert.equal(result.status, 504);
  }
  assert.equal(calls.length, 1);
  assert.equal(Date.now() - started < 1000, true);

  const scheduled: number[] = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    scheduled.push(ms ?? 0);
    return original(fn, 0, ...args);
  }) as typeof setTimeout;
  try {
    const hanging: RakutenHttp = request => new Promise(resolve => {
      request.signal.addEventListener('abort', () => resolve(jsonResponse({ items: [] })));
    });
    const timed = harness({ http: hanging });
    const timeout = await timed.search.search(query);
    assert.equal(timeout.ok, false);
    if (!timeout.ok) assert.equal(timeout.error.code, 'SEARCH_TIMEOUT');
    assert.equal(scheduled.includes(RAKUTEN_SEARCH_TIMEOUT_MS), true);
    assert.equal(RAKUTEN_SEARCH_TIMEOUT_MS, 6000);
  } finally {
    globalThis.setTimeout = original;
  }
});

test('Rakuten returns a rebuilt item.rakuten.co.jp URL and drops anything else', async () => {
  const upstream = 'https://user:secret@item.rakuten.co.jp:8443/example/pen?ref=1#section';
  const { search } = harness({
    http: okHttp({
      items: [
        item({ itemCode: 'example:good', itemUrl: 'https://ITEM.RAKUTEN.CO.JP/example/pen?ref=1#section' }),
        item({ itemCode: 'example:user', itemUrl: upstream }),
        item({ itemCode: 'example:port', itemUrl: 'https://item.rakuten.co.jp:8443/example/pen' }),
        item({ itemCode: 'example:break', itemUrl: 'https://item.rakuten.co.jp/example/pen\r\n@evil.example/' }),
        item({ itemCode: 'example:nul', itemUrl: 'https://item.rakuten.co.jp/example/pen\u0000@evil.example/' }),
        item({ itemCode: 'example:slash', itemUrl: 'https://item.rakuten.co.jp\\@evil.example/x' }),
        item({ itemCode: 'example:other', itemUrl: 'https://www.rakuten.co.jp/example/pen' }),
      ],
    }),
  });
  const result = await search.search(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.map(candidate => candidate.url), ['https://item.rakuten.co.jp/example/pen?ref=1']);
  assert.equal(result.value[0].url === 'https://ITEM.RAKUTEN.CO.JP/example/pen?ref=1#section', false);
  const body = JSON.stringify(result.value);
  assert.equal(body.includes('evil.example'), false);
  assert.equal(body.includes('secret'), false);
  assert.equal(body.includes(':8443'), false);
  assert.equal(body.includes('#'), false);
  assert.equal(body.includes('\\'), false);
  assert.equal(body.includes('\n'), false);
  assert.equal(body.includes('\u0000'), false);
  assert.equal(body.includes(upstream), false);
});

test('Referer and accessKey with CR, LF, or NUL are not sent', async () => {
  for (const bad of ['\r', '\n', '\0']) {
    const keyed = harness({ credentials: { applicationId: APP_ID, accessKey: `${SECRET}${bad}X-Injected: 1` } });
    const denied = await keyed.search.search(query);
    assert.equal(keyed.calls.length, 0, JSON.stringify(bad));
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.error, RakutenMessages.unavailable);
    assert.equal(JSON.stringify(denied).includes(SECRET), false);
    assert.equal(JSON.stringify(denied).includes('X-Injected'), false);

    const referred = harness({ referer: `https://butsuyokuoh.exe.xyz/${bad}X-Injected: 1` });
    const blocked = await referred.search.search(query);
    assert.equal(referred.calls.length, 0, JSON.stringify(bad));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error.error, RakutenMessages.unavailable);
    assert.equal(JSON.stringify(blocked).includes('X-Injected'), false);
  }

  for (const referer of ['http://butsuyokuoh.exe.xyz/', 'https://user:pw@butsuyokuoh.exe.xyz/', 'not-a-url']) {
    const blocked = harness({ referer });
    const denied = await blocked.search.search(query);
    assert.equal(blocked.calls.length, 0, referer);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.error, RakutenMessages.unavailable);
  }
});

test('Rakuten keeps every valid product when the one fallback id is already taken', async () => {
  // fast-check seed 20261022 を縮約した反例。code の slug が a-3 / a / a の順だと、
  // 3件目の代替 id `-{index+1}` が 1件目の id と重なって消えていた。
  const items = [
    { code: 'a-3', shop: 'shop0', name: 'first', price: 10 },
    { code: 'a', shop: 'shop1', name: 'second', price: 20 },
    { code: 'a', shop: 'shoplost', name: 'third', price: 30 },
  ];
  const { search } = harness({
    http: okHttp({
      items: items.map(entry => ({
        itemName: entry.name,
        shopName: entry.shop,
        itemUrl: `https://item.rakuten.co.jp/${entry.shop}/${entry.code}`,
        itemPrice: entry.price,
        itemCode: entry.code,
      })),
    }),
  });
  const result = await search.search(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.map(candidate => candidate.url), [
    'https://item.rakuten.co.jp/shop0/a-3',
    'https://item.rakuten.co.jp/shop1/a',
    'https://item.rakuten.co.jp/shoplost/a',
  ]);
  const ids = result.value.map(candidate => candidate.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 3);
  assert.deepEqual(ids.slice(0, 2), ['rakuten:a-3', 'rakuten:a']);
  for (const id of ids) assert.match(id, /^rakuten:[a-z0-9-]{1,64}$/);
});

test('Rakuten credit is the developers attribution and the client does not read env or call fetch', () => {
  assert.equal(RAKUTEN_CREDIT.label, 'Supported by Rakuten Developers');
  assert.equal(new URL(RAKUTEN_CREDIT.url).hostname, 'webservice.rakuten.co.jp');
  const source = readFileSync(new URL('../src/lib/capture/rakuten.ts', import.meta.url), 'utf8');
  assert.equal(/fetch\s*\(/.test(source), false);
  assert.equal(/process\.env/.test(source), false);
  assert.equal(source.includes(SECRET), false);
});
