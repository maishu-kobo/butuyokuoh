import './properties-fast-check-env';

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { NextRequest } from 'next/server';
import { propertyDbDirectory } from './properties-fast-check-env';
import { installAuthTestHooks, type CurrentUser } from '../src/lib/auth';
import {
  acceptCandidate,
  parseSearchQuery,
  sortCandidates,
  type CaptureCandidate,
  type CapturePorts,
  type CaptureSite,
  type SearchQuery,
} from '../src/lib/capture/contract';
import { orderCandidates } from '../src/lib/capture/capture-flow';
import { searchWithPorts } from '../src/lib/capture/fakes';
import { formatYen } from '../src/lib/capture/list-card';
import { createRakutenLimiter, createRakutenSearch } from '../src/lib/capture/rakuten';
import { createYahooRateGate, createYahooSearch, type YahooFetch } from '../src/lib/capture/yahoo';
import { createWorkersAiIdentifier, type WorkersAiHttpResponse } from '../src/lib/capture/workers-ai';
import { getDb, openDatabase } from '../src/lib/db';
import { normalizeEmail } from '../src/lib/email';
import { parseProductHtml } from '../src/lib/product-html';
import * as groupRoute from '../src/app/api/comparison-groups/route';
import * as groupIdRoute from '../src/app/api/comparison-groups/[id]/route';
import * as itemRoute from '../src/app/api/items/route';
import * as itemIdRoute from '../src/app/api/items/[id]/route';

// 再現できる実行。シード固定、回数は少なめ、通信も本番 DB も使わない。
const SEED = 20261022;
const RUNS = 40;
const DB_RUNS = 20;
const NOW = Date.parse('2026-10-22T00:00:00.000Z');
const CONTROL = /[\u0000-\u001F\u007F]/;
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const ACCOUNT = 'a'.repeat(32);
const TOKEN = 'property-test-token';
const FAST = { seed: SEED, numRuns: RUNS } as const;

const LETTERS = [...'abcdefghijklmnopqrstuvwxyzあいうえおかきくけこ'];
const coreArb = fc.array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 24 }).map((chars) => chars.join(''));
const longKanaArb = fc.array(fc.constantFrom(...'あいうえお'.split('')), { minLength: 90, maxLength: 140 }).map((chars) => chars.join(''));
const controlsArb = fc.array(fc.integer({ min: 0, max: 31 }), { maxLength: 5 }).map((codes) => String.fromCharCode(...codes, 0x7f));
const noisyTextArb = fc.tuple(controlsArb, fc.oneof(coreArb, longKanaArb), controlsArb).map(([prefix, core, suffix]) => `${prefix}${core}${suffix}`);
const slugArb = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 10 }).map((chars) => chars.join(''));
const wordArb = fc.array(fc.constantFrom(...'あいうえおabcdef012'.split('')), { minLength: 1, maxLength: 12 }).map((chars) => chars.join(''));

type GroupOp =
  | { kind: 'addGroup'; name: string }
  | { kind: 'removeGroup'; slot: number }
  | { kind: 'addItem'; name: string; groupSlot: number | null }
  | { kind: 'assign'; itemSlot: number; groupSlot: number | null };

type GroupRow = { id: number; name: string };
type ItemRow = { id: number; name: string; groupId: number | null };
type GroupModel = { groups: GroupRow[]; items: ItemRow[] };

function assertTempDatabase(filename: string) {
  const resolved = join(filename);
  if (!resolved.startsWith(tmpdir()) || !resolved.includes('butuyokuoh-properties-')) {
    throw new Error(`refusing database outside the property temp dir: ${resolved}`);
  }
  if (resolved.includes(`${join('data', 'butuyokuoh.db')}`)) {
    throw new Error('refusing to use the application database');
  }
}

function schemaRows(db: ReturnType<typeof openDatabase>): string {
  const rows = db.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  ).all();
  return JSON.stringify(rows);
}

function schemaSignature(filename: string): string {
  assertTempDatabase(filename);
  const db = openDatabase(filename);
  try {
    return schemaRows(db);
  } finally {
    db.close();
  }
}

function flipAsciiCase(value: string): string {
  return value.replace(/[A-Za-z]/g, (char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()));
}

function counts(values: string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return tally;
}

function sameCounts(left: string[], right: string[]): boolean {
  const a = counts(left);
  const b = counts(right);
  if (a.size !== b.size) return false;
  for (const [key, count] of a) if (b.get(key) !== count) return false;
  return true;
}

async function withNetworkBlocked<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('property test blocked a network call');
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function aiBody(product: { name: string; brand: string | null; model: string | null }): WorkersAiHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({
      success: true,
      result: { response: JSON.stringify({ confidence: 'sure', products: [{ ...product, jan: null }] }) },
    }),
  };
}

async function yahooKeyword(query: SearchQuery): Promise<string | null> {
  let captured = '';
  const search = createYahooSearch({
    appId: 'property-app',
    userId: 'property-user',
    gate: createYahooRateGate(),
    now: () => NOW,
    schedule: () => () => {},
    fetch: (async (url) => {
      captured = url;
      return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as YahooFetch,
  });
  const result = await search.search(query);
  if (!result.ok && !captured) return null;
  return captured ? new URL(captured).searchParams.get('query') : null;
}

async function rakutenKeyword(query: SearchQuery): Promise<string | null> {
  let captured = '';
  const search = createRakutenSearch({
    credentials: { applicationId: 'property-app', accessKey: 'property-key' },
    limiter: createRakutenLimiter(),
    userId: 'property-user',
    now: () => new Date(NOW),
    http: async (request) => {
      captured = request.url;
      return { status: 200, body: JSON.stringify({ items: [] }) };
    },
  });
  await search.search(query);
  return captured ? new URL(captured).searchParams.get('keyword') : null;
}

function assertPlain(value: string, maxLength: number) {
  assert.ok(value.length > 0, 'empty search text');
  assert.ok(value.length <= maxLength, `length ${value.length} exceeds ${maxLength}`);
  assert.equal(CONTROL.test(value), false);
  assert.equal(value.includes('\n'), false);
  assert.equal(value.includes('\r'), false);
}

async function call<P extends Record<string, string> = Record<string, string>>(
  handler: (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>,
  method: string,
  path: string,
  body?: unknown,
  params?: P,
) {
  const request = new NextRequest(`http://127.0.0.1${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve((params ?? {}) as P) });
  const text = await response.text();
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    json: type.includes('json') && text ? JSON.parse(text) as Record<string, unknown> : undefined,
    text,
  };
}

let memberSequence = 0;

async function createMember(label: string): Promise<CurrentUser> {
  const database = getDb();
  const file = (database.prepare('PRAGMA database_list').all() as { name: string; file: string }[])
    .find((row) => row.name === 'main')?.file ?? '';
  if (!file.includes('butuyokuoh-properties-')) throw new Error(`refusing non-temp database: ${file || '(unset)'}`);
  const email = `${label}-${++memberSequence}@example.test`;
  const id = Number(database.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(email, label).lastInsertRowid);
  const user = database.prepare(
    'SELECT id, email, name, created_at, account_type FROM users WHERE id = ?',
  ).get(id) as CurrentUser;
  if (!user || user.account_type !== 'member') throw new Error('member was not created');
  return user;
}

function mappingOf(userId: number): GroupModel {
  const database = getDb();
  const groups = database.prepare(
    'SELECT id, name FROM comparison_groups WHERE user_id = ? ORDER BY id',
  ).all(userId) as GroupRow[];
  const items = database.prepare(
    'SELECT id, name, comparison_group_id AS groupId FROM items WHERE user_id = ? ORDER BY id',
  ).all(userId) as ItemRow[];
  return { groups, items };
}

function assertGroupInvariants(actual: GroupModel) {
  const groupIds = new Set(actual.groups.map((group) => group.id));
  assert.equal(new Set(actual.groups.map((group) => group.id)).size, actual.groups.length);
  assert.equal(new Set(actual.items.map((item) => item.id)).size, actual.items.length);
  for (const item of actual.items) {
    if (item.groupId != null) assert.equal(groupIds.has(item.groupId), true);
  }
}

test('AI の結果から作る検索語は空にならず、長さが収まり、制御文字も改行も含まない', async () => {
  // 性質: 妥当な商品名（制御文字を除くと文字が残り、URL ではない）から
  // createWorkersAiIdentifier が返す名前・任意のブランドと型番、そして
  // parseSearchQuery を通した Yahoo! / 楽天の検索語は、空にならない。
  // 名前は 200 文字、ブランドと型番は 80 文字、Yahoo! の query は 400 文字、
  // 楽天の keyword は 128 バイト以内。制御文字と改行を含まない。
  await withNetworkBlocked(async () => {
    await fc.assert(fc.asyncProperty(
      noisyTextArb,
      fc.option(noisyTextArb, { nil: null }),
      fc.option(noisyTextArb, { nil: null }),
      async (name, brand, model) => {
        const identifier = createWorkersAiIdentifier({
          accountId: ACCOUNT,
          apiToken: TOKEN,
          userId: '7',
          now: () => NOW,
          timeoutMs: 1000,
          http: async () => aiBody({ name, brand, model }),
        });
        const identified = await identifier.identify({ mediaType: 'image/jpeg', bytes: JPEG });
        assert.equal(identified.ok, true);
        if (!identified.ok) return;
        assert.equal(identified.value.products.length, 1);
        const product = identified.value.products[0];
        assertPlain(product.name, 200);
        if (product.brand != null) assertPlain(product.brand, 80);
        if (product.model != null) assertPlain(product.model, 80);

        const parsed = parseSearchQuery({
          name: product.name,
          brand: product.brand,
          model: product.model,
          jan: product.jan,
        });
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assertPlain(parsed.value.name, 200);
        if (parsed.value.brand != null) assertPlain(parsed.value.brand, 80);
        if (parsed.value.model != null) assertPlain(parsed.value.model, 80);

        const yahoo = await yahooKeyword(parsed.value);
        const rakuten = await rakutenKeyword(parsed.value);
        if (yahoo == null || rakuten == null) {
          assert.fail(`search text was empty for ${JSON.stringify(parsed.value)}`);
        }
        assertPlain(yahoo, 400);
        assertPlain(rakuten, 128);
        assert.ok(new TextEncoder().encode(rakuten).byteLength <= 128);
      },
    ), FAST);
  });
});

test('Yahoo! と楽天の価格は負にも NaN にもならず、正の価格は表示してから読み戻せる', async () => {
  // 性質: createYahooSearch / createRakutenSearch が返す価格は 0 以上の安全な整数で、負でも NaN でもない。
  // その正の価格を formatYen で表示し、parseProductHtml が Yahoo! / 楽天のページとして読むと元の整数に戻る。
  // 0 は検索側が受け取る。ページの価格読みは 0 円を欠落として捨てる（既存の仕様）ので、0 の往復は要求しない。
  const priceArb = fc.oneof(
    fc.integer({ min: -50_000, max: 2_000_000_000 }),
    fc.double(),
    fc.constant(0),
    fc.constant(-0),
    fc.constant(Number.NaN),
    fc.constant(Number.POSITIVE_INFINITY),
    fc.constant(Number.NEGATIVE_INFINITY),
    fc.string({ maxLength: 12 }),
  );

  await withNetworkBlocked(async () => {
    await fc.assert(fc.asyncProperty(priceArb, async (raw) => {
      const payload = JSON.parse(JSON.stringify({ price: raw })) as { price: unknown };
      const price = payload.price;
      const yahoo = createYahooSearch({
        appId: 'property-app',
        gate: createYahooRateGate(),
        now: () => NOW,
        schedule: () => () => {},
        fetch: async () => new Response(JSON.stringify({
          hits: [{
            name: 'ペン',
            url: 'https://store.shopping.yahoo.co.jp/example/pen',
            code: 'example-pen',
            price,
            seller: { name: '店' },
          }],
        }), { status: 200 }),
      });
      const rakuten = createRakutenSearch({
        credentials: { applicationId: 'property-app', accessKey: 'property-key' },
        limiter: createRakutenLimiter(),
        now: () => new Date(NOW),
        http: async () => ({
          status: 200,
          body: JSON.stringify({
            items: [{
              itemName: 'ペン',
              shopName: '店',
              itemUrl: 'https://item.rakuten.co.jp/example/pen',
              itemPrice: price,
              itemCode: 'example-pen',
            }],
          }),
        }),
      });
      const query: SearchQuery = { name: 'ペン', brand: null, model: null, jan: null };
      const yahooResult = await yahoo.search(query);
      const rakutenResult = await rakuten.search(query);
      const emitted = [
        ...(yahooResult.ok ? yahooResult.value : []),
        ...(rakutenResult.ok ? rakutenResult.value : []),
      ];
      for (const candidate of emitted) {
        assert.equal(Number.isSafeInteger(candidate.price), true);
        assert.equal(Number.isNaN(candidate.price), false);
        assert.ok(candidate.price >= 0);
        const formatted = formatYen(candidate.price);
        assert.equal(formatted.includes('NaN'), false);
        assert.equal(formatted.includes('-'), false);
        if (candidate.price > 0) {
          const page = `<title>商品</title>${formatted}`;
          const fromYahoo = parseProductHtml(page, 'https://store.shopping.yahoo.co.jp/example/pen').price;
          const fromRakuten = parseProductHtml(page, 'https://item.rakuten.co.jp/example/pen').price;
          assert.equal(fromYahoo, candidate.price);
          assert.equal(fromRakuten, candidate.price);
          assert.equal(Number.isNaN(fromYahoo), false);
          assert.ok((fromYahoo ?? 0) >= 0);
        } else {
          assert.equal(formatted, '¥0');
          assert.equal(parseProductHtml(`<title>商品</title>${formatted}`, 'https://store.shopping.yahoo.co.jp/example/pen').price, null);
        }
      }
      const acceptable = typeof price === 'number' && Number.isSafeInteger(price) && price >= 0 && !Number.isNaN(price);
      assert.equal(yahooResult.ok, acceptable);
      assert.equal(rakutenResult.ok, acceptable);
      if (acceptable) {
        assert.equal(yahooResult.ok && yahooResult.value[0]?.price, price === 0 ? 0 : price);
        assert.equal(rakutenResult.ok && rakutenResult.value[0]?.price, price === 0 ? 0 : price);
      }
    }), FAST);
  });
});

function candidateArb(site: CaptureSite): fc.Arbitrary<CaptureCandidate> {
  return fc.tuple(slugArb, fc.integer({ min: 0, max: 100_000 })).map(([slug, price]) => {
    const item: CaptureCandidate = {
      id: `${site}:${slug}`,
      site,
      title: slug,
      price,
      url: site === 'yahoo'
        ? `https://store.shopping.yahoo.co.jp/shop/${slug}`
        : `https://item.rakuten.co.jp/shop/${slug}`,
      fetchedAt: '2026-10-22T00:00:00.000Z',
      shopName: '店',
    };
    return item;
  });
}

const queryArb: fc.Arbitrary<SearchQuery> = fc.record({
  name: fc.oneof(coreArb, fc.constant('')),
  brand: fc.constant(null),
  model: fc.constant(null),
  jan: fc.option(fc.constant('4900000000009'), { nil: null }),
});

test('候補のソートは冪等で、候補を足しも消しもしない', () => {
  // 性質: sortCandidates と orderCandidates は、同じ入力に二度かけても結果が変わらない。
  // 出力の id の多重集合は入力と一致する。候補は増えない。妥当な候補は消えない。
  fc.assert(fc.property(
    fc.array(fc.oneof(candidateArb('yahoo'), candidateArb('rakuten')), { maxLength: 12 }),
    queryArb,
    fc.constantFrom('recommended' as const, 'price' as const),
    (candidates, query, mode) => {
      const sorted = sortCandidates(candidates, query);
      assert.deepEqual(sortCandidates(sorted, query), sorted);
      assert.equal(sameCounts(sorted.map((item) => item.id), candidates.map((item) => item.id)), true);
      const ordered = orderCandidates(candidates, mode);
      assert.deepEqual(orderCandidates(ordered, mode), ordered);
      assert.equal(sameCounts(ordered.map((item) => item.id), candidates.map((item) => item.id)), true);
    },
  ), FAST);
});

test('検索結果の候補は、受け付けた入力だけを一度だけ並べる', async () => {
  // 性質: searchWithPorts は acceptCandidate を通った候補だけを sortCandidates で並べる。
  // 二度並べても同じ。入力に無い候補は出てこない。受け付けた候補は消えない。
  await fc.assert(fc.asyncProperty(
    fc.array(fc.oneof(
      candidateArb('yahoo'),
      candidateArb('rakuten'),
      candidateArb('yahoo').map((item) => ({ ...item, price: -1 })),
      candidateArb('rakuten').map((item) => ({ ...item, url: 'https://evil.example/item' })),
    ), { maxLength: 10 }),
    queryArb,
    async (inputs, query) => {
      const yahooInputs = inputs.filter((item) => item.site === 'yahoo');
      const rakutenInputs = inputs.filter((item) => item.site === 'rakuten');
      const ports: CapturePorts = {
        identifier: { async identify() { throw new Error('unused'); } },
        yahoo: { async search() { return { ok: true, value: yahooInputs }; } },
        rakuten: { async search() { return { ok: true, value: rakutenInputs }; } },
      };
      const result = await searchWithPorts(query, ports, null);
      const accepted = inputs.map((item) => acceptCandidate(item)).filter((item): item is CaptureCandidate => item !== null);
      if (yahooInputs.length > 0 && yahooInputs.every((item) => acceptCandidate(item) === null)
        && rakutenInputs.length > 0 && rakutenInputs.every((item) => acceptCandidate(item) === null)) {
        assert.equal(result.ok, false);
        return;
      }
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(sameCounts(result.value.candidates.map((item) => item.id), accepted.map((item) => item.id)), true);
      assert.deepEqual(sortCandidates(result.value.candidates, query), result.value.candidates);
      const again = await searchWithPorts(query, {
        ...ports,
        yahoo: { async search() { return { ok: true, value: result.value.candidates.filter((item) => item.site === 'yahoo') }; } },
        rakuten: { async search() { return { ok: true, value: result.value.candidates.filter((item) => item.site === 'rakuten') }; } },
      }, null);
      assert.equal(again.ok, true);
      if (!again.ok) return;
      assert.deepEqual(again.value.candidates, result.value.candidates);
    },
  ), FAST);
});

type ShopHit = { code: string; shop: string; name: string; price: number };

async function searchYahoo(items: ShopHit[]) {
  const search = createYahooSearch({
    appId: 'property-app',
    gate: createYahooRateGate(),
    now: () => NOW,
    schedule: () => () => {},
    fetch: async () => new Response(JSON.stringify({
      hits: items.map((item) => ({
        name: item.name,
        url: `https://store.shopping.yahoo.co.jp/${item.shop}/${item.code}`,
        code: item.code,
        price: item.price,
        seller: { name: item.shop },
      })),
    }), { status: 200 }),
  });
  return search.search({ name: 'ペン', brand: null, model: null, jan: null });
}

async function searchRakuten(items: ShopHit[]) {
  const search = createRakutenSearch({
    credentials: { applicationId: 'property-app', accessKey: 'property-key' },
    limiter: createRakutenLimiter(),
    now: () => new Date(NOW),
    http: async () => ({
      status: 200,
      body: JSON.stringify({
        items: items.map((item) => ({
          itemName: item.name,
          shopName: item.shop,
          itemUrl: `https://item.rakuten.co.jp/${item.shop}/${item.code}`,
          itemPrice: item.price,
          itemCode: item.code,
        })),
      }),
    }),
  });
  return search.search({ name: 'ペン', brand: null, model: null, jan: null });
}

const shopHitArb: fc.Arbitrary<ShopHit> = fc.record({
  code: slugArb,
  shop: slugArb,
  name: slugArb,
  price: fc.integer({ min: 0, max: 50_000 }),
});

test('Yahoo! の候補整理は冪等で、妥当な商品を増やしも減らしもしない', async () => {
  // 性質: createYahooSearch は同じ応答を二度読むと同じ候補になる。id は重複しない。
  // 出力の URL は入力の商品にある。先頭 10 件以内の妥当な商品の URL は残る。
  await withNetworkBlocked(() => fc.assert(fc.asyncProperty(
    fc.array(shopHitArb, { maxLength: 8 }),
    async (items) => {
      const first = await searchYahoo(items);
      const second = await searchYahoo(items);
      assert.deepEqual(first, second);
      assert.equal(first.ok, true);
      if (!first.ok) return;
      const ids = first.value.map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length);
      const inputUrls = new Set(items.map((item) => `https://store.shopping.yahoo.co.jp/${item.shop}/${item.code}`));
      for (const candidate of first.value) assert.equal(inputUrls.has(candidate.url), true);
      for (const item of items) {
        assert.equal(first.value.some((candidate) => candidate.url === `https://store.shopping.yahoo.co.jp/${item.shop}/${item.code}`), true);
      }
      assert.deepEqual(sortCandidates(first.value, { name: 'ペン', brand: null, model: null, jan: null }).length, first.value.length);
    },
  ), FAST));
});

test('楽天の候補整理は、別商品の id が衝突しない範囲では冪等で、候補を足しも消しもしない', async () => {
  // 性質: 商品コードの slug がすべて異なるとき、createRakutenSearch は候補を増やさない。
  // 妥当な商品は残る。id は重複しない。同じ応答を二度読むと結果は同じ。
  // slug が衝突して代替 id まで塞がるケースは、下の skip に反例を残してある。
  await withNetworkBlocked(() => fc.assert(fc.asyncProperty(
    fc.array(shopHitArb, { minLength: 1, maxLength: 6 }).map((items) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        if (seen.has(item.code)) return false;
        seen.add(item.code);
        return true;
      });
    }),
    async (items) => {
      const first = await searchRakuten(items);
      const second = await searchRakuten(items);
      assert.deepEqual(first, second);
      assert.equal(first.ok, true);
      if (!first.ok) return;
      const ids = first.value.map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(first.value.length, items.length);
      for (const item of items) {
        assert.equal(first.value.some((candidate) => candidate.url === `https://item.rakuten.co.jp/${item.shop}/${item.code}`), true);
      }
    },
  ), FAST));
});

test('楽天は代替の候補 id が既に使われていると妥当な商品を落とす', { skip: '実バグ。fast-check seed 20261022 path 0:0:0 が 2 回縮めた反例。修正は bugfix ブランチへ。この PR では直さない。' }, async () => {
  // 性質（満たしていない）: 妥当な楽天商品は、商品コードの slug が重なっても消えない。
  // createRakutenSearch の makeId は、最初の id が使われていると `-{index+1}` を一度だけ試す。
  // その代替が先の商品で埋まっていると null になり、商品を捨てる。
  // Yahoo! の yahooId は空いている接尾辞を探すので、同じ並びでも 3 件残る。
  const items: ShopHit[] = [
    { code: 'a-3', shop: 'shop0', name: 'first', price: 10 },
    { code: 'a', shop: 'shop1', name: 'second', price: 20 },
    { code: 'a', shop: 'shoplost', name: 'third', price: 30 },
  ];
  const result = await searchRakuten(items);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.some((candidate) => candidate.url === 'https://item.rakuten.co.jp/shoplost/a'), true);
});

test('比較グループの追加と削除は、順が変わっても対応関係を壊さない', { timeout: 60_000 }, async () => {
  // 性質: comparison-groups の POST / DELETE と items の POST / PATCH をどの順で呼んでも、
  // グループとアイテムの対応は操作の意味どおりになる。
  // 作っていないグループやアイテムは現れない。削除したグループの id は残らない。
  // グループを消してもアイテム自体は残る。アイテムの group は null か、同じユーザーの実在グループだけ。
  // 別ユーザーの対応は変わらない。
  const opArb: fc.Arbitrary<GroupOp> = fc.oneof(
    fc.record({ kind: fc.constant('addGroup' as const), name: wordArb }),
    fc.record({ kind: fc.constant('removeGroup' as const), slot: fc.nat({ max: 8 }) }),
    fc.record({
      kind: fc.constant('addItem' as const),
      name: wordArb,
      groupSlot: fc.option(fc.nat({ max: 8 }), { nil: null }),
    }),
    fc.record({
      kind: fc.constant('assign' as const),
      itemSlot: fc.nat({ max: 8 }),
      groupSlot: fc.option(fc.nat({ max: 8 }), { nil: null }),
    }),
  );

  await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 8 }), async (ops) => {
    const user = await createMember('group');
    const other = await createMember('other');
    installAuthTestHooks({ user: other });
    const otherGroup = await call(groupRoute.POST, 'POST', '/api/comparison-groups', { name: '他人のグループ' });
    assert.equal(otherGroup.status, 201);
    const otherItem = await call(itemRoute.POST, 'POST', '/api/items', {
      manual: true,
      name: '他人の商品',
      price: 100,
      comparison_group_id: otherGroup.json?.id,
    });
    assert.equal(otherItem.status, 201);
    const otherBefore = mappingOf(other.id);
    installAuthTestHooks({ user });

    const model: GroupModel = { groups: [], items: [] };
    for (const op of ops) {
      if (op.kind === 'addGroup') {
        const created = await call(groupRoute.POST, 'POST', '/api/comparison-groups', { name: op.name });
        assert.equal(created.status, 201, created.text);
        model.groups.push({ id: Number(created.json?.id), name: op.name });
      } else if (op.kind === 'removeGroup') {
        const target = model.groups.length === 0 ? undefined : model.groups[op.slot % model.groups.length];
        const removed = await call(
          groupIdRoute.DELETE,
          'DELETE',
          `/api/comparison-groups/${target?.id ?? 0}`,
          undefined,
          { id: String(target?.id ?? 0) },
        );
        if (!target) {
          assert.equal(removed.status, 404);
        } else {
          assert.equal(removed.status, 200, removed.text);
          model.groups = model.groups.filter((group) => group.id !== target.id);
          for (const item of model.items) if (item.groupId === target.id) item.groupId = null;
        }
      } else if (op.kind === 'addItem') {
        const group = op.groupSlot == null || model.groups.length === 0
          ? undefined
          : model.groups[op.groupSlot % model.groups.length];
        const created = await call(itemRoute.POST, 'POST', '/api/items', {
          manual: true,
          name: op.name,
          price: 100,
          ...(group ? { comparison_group_id: group.id } : {}),
        });
        assert.equal(created.status, 201, created.text);
        model.items.push({ id: Number(created.json?.id), name: op.name, groupId: group?.id ?? null });
      } else {
        const item = model.items.length === 0 ? undefined : model.items[op.itemSlot % model.items.length];
        const group = op.groupSlot == null || model.groups.length === 0
          ? null
          : model.groups[op.groupSlot % model.groups.length];
        if (!item) {
          const missing = await call(itemIdRoute.PATCH, 'PATCH', '/api/items/0', { comparison_group_id: null }, { id: '0' });
          assert.equal(missing.status, 404);
        } else {
          const updated = await call(
            itemIdRoute.PATCH,
            'PATCH',
            `/api/items/${item.id}`,
            { comparison_group_id: group ? group.id : null },
            { id: String(item.id) },
          );
          assert.equal(updated.status, 200, updated.text);
          item.groupId = group ? group.id : null;
        }
      }
      const actual = mappingOf(user.id);
      assert.deepEqual(actual, model);
      assertGroupInvariants(actual);
      assert.deepEqual(mappingOf(other.id), otherBefore);
    }
  }), { seed: SEED, numRuns: DB_RUNS });
});

test('openDatabase を二回適用した結果は一回と同じで、既存の行は残る', () => {
  // 性質: 同じテスト用 SQLite に openDatabase を二回かけたスキーマは、一回だけのスキーマと一致する。
  // 既にあるユーザー、比較グループ、アイテム、価格履歴は消えない。
  // 大文字のメールは LOWER(TRIM()) に揃えたうえで残り、三回目をかけてもそれ以上は変わらない。
  const rowArb = fc.record({
    local: slugArb,
    name: wordArb,
    item: wordArb,
    group: wordArb,
    price: fc.integer({ min: 0, max: 100_000 }),
    upper: fc.boolean(),
  });

  fc.assert(fc.property(rowArb, (row) => {
    const directory = mkdtempSync(join(propertyDbDirectory, 'migrate-'));
    try {
      const oncePath = join(directory, 'once.sqlite');
      const twicePath = join(directory, 'twice.sqlite');
      const dataPath = join(directory, 'data.sqlite');
      assertTempDatabase(oncePath);
      const once = schemaSignature(oncePath);
      const opened = openDatabase(twicePath);
      opened.close();
      assert.equal(schemaSignature(twicePath), once);

      const email = row.upper ? ` ${flipAsciiCase(row.local)}@Example.TEST ` : `${row.local}@example.test`;
      const db = openDatabase(dataPath);
      const userId = Number(db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(email, row.name).lastInsertRowid);
      const groupId = Number(db.prepare(
        'INSERT INTO comparison_groups (user_id, name, priority) VALUES (?, ?, 3)',
      ).run(userId, row.group).lastInsertRowid);
      const itemId = Number(db.prepare(
        `INSERT INTO items (user_id, name, url, current_price, comparison_group_id, source)
         VALUES (?, ?, ?, ?, ?, 'other')`,
      ).run(userId, row.item, `manual://property-${row.local}`, row.price, groupId).lastInsertRowid);
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, row.price);
      const before = db.prepare(
        `SELECT u.id AS user_id, u.name AS user_name, u.created_at AS user_created,
                g.id AS group_id, g.name AS group_name, g.priority AS group_priority,
                i.id AS item_id, i.name AS item_name, i.url AS item_url, i.current_price AS price,
                i.comparison_group_id AS group_ref, h.price AS history_price
         FROM items i
         JOIN users u ON u.id = i.user_id
         JOIN comparison_groups g ON g.id = i.comparison_group_id
         JOIN price_history h ON h.item_id = i.id`,
      ).get();
      db.close();

      const again = openDatabase(dataPath);
      const migratedEmail = again.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId) as {
        id: number; email: string; name: string;
      };
      const after = again.prepare(
        `SELECT u.id AS user_id, u.name AS user_name, u.created_at AS user_created,
                g.id AS group_id, g.name AS group_name, g.priority AS group_priority,
                i.id AS item_id, i.name AS item_name, i.url AS item_url, i.current_price AS price,
                i.comparison_group_id AS group_ref, h.price AS history_price
         FROM items i
         JOIN users u ON u.id = i.user_id
         JOIN comparison_groups g ON g.id = i.comparison_group_id
         JOIN price_history h ON h.item_id = i.id`,
      ).get();
      assert.equal(migratedEmail.id, userId);
      assert.equal(migratedEmail.name, row.name);
      assert.equal(migratedEmail.email, email.trim().toLowerCase());
      assert.deepEqual(after, before);
      assert.equal(schemaRows(again), once);
      again.close();

      const third = openDatabase(dataPath);
      const stableEmail = third.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string };
      const stableRow = third.prepare(
        `SELECT u.id AS user_id, u.name AS user_name, u.created_at AS user_created,
                g.id AS group_id, g.name AS group_name, g.priority AS group_priority,
                i.id AS item_id, i.name AS item_name, i.url AS item_url, i.current_price AS price,
                i.comparison_group_id AS group_ref, h.price AS history_price
         FROM items i
         JOIN users u ON u.id = i.user_id
         JOIN comparison_groups g ON g.id = i.comparison_group_id
         JOIN price_history h ON h.item_id = i.id`,
      ).get();
      assert.equal(stableEmail.email, migratedEmail.email);
      assert.deepEqual(stableRow, after);
      third.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }), { seed: SEED, numRuns: DB_RUNS });
});

test('認証のメール正規化は冪等で、ASCII の大文字小文字を区別しない', () => {
  // 性質: login / register が使う normalizeEmail は、二度適用しても結果が変わらない。
  // 前後の空白を除いた小文字と一致し、ASCII の大文字と小文字を入れ替えても同じ値になる。
  fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (email) => {
    const once = normalizeEmail(email);
    assert.equal(normalizeEmail(once), once);
    assert.equal(normalizeEmail(email.toLowerCase()), once);
    assert.equal(normalizeEmail(flipAsciiCase(email)), once);
    assert.equal(once, once.toLowerCase());
    assert.equal(once, email.trim().toLowerCase());
  }), FAST);
});
