import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureMessages, type SearchQuery } from '../src/lib/capture/contract';
import { statusAfterSearch } from '../src/lib/capture/capture-flow';
import { createYahooRateGate, createYahooSearch, type YahooFetch } from '../src/lib/capture/yahoo';
import {
  RakutenMessages,
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
  const yahooClock = waitedClock();
  const rakutenClock = waitedClock();
  const lines = await withInfo(async () => {
    const yahoo = createYahooSearch({
      appId: YAHOO_APP_ID,
      userId: 'mnemosyne',
      gate: createYahooRateGate(),
      now: yahooClock.now,
      delay: yahooClock.delay,
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
      now: rakutenClock.date,
      delay: rakutenClock.delay,
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
  assert.deepEqual(yahooClock.waits, [1000]);
  assert.deepEqual(rakutenClock.waits, [1000]);
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
  const clock = waitedClock();
  const sentAt: number[] = [];
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'mnemosyne-name',
    gate: createYahooRateGate(),
    now: clock.now,
    delay: clock.delay,
    schedule: () => () => {},
    fetch: (async (url) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      queries.push(query);
      sentAt.push(clock.now());
      if (query === 'Mnemosyne') return jsonResponse({ hits: [yahooHit()] });
      return jsonResponse({ hits: [] });
    }) as YahooFetch,
  });
  const result = await yahoo.search(MNEMOSYNE);
  assert.deepEqual(queries, ['Mnemosyne human A5', 'Mnemosyne A5', 'Mnemosyne']);
  assert.deepEqual(clock.waits, [1000, 1000]);
  assert.deepEqual(sentAt, [NOW, NOW + 1000, NOW + 2000]);
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

function waitedClock(start = NOW) {
  let at = start;
  const waits: number[] = [];
  return {
    waits,
    now: () => at,
    date: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
    delay: async (ms: number) => {
      waits.push(ms);
      at += ms;
    },
  };
}

test('a frozen clock keeps the first zero-hit and does not send the shorter queries', async () => {
  const yahooQueries: string[] = [];
  const rakutenKeywords: string[] = [];
  let yahooDelays = 0;
  let rakutenDelays = 0;
  const lines = await withInfo(async () => {
    const yahoo = createYahooSearch({
      appId: YAHOO_APP_ID,
      userId: 'frozen-yahoo',
      gate: createYahooRateGate(),
      now: () => NOW,
      delay: async () => {
        yahooDelays += 1;
        if (yahooDelays > 3) throw new Error('yahoo waited without time moving');
      },
      schedule: () => () => {},
      fetch: (async (url) => {
        yahooQueries.push(new URL(url).searchParams.get('query') ?? '');
        return jsonResponse({ hits: [] });
      }) as YahooFetch,
    });
    const rakuten = createRakutenSearch({
      credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
      limiter: createRakutenLimiter(),
      userId: 'frozen-rakuten',
      now: () => new Date(NOW),
      delay: async () => {
        rakutenDelays += 1;
        if (rakutenDelays > 3) throw new Error('rakuten waited without time moving');
      },
      http: async (request) => {
        rakutenKeywords.push(new URL(request.url).searchParams.get('keyword') ?? '');
        return rakutenResponse({ items: [] });
      },
    });

    const yahooResult = await yahoo.search(MNEMOSYNE);
    const rakutenResult = await rakuten.search(MNEMOSYNE);
    assert.equal(yahooResult.ok, true);
    assert.equal(rakutenResult.ok, true);
    if (yahooResult.ok) assert.deepEqual(yahooResult.value, []);
    if (rakutenResult.ok) assert.deepEqual(rakutenResult.value, []);
  });

  assert.deepEqual(yahooQueries, ['Mnemosyne human A5']);
  assert.deepEqual(rakutenKeywords, ['Mnemosyne human A5']);
  assert.equal(yahooDelays < 3, true);
  assert.equal(rakutenDelays < 3, true);
  const events = logEvents(lines);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.provider), ['yahoo', 'rakuten']);
  assert.deepEqual(events.map((event) => event.httpStatus), [200, 200]);
  assert.deepEqual(events.map((event) => event.errorCode), [null, null]);
  assert.deepEqual(events.map((event) => event.hitCount), [0, 0]);
});

test('a later upstream 429 keeps the first zero-hit and does not try a shorter query', async () => {
  const yahooClock = waitedClock();
  const rakutenClock = waitedClock();
  const yahooQueries: string[] = [];
  const rakutenKeywords: string[] = [];
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'later-429-yahoo',
    gate: createYahooRateGate(),
    now: yahooClock.now,
    delay: yahooClock.delay,
    schedule: () => () => {},
    fetch: (async (url) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      yahooQueries.push(query);
      if (yahooQueries.length === 1) return jsonResponse({ hits: [] });
      return jsonResponse({ error: 'limited' }, 429);
    }) as YahooFetch,
  });
  const rakuten = createRakutenSearch({
    credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
    limiter: createRakutenLimiter(),
    userId: 'later-429-rakuten',
    now: rakutenClock.date,
    delay: rakutenClock.delay,
    http: async (request) => {
      const keyword = new URL(request.url).searchParams.get('keyword') ?? '';
      rakutenKeywords.push(keyword);
      if (rakutenKeywords.length === 1) return rakutenResponse({ items: [] });
      return rakutenResponse({ error: 'limited' }, 429);
    },
  });

  const yahooResult = await yahoo.search(MNEMOSYNE);
  const rakutenResult = await rakuten.search(MNEMOSYNE);
  assert.deepEqual(yahooQueries, ['Mnemosyne human A5', 'Mnemosyne A5']);
  assert.deepEqual(rakutenKeywords, ['Mnemosyne human A5', 'Mnemosyne A5']);
  assert.equal(yahooResult.ok, true);
  assert.equal(rakutenResult.ok, true);
  if (yahooResult.ok) assert.deepEqual(yahooResult.value, []);
  if (rakutenResult.ok) assert.deepEqual(rakutenResult.value, []);
});

test('a later provider failure stays a failure and is not searched shorter', async () => {
  const queries: string[] = [];
  const clock = waitedClock();
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'later-500-yahoo',
    gate: createYahooRateGate(),
    now: clock.now,
    delay: clock.delay,
    schedule: () => () => {},
    fetch: (async (url) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      queries.push(query);
      if (queries.length === 1) return jsonResponse({ hits: [] });
      return jsonResponse({ error: 'down' }, 500);
    }) as YahooFetch,
  });
  const result = await yahoo.search(MNEMOSYNE);
  assert.deepEqual(queries, ['Mnemosyne human A5', 'Mnemosyne A5']);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'SEARCH_FAILED');
});

test('a fast zero-hit waits for the global second and still counts as one user search', async () => {
  const yahooClock = waitedClock();
  const yahooQueries: string[] = [];
  const yahooSent: number[] = [];
  const yahooGate = createYahooRateGate();
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'slot-yahoo',
    gate: yahooGate,
    now: yahooClock.now,
    delay: yahooClock.delay,
    schedule: () => () => {},
    fetch: (async (url) => {
      yahooQueries.push(new URL(url).searchParams.get('query') ?? '');
      yahooSent.push(yahooClock.now());
      return jsonResponse({ hits: [] });
    }) as YahooFetch,
  });
  const yahooEmpty = await yahoo.search(MNEMOSYNE);
  assert.equal(yahooEmpty.ok, true);
  if (yahooEmpty.ok) assert.deepEqual(yahooEmpty.value, []);
  assert.deepEqual(yahooQueries, ['Mnemosyne human A5', 'Mnemosyne A5', 'Mnemosyne']);
  assert.deepEqual(yahooClock.waits, [1000, 1000]);
  assert.deepEqual(yahooSent, [NOW, NOW + 1000, NOW + 2000]);

  for (let index = 0; index < 4; index += 1) {
    yahooClock.advance(1000);
    const follow = createYahooSearch({
      appId: YAHOO_APP_ID,
      userId: 'slot-yahoo',
      gate: yahooGate,
      now: yahooClock.now,
      delay: yahooClock.delay,
      schedule: () => () => {},
      fetch: (async () => jsonResponse({ hits: [yahooHit()] })) as YahooFetch,
    });
    const result = await follow.search(MNEMOSYNE);
    assert.equal(result.ok, true, `yahoo user search ${index + 2}`);
  }
  yahooClock.advance(1000);
  const yahooBlocked = await createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'slot-yahoo',
    gate: yahooGate,
    now: yahooClock.now,
    delay: yahooClock.delay,
    schedule: () => () => {},
    fetch: (async () => jsonResponse({ hits: [yahooHit()] })) as YahooFetch,
  }).search(MNEMOSYNE);
  assert.equal(yahooBlocked.ok, false);
  if (!yahooBlocked.ok) assert.equal(yahooBlocked.error.error, 'この検索は1分に5回までです');

  const rakutenClock = waitedClock();
  const rakutenKeywords: string[] = [];
  const limiter = createRakutenLimiter();
  const rakuten = createRakutenSearch({
    credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
    limiter,
    userId: 'slot-rakuten',
    now: rakutenClock.date,
    delay: rakutenClock.delay,
    http: async (request) => {
      rakutenKeywords.push(new URL(request.url).searchParams.get('keyword') ?? '');
      return rakutenResponse({ items: [] });
    },
  });
  const rakutenEmpty = await rakuten.search(MNEMOSYNE);
  assert.equal(rakutenEmpty.ok, true);
  if (rakutenEmpty.ok) assert.deepEqual(rakutenEmpty.value, []);
  assert.deepEqual(rakutenKeywords, ['Mnemosyne human A5', 'Mnemosyne A5', 'Mnemosyne']);
  assert.deepEqual(rakutenClock.waits, [1000, 1000]);

  for (let index = 0; index < 4; index += 1) {
    rakutenClock.advance(1000);
    const follow = createRakutenSearch({
      credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
      limiter,
      userId: 'slot-rakuten',
      now: rakutenClock.date,
      delay: rakutenClock.delay,
      http: async () => rakutenResponse({ items: [rakutenItem()] }),
    });
    const result = await follow.search(MNEMOSYNE);
    assert.equal(result.ok, true, `rakuten user search ${index + 2}`);
  }
  rakutenClock.advance(1000);
  const rakutenBlocked = await createRakutenSearch({
    credentials: { applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY },
    limiter,
    userId: 'slot-rakuten',
    now: rakutenClock.date,
    delay: rakutenClock.delay,
    http: async () => rakutenResponse({ items: [rakutenItem()] }),
  }).search(MNEMOSYNE);
  assert.equal(rakutenBlocked.ok, false);
  if (!rakutenBlocked.ok) assert.equal(rakutenBlocked.error.error, RakutenMessages.userMinute);
});

test('a shorter query waits at most one second, and two seconds in total', async () => {
  const gate = createYahooRateGate();
  const clock = waitedClock();
  const queries: string[] = [];
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'wait-cap',
    gate,
    now: clock.now,
    delay: async (ms) => {
      assert.equal(ms <= 1_000, true);
      await clock.delay(ms);
      if (clock.waits.length === 1) assert.equal(gate.take('someone-else', clock.now()), null);
    },
    schedule: () => () => {},
    fetch: (async (url) => {
      queries.push(new URL(url).searchParams.get('query') ?? '');
      return jsonResponse({ hits: [] });
    }) as YahooFetch,
  });
  const result = await yahoo.search(MNEMOSYNE);
  assert.deepEqual(queries, ['Mnemosyne human A5']);
  assert.deepEqual(clock.waits, [1000]);
  assert.equal(clock.waits.reduce((sum, ms) => sum + ms, 0) <= 2_000, true);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, []);
});

test('the yahoo minute cap keeps the first zero-hit without waiting out the minute', async () => {
  const gate = createYahooRateGate();
  let seeded = NOW;
  for (let index = 0; index < 24; index += 1) {
    assert.equal(gate.take(`seed-${index}`, seeded), null);
    seeded += 1000;
  }
  const clock = waitedClock(seeded);
  const queries: string[] = [];
  const yahoo = createYahooSearch({
    appId: YAHOO_APP_ID,
    userId: 'minute-user',
    gate,
    now: clock.now,
    delay: clock.delay,
    schedule: () => () => {},
    fetch: (async (url) => {
      queries.push(new URL(url).searchParams.get('query') ?? '');
      return jsonResponse({ hits: [] });
    }) as YahooFetch,
  });
  const result = await yahoo.search(MNEMOSYNE);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, []);
  assert.deepEqual(queries, ['Mnemosyne human A5']);
  assert.equal(clock.waits.every((ms) => ms <= 1_000), true);
  assert.equal(clock.waits.reduce((sum, ms) => sum + ms, 0) <= 1_000, true);
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
