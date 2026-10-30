import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyEcListing,
  attachEcSeriesLookup,
  bodyListings,
  ecLookupEnabled,
  ecPickInstruction,
  ecSeriesQueries,
  ecSeriesQuery,
  needsEcLookup,
  parseEcPick,
} from '../src/lib/capture/ec-lookup';
import { createFlashLedger } from '../src/lib/capture/flash-fallback';
import { searchLadderSteps, storeSearchKeyword } from '../src/lib/capture/product-query';
import { LOOKUP_LITE_TIMEOUT_MS, wikipediaLookupEnabled } from '../src/lib/capture/wikipedia-lookup';
import type { ProductGuess } from '../src/lib/capture/contract';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const KEY = 'test-gemini-key';
const DAY = Date.parse('2026-10-30T12:00:00.000Z');
const pixel: ProductGuess = {
  name: 'Google Pixel スマートフォン 本体',
  brand: 'Google',
  model: null,
  jan: null,
  series: 'Pixel',
  formFactor: 'foldable',
};
const listings = [
  'Google Pixel 9 Pro Fold Obsidian',
  'Google Pixel ケース',
  'Google Play ギフトカード',
  'Google Pixel フィルム',
  'Google Pixel 交換部品',
  'Google Pixel 10 Pro Fold 256GB Moonstone',
];

function geminiBody(pick: { pick: string | number; confidence: string; model?: string }) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(pick) }] } }] });
}

test('ec lookup is off unless the flag lists ec', () => {
  assert.equal(ecLookupEnabled({}), false);
  assert.equal(ecLookupEnabled({ CAPTURE_WEB_LOOKUP: 'wikipedia' }), false);
  assert.equal(ecLookupEnabled({ CAPTURE_WEB_LOOKUP: 'ec' }), true);
  assert.equal(ecLookupEnabled({ CAPTURE_WEB_LOOKUP: 'ec,wikipedia' }), true);
  assert.equal(wikipediaLookupEnabled({ CAPTURE_WEB_LOOKUP: 'ec,wikipedia' }), true);
  assert.equal(wikipediaLookupEnabled({ CAPTURE_WEB_LOOKUP: 'ec' }), false);
  assert.equal(needsEcLookup(pixel, ''), true);
  assert.equal(needsEcLookup({ ...pixel, model: 'Pixel 10 Pro Fold' }, ''), false);
  assert.equal(needsEcLookup({
    name: '白いスニーカー',
    brand: 'Balenciaga',
    model: null,
    jan: null,
    series: 'Arena',
  }), true);
  assert.equal(needsEcLookup({
    name: 'Arena ハイカット スニーカー',
    brand: 'Balenciaga',
    model: null,
    jan: null,
    series: 'Arena',
  }), false);
  assert.deepEqual(ecSeriesQueries(pixel), ['Google Pixel 本体', 'Google Pixel Fold 本体']);
  assert.deepEqual(ecSeriesQueries({ ...pixel, formFactor: 'bar' }), ['Google Pixel 本体', 'Google Pixel Fold 本体']);
  assert.equal(ecSeriesQuery(pixel), 'Google Pixel 本体');
  assert.deepEqual(ecSeriesQueries({
    name: 'HP Pavilion ノートパソコン',
    brand: 'HP',
    model: null,
    jan: null,
    series: 'Pavilion',
  }), ['HP Pavilion ノートパソコン 本体']);
  assert.deepEqual(bodyListings(listings), [
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 9 Pro Fold Obsidian',
  ]);
  assert.deepEqual(bodyListings([
    'Google Pixel 9 Pro Fold Obsidian',
    'Google Pixel 10 Pro Fold 256GB Moonstone 中古',
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 8 中古',
  ]), [
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 9 Pro Fold Obsidian',
    'Google Pixel 10 Pro Fold 256GB Moonstone 中古',
    'Google Pixel 8 中古',
  ]);
  assert.equal(LOOKUP_LITE_TIMEOUT_MS, 5_000);
  const harness = readFileSync(new URL('./eval/photo-search/live-harness.ts', import.meta.url), 'utf8');
  const ecSource = readFileSync(new URL('../src/lib/capture/ec-lookup.ts', import.meta.url), 'utf8');
  assert.equal(harness.includes('attachEcSeriesLookup'), true);
  assert.equal(harness.includes("part.trim() === 'ec'"), true);
  assert.equal(harness.includes('ledger: appFlashLiteLedger()'), true);
  assert.equal(harness.includes('ledger: appFlashLedger()'), false);
  assert.equal(harness.includes('model: GEMINI_LITE_MODEL'), true);
  assert.equal(ecSource.includes('LOOKUP_LITE_TIMEOUT_MS'), true);
});

test('the prompt may only choose a listing number, and a high pick uses that title', async () => {
  const kept = bodyListings(listings);
  const instruction = ecPickInstruction(kept);
  assert.equal(instruction.includes('none'), true);
  assert.equal(instruction.includes('一覧に無い型番を作ってはいけない'), true);
  assert.equal(instruction.includes('1. Google Pixel 10 Pro Fold 256GB Moonstone'), true);
  assert.equal(instruction.includes('2. Google Pixel 9 Pro Fold Obsidian'), true);
  const invented = parseEcPick(geminiBody({ pick: 'none', confidence: 'low', model: 'Pixel 9 Pro Fold' }), kept.length);
  assert.equal(applyEcListing(pixel, kept, invented), pixel);
  const queries: string[] = [];
  let gemini = 0;
  const picked = await attachEcSeriesLookup({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [pixel] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'ec', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger: createFlashLedger(),
    search: async (query) => {
      queries.push(query);
      return listings;
    },
    complete: async (request) => {
      gemini += 1;
      assert.equal(request.url.includes('gemini-3.5-flash-lite'), true);
      assert.equal(request.url.includes(KEY), false);
      assert.equal(request.body.includes('一覧に無い型番を作ってはいけない'), true);
      assert.equal(request.body.includes('1. Google Pixel 10 Pro Fold 256GB Moonstone'), true);
      return { status: 200, body: geminiBody({ pick: '1', confidence: 'medium' }) };
    },
  });
  assert.deepEqual(queries, ['Google Pixel 本体', 'Google Pixel Fold 本体']);
  assert.equal(gemini, 1);
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(picked.value.products[0].name, 'Google Pixel 10 Pro Fold 256GB Moonstone');
  const keywords = searchLadderSteps(picked.value.products[0]).map((step) => storeSearchKeyword(step, { maxChars: 128, maxBytes: 128 }));
  assert.equal(keywords[0].includes('10 Pro Fold'), true);
  assert.equal(keywords[0].includes('Moonstone'), true);
});

test('a Gemini 429 keeps the series query and blocks the rest of the day', async () => {
  const ledger = createFlashLedger();
  let searches = 0;
  let gemini = 0;
  const once = () => attachEcSeriesLookup({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [pixel] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'ec', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger,
    search: async () => {
      searches += 1;
      return listings;
    },
    complete: async () => {
      gemini += 1;
      return { status: 429, body: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"You exceeded your current quota"}}' };
    },
  });
  const first = await once();
  assert.equal(first.ok && first.value.products[0].name, pixel.name);
  assert.equal(gemini, 1);
  assert.equal(searches, 2);
  assert.equal(ledger.blocked(DAY), true);
  const second = await once();
  assert.equal(second.ok && second.value.products[0].name, pixel.name);
  assert.equal(gemini, 1);
  assert.equal(searches, 2);
});
