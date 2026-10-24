import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureMessages, type SearchQuery } from '../src/lib/capture/contract';
import { statusAfterSearch } from '../src/lib/capture/capture-flow';
import { createYahooRateGate, createYahooSearch, type YahooFetch } from '../src/lib/capture/yahoo';
import {
  createRakutenLimiter,
  createRakutenSearch,
  type RakutenHttp,
  type RakutenHttpResponse,
} from '../src/lib/capture/rakuten';

const YAHOO_APP_ID = 'yahoo-app-id';
const RAKUTEN_APP_ID = 'rakuten-app-id';
const RAKUTEN_ACCESS_KEY = 'rakuten-access-key';
const NOW = Date.parse('2026-10-22T00:00:00.000Z');
const JAN = '4900000000009';

const MNEMOSYNE: SearchQuery = {
  name: 'Mnemosyne',
  brand: 'human',
  model: 'A5',
  jan: null,
};

function yahooHit() {
  return {
    name: 'マルマン ニーモシネ A5',
    url: 'https://store.shopping.yahoo.co.jp/example/mnemosyne',
    code: 'mnemosyne_a5',
    price: 980,
    image: { medium: 'https://item-shopping.c.yimg.jp/i/g/mnemosyne_a5' },
    seller: { name: 'テストショップ' },
  };
}

function rakutenItem() {
  return {
    itemName: 'マルマン ニーモシネ A5',
    itemPrice: 1200,
    itemUrl: 'https://item.rakuten.co.jp/example/mnemosyne',
    itemCode: 'example:mnemosyne',
    shopName: 'テスト楽天店',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rakutenResponse(body: unknown, status = 200): RakutenHttpResponse {
  return { status, body: JSON.stringify(body) };
}

async function withInfo(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(' '));
  };
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return lines;
}

function logEvents(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function assertLogShape(event: Record<string, unknown>) {
  assert.deepEqual(Object.keys(event).sort(), ['errorCode', 'hitCount', 'httpStatus', 'provider']);
}

test('zero hits for Mnemosyne human A5 are searched again as Mnemosyne A5 and then stop', async () => {
  const yahooQueries: string[] = [];
  const rakutenKeywords: string[] = [];
  const lines = await withInfo(async () => {
    const yahoo = createYahooSearch({
      appId: YAHOO_APP_ID,
      userId: 'mnemosyne',
      gate: createYahooRateGate(),
      now: () => NOW,
      schedule: () => () => {},
      fetch: (async (url) => {
        const query = new URL(url).searchParams.get('query') ?? '';
        yahooQueries.push(query);
        if (query === 'Mnemosyne A5') return jsonResponse({ hits: [yahooHit()] });
        return jsonResponse({ hits: [] });
      }) as YahooFetch,
    });
    const rakutenCalls: string[] = [];
    const rakuten = createRakutenSearch({
      credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
      limiter: createRakutenLimiter(),
      userId: 'mnemosyne',
      now: () => new Date(NOW),
      http: (async (request) => {
        const keyword = new URL(request.url).searchParams.get('keyword') ?? '';
        rakutenCalls.push(keyword);
        rakutenKeywords.push(keyword);
        if (keyword === 'Mnemosyne A5') return rakutenResponse({ items: [rakutenItem()] });
        return rakutenResponse({ items: [] });
      }) as RakutenHttp,
    });

    const yahooResult = await yahoo.search(MNEMOSYNE);
    const rakutenResult = await rakuten.search(MNEMOSYNE);
    assert.equal(yahooResult.ok, true);
    assert.equal(rakutenResult.ok, true);
    if (!yahooResult.ok || !rakutenResult.ok) return;
    assert.equal(yahooResult.value.length, 1);
    assert.equal(rakutenResult.value.length, 1);
    assert.equal(yahooResult.value[0].title, 'マルマン ニーモシネ A5');
    assert.equal(rakutenResult.value[0].title, 'マルマン ニーモシネ A5');
  });

  assert.deepEqual(yahooQueries, ['Mnemosyne human A5', 'Mnemosyne A5']);
  assert.deepEqual(rakutenKeywords, ['Mnemosyne human A5', 'Mnemosyne A5']);
  const events = logEvents(lines);
  assert.equal(events.length, 4);
  for (const event of events) assertLogShape(event);
  assert.deepEqual(events.map((event) => event.provider), ['yahoo', 'yahoo', 'rakuten', 'rakuten']);
  assert.deepEqual(events.map((event) => event.httpStatus), [200, 200, 200, 200]);
  assert.deepEqual(events.map((event) => event.errorCode), [null, null, null, null]);
  assert.deepEqual(events.map((event) => event.hitCount), [0, 1, 0, 1]);
  const dumped = JSON.stringify(events);
  for (const secret of ['Mnemosyne', 'human', 'A5', YAHOO_APP_ID, RAKUTEN_APP_ID, RAKUTEN_ACCESS_KEY, 'マルマン']) {
    assert.equal(dumped.includes(secret), false, secret);
  }
});

test('zero hits on the name and model are searched again as the name only', async () => {
  const queries: string[] = [];
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'mnemosyne-name',
    gate: createYahooRateGate(),
    now: () => NOW,
    schedule: () => () => {},
    fetch: (async (url) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      queries.push(query);
      if (query === 'Mnemosyne') return jsonResponse({ hits: [yahooHit()] });
      return jsonResponse({ hits: [] });
    }) as YahooFetch,
  });
  const result = await yahoo.search(MNEMOSYNE);
  assert.deepEqual(queries, ['Mnemosyne human A5', 'Mnemosyne A5', 'Mnemosyne']);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
});

test('a JAN is the only keyword even when that search has zero hits', async () => {
  const query: SearchQuery = { ...MNEMOSYNE, jan: JAN };
  const yahooUrls: string[] = [];
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'mnemosyne-jan',
    gate: createYahooRateGate(),
    now: () => NOW,
    schedule: () => () => {},
    fetch: (async (url) => {
      yahooUrls.push(url);
      return jsonResponse({ hits: [] });
    }) as YahooFetch,
  });
  const yahooResult = await yahoo.search(query);
  assert.equal(yahooUrls.length, 1);
  const yahooUrl = new URL(yahooUrls[0]);
  assert.equal(yahooUrl.searchParams.get('jan_code'), JAN);
  assert.equal(yahooUrl.searchParams.has('query'), false);
  assert.equal(yahooResult.ok, true);
  if (yahooResult.ok) assert.deepEqual(yahooResult.value, []);

  const rakutenUrls: string[] = [];
  const rakuten = createRakutenSearch({
    credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
    limiter: createRakutenLimiter(),
    userId: 'mnemosyne-jan',
    now: () => new Date(NOW),
    http: async (request) => {
      rakutenUrls.push(request.url);
      return rakutenResponse({ items: [] });
    },
  });
  const rakutenResult = await rakuten.search(query);
  assert.equal(rakutenUrls.length, 1);
  assert.equal(new URL(rakutenUrls[0]).searchParams.get('keyword'), JAN);
  assert.equal(rakutenUrls[0].includes('Mnemosyne'), false);
  assert.equal(rakutenResult.ok, true);
  if (rakutenResult.ok) assert.deepEqual(rakutenResult.value, []);
});

test('a store error keeps the HTTP status in one log line and is not searched again', async () => {
  const secretBody = `upstream ${YAHOO_APP_ID} Mnemosyne human A5`;
  const queries: string[] = [];
  const lines = await withInfo(async () => {
    const yahoo = createYahooSearch({
      appId: YAHOO_APP_ID,
      userId: 'mnemosyne-error',
      gate: createYahooRateGate(),
      now: () => NOW,
      schedule: () => () => {},
      fetch: (async (url) => {
        queries.push(new URL(url).searchParams.get('query') ?? '');
        return jsonResponse({ error: secretBody }, 500);
      }) as YahooFetch,
    });
    const result = await yahoo.search(MNEMOSYNE);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'SEARCH_FAILED');
  });
  assert.deepEqual(queries, ['Mnemosyne human A5']);
  const events = logEvents(lines);
  assert.equal(events.length, 1);
  assertLogShape(events[0]);
  assert.equal(events[0].provider, 'yahoo');
  assert.equal(events[0].httpStatus, 500);
  assert.equal(events[0].errorCode, 'SEARCH_FAILED');
  assert.equal(events[0].hitCount, 0);
  const dumped = JSON.stringify(events);
  assert.equal(dumped.includes('Mnemosyne'), false);
  assert.equal(dumped.includes(YAHOO_APP_ID), false);
  assert.equal(dumped.includes(secretBody), false);
});

test('a name that already has hits is not searched with a shorter query', async () => {
  const queries: string[] = [];
  const lines = await withInfo(async () => {
    const yahoo = createYahooSearch({
      appId: YAHOO_APP_ID,
      userId: 'mnemosyne-hit',
      gate: createYahooRateGate(),
      now: () => NOW,
      schedule: () => () => {},
      fetch: (async (url) => {
        queries.push(new URL(url).searchParams.get('query') ?? '');
        return jsonResponse({ hits: [yahooHit()] });
      }) as YahooFetch,
    });
    const result = await yahoo.search(MNEMOSYNE);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.length, 1);
  });
  assert.deepEqual(queries, ['Mnemosyne human A5']);
  const events = logEvents(lines);
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'yahoo');
  assert.equal(events[0].httpStatus, 200);
  assert.equal(events[0].errorCode, null);
  assert.equal(events[0].hitCount, 1);
  assert.equal(JSON.stringify(events).includes('Mnemosyne'), false);
});

test('zero hits stay editable and a shop failure keeps its message', () => {
  const empty = statusAfterSearch({
    candidates: [],
    failures: [],
    amazonUrl: 'https://www.amazon.co.jp/s?k=Mnemosyne',
  }, true, 'Mnemosyne');
  assert.equal(empty.blocked, false);
  assert.equal(empty.manual.enter, false);
  assert.equal(empty.message, '見つかりませんでした');
  assert.equal(empty.message.includes('候補を取得できませんでした'), false);

  const failed = statusAfterSearch({
    code: 'SEARCH_FAILED',
    error: CaptureMessages.searchFailed,
  }, false, 'Mnemosyne');
  assert.equal(failed.blocked, false);
  assert.equal(failed.manual.enter, true);
  assert.equal(failed.message, CaptureMessages.searchFailed);

  const partial = statusAfterSearch({
    candidates: [],
    failures: [{ site: 'yahoo', code: 'SEARCH_FAILED', error: CaptureMessages.searchFailed }],
    amazonUrl: 'https://www.amazon.co.jp/s?k=Mnemosyne',
  }, true, 'Mnemosyne');
  assert.equal(partial.manual.enter, true);
  assert.equal(partial.message, CaptureMessages.searchFailed);
  assert.equal(partial.message.includes('見つかりませんでした'), false);
});
