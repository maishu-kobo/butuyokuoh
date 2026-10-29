import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { sortCandidates, type CaptureCandidate, type SearchQuery } from '../src/lib/capture/contract';
import { textQueryVariants } from '../src/lib/capture/search-attempt';
import { composeCapturedProduct } from '../src/lib/capture/product-query';
import { createYahooRateGate, createYahooSearch, type YahooFetch } from '../src/lib/capture/yahoo';
import {
  createWorkersAiIdentifier,
  type WorkersAiHttpRequest,
  type WorkersAiHttpResponse,
} from '../src/lib/capture/workers-ai';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const NOW = Date.parse('2026-10-22T00:00:00.000Z');

function cf(text: string): WorkersAiHttpResponse {
  return { status: 200, body: JSON.stringify({ success: true, result: { response: text }, errors: [], messages: [] }) };
}

function identify(raw: unknown) {
  const calls: WorkersAiHttpRequest[] = [];
  const identifier = createWorkersAiIdentifier({
    accountId: 'b'.repeat(32),
    apiToken: 'test-cloudflare-token',
    userId: 'product-query',
    now: () => 1_000,
    http: async (request) => {
      calls.push(request);
      return cf(JSON.stringify(raw));
    },
  });
  return { calls, identifier };
}

function candidate(id: string, title: string, price: number): CaptureCandidate {
  return {
    id,
    site: 'yahoo',
    title,
    price,
    url: `https://store.shopping.yahoo.co.jp/example/${id}`,
    fetchedAt: '2026-10-27T00:00:00.000Z',
    shopName: '評価ショップ',
  };
}

test('a prompt example copied as the product name is not searched', async () => {
  const { calls, identifier } = identify({
    confidence: 'sure',
    products: [{ name: 'バレンシアガ シューズ', brand: 'バレンシアガ', model: null, productType: 'シューズ', color: '白', jan: null }],
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.confidence, 'unreadable');
  assert.deepEqual(result.value.products, []);
  const instruction = JSON.parse(calls[0].body).messages[0].content as string;
  assert.equal(instruction.includes('バレンシアガ'), false);
  assert.equal(instruction.includes('「'), false);
  assert.equal(instruction.includes('example'), false);
  assert.equal(instruction.includes('ブランド名だけ'), true);
  assert.equal(instruction.includes('種類'), true);
  assert.equal(instruction.includes('世代'), true);
});

test('a photo that only shows the word example stays a pen guess', async () => {
  const { identifier } = identify({
    confidence: 'sure',
    products: [{ name: 'example', brand: null, model: null, productType: 'pen', color: 'blue', jan: null }],
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.value.confidence, 'unreadable');
  assert.equal(result.value.products[0].name.includes('ペン'), true);
  assert.equal(result.value.confidence, 'unsure');
});

test('a product type parked in the model field is moved into the searchable name', async () => {
  const { identifier } = identify({
    confidence: 'sure',
    products: [{ name: 'バレンシアガ', brand: 'バレンシアガ', model: 'スニーカー', jan: null }],
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].name, 'バレンシアガ スニーカー');
  assert.equal(result.value.products[0].model, null);
  assert.equal(result.value.confidence, 'sure');
});

test('a brand-only guess with no product type is not auto-searched', async () => {
  const { identifier } = identify({
    confidence: 'sure',
    products: [{ name: 'ロレックス', brand: 'ロレックス', model: 'ロレックス', jan: null }],
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].name, 'ロレックス');
  assert.equal(result.value.confidence, 'unsure');
});

test('shoe results outrank cheaper bags when the query names the shoe', () => {
  const query: SearchQuery = { name: 'バレンシアガ スニーカー', brand: 'バレンシアガ', model: null, jan: null };
  const sorted = sortCandidates([
    candidate('yahoo:bag', 'バレンシアガ ハンドバッグ', 3000),
    candidate('yahoo:wallet', 'バレンシアガ 財布', 2000),
    candidate('yahoo:shoe', 'バレンシアガ スニーカー トリプルS', 120000),
  ], query);
  assert.deepEqual(sorted.map((item) => item.id), ['yahoo:shoe', 'yahoo:wallet', 'yahoo:bag']);
});

test('a zero-hit query that still contains a model drops the model and keeps the product type', async () => {
  const queries: string[] = [];
  let at = NOW;
  const yahoo = createYahooSearch({
    appId: 'yahoo-app-id',
    userId: 'shoe-relax',
    gate: createYahooRateGate(),
    now: () => at,
    delay: async (ms) => {
      at += ms;
    },
    schedule: () => () => {},
    fetch: (async (url) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      queries.push(query);
      if (query === 'バレンシアガ スニーカー') {
        return new Response(JSON.stringify({ hits: [{
          name: 'バレンシアガ スニーカー',
          url: 'https://store.shopping.yahoo.co.jp/example/shoe',
          code: 'shoe',
          price: 98000,
          seller: { name: 'テストショップ' },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    }) as YahooFetch,
  });
  const result = await yahoo.search({
    name: 'バレンシアガ トリプルS スニーカー',
    brand: 'バレンシアガ',
    model: 'トリプルS',
    jan: null,
  });
  assert.deepEqual(queries, [
    'バレンシアガ トリプルS スニーカー',
    'バレンシアガ スニーカー',
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value[0].title, 'バレンシアガ スニーカー');
});

test('an ordinary name and model still relax by dropping the brand field first', () => {
  assert.deepEqual(textQueryVariants({ name: 'Mnemosyne', brand: 'human', model: 'A5', jan: null }).map((query) => [query.name, query.brand, query.model]), [
    ['Mnemosyne', 'human', 'A5'],
    ['Mnemosyne', null, 'A5'],
    ['Mnemosyne', null, null],
  ]);
});

test('brand plus a known product type never composes a brand-only name', () => {
  const brands = ['バレンシアガ', 'ナイキ', 'ソニー', '無印良品', 'ダイソン'];
  const types = ['スニーカー', 'ヘッドホン', 'トートバッグ', '口紅', '掃除機', '革靴'];
  fc.assert(fc.property(
    fc.constantFrom(...brands),
    fc.constantFrom(...types),
    fc.constantFrom('ブラック', '白', null),
    (brand, type, color) => {
      const composed = composeCapturedProduct({
        name: brand,
        brand,
        model: brand,
        productType: type,
        color,
      });
      assert.equal(composed.name.includes(brand), true);
      assert.equal(composed.name.includes(type), true);
      assert.notEqual(composed.name, brand);
      assert.equal(composed.model, null);
      if (color) assert.equal(composed.name.includes(color), true);
    },
  ), { numRuns: brands.length * types.length * 3 });
});
