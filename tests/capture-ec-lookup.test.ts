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

function geminiBody(pick: Record<string, unknown>) {
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
  assert.equal(needsEcLookup(pixel, '5G'), true);
  assert.equal(needsEcLookup(pixel, '256'), true);
  assert.equal(needsEcLookup(pixel, '2024'), true);
  assert.equal(needsEcLookup(pixel, 'SM-S918'), false);
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
  assert.deepEqual(bodyListings(listings, 20, 'Pixel'), [
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 9 Pro Fold Obsidian',
  ]);
  assert.deepEqual(bodyListings([
    'Google Pixel 9 Pro Fold Obsidian',
    'Google Pixel 10 Pro Fold 256GB Moonstone 中古',
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 8 中古',
  ], 20, 'Pixel'), [
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 9 Pro Fold Obsidian',
    'Google Pixel 10 Pro Fold 256GB Moonstone 中古',
    'Google Pixel 8 中古',
  ]);
  assert.deepEqual(bodyListings([
    'HP Pavilion Android15 ノート',
    'HP Pavilion 16GB メモリ',
    'HP 16-ag000jp ノート Pavilion',
    'バッテリー HT03XL',
    'HP Pavilion 充電器',
    '互換 ACアダプター',
    'HP Pavilion 15 ノートパソコン 新品',
  ], 20, 'Pavilion'), [
    'HP Pavilion 15 ノートパソコン 新品',
    'HP Pavilion Android15 ノート',
    'HP Pavilion 16GB メモリ',
    'HP 16-ag000jp ノート Pavilion',
  ]);
  assert.equal(LOOKUP_LITE_TIMEOUT_MS, 5_000);
  const harness = readFileSync(new URL('./eval/photo-search/live-harness.ts', import.meta.url), 'utf8');
  const ecSource = readFileSync(new URL('../src/lib/capture/ec-lookup.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/capture/identify/route.ts', import.meta.url), 'utf8');
  assert.equal(harness.includes('attachEcSeriesLookup'), true);
  assert.equal(harness.includes("part.trim() === 'ec'"), true);
  assert.equal(harness.includes('ledger: appFlashLiteLedger()'), true);
  assert.equal(harness.includes('ledger: appFlashLedger()'), false);
  assert.equal(harness.includes('model: GEMINI_LITE_MODEL'), true);
  assert.equal(harness.includes('lookup: true'), true);
  assert.equal(harness.includes('ecPick: true'), true);
  assert.equal(harness.includes('numberedPrompt'), true);
  assert.equal(ecSource.includes('番号付き一覧'), true);
  assert.equal(route.includes('lookup: true'), true);
  assert.equal(route.includes('logSearchRefusal'), true);
  assert.equal(/process\.env/.test(route), false);
  assert.equal(ecSource.includes('LOOKUP_LITE_TIMEOUT_MS'), true);
});

test('the prompt may only choose a listing number, and a high pick uses that title', async () => {
  const kept = bodyListings(listings, 20, 'Pixel');
  const instruction = ecPickInstruction(kept, 'Google のスマートフォン（Pixel 系）');
  assert.equal(instruction.includes('ヒンジ'), true);
  assert.equal(instruction.includes('カメラバー'), true);
  assert.equal(instruction.includes('番号付き一覧'), true);
  assert.equal(instruction.includes('Pixel 10 Pro Fold'), true);
  assert.equal(instruction.includes('世代を決められない根拠で high にしてはいけない'), true);
  assert.equal(instruction.includes('一覧に無い機種名は作らない'), true);
  assert.equal(instruction.includes('1. Google Pixel 10 Pro Fold 256GB Moonstone'), true);
  assert.equal(instruction.includes('2. Google Pixel 9 Pro Fold Obsidian'), true);
  const invented = parseEcPick(geminiBody({ index: null, confidence: 'low', model: 'Pixel 9 Pro Fold' }), kept.length);
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
      const body = JSON.parse(request.body) as { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[] };
      const parts = body.contents[0].parts;
      assert.equal(parts[0].inlineData?.mimeType, 'image/jpeg');
      assert.equal(parts[0].inlineData?.data, Buffer.from(jpeg).toString('base64'));
      assert.equal(parts[1].text?.includes('ヒンジ'), true);
      assert.equal(parts[1].text?.includes('1. Google Pixel 10 Pro Fold 256GB Moonstone'), true);
      assert.equal(request.body.includes('"index"'), true);
      return { status: 200, body: geminiBody({ index: 1, model: 'Pixel 10 Pro Fold', color: 'Moonstone', confidence: 'medium', evidence: '折り目' }) };
    },
  });
  assert.deepEqual(queries, ['Google Pixel 本体', 'Google Pixel Fold 本体']);
  assert.equal(gemini, 1);
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(picked.value.products[0].name, 'Google Pixel 10 Pro Fold Moonstone');
  assert.equal(picked.value.products[0].model, 'Pixel 10 Pro Fold Moonstone');
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

const recordedPixelListings = [
  '【中古】Google Pixel Fold 256GB Bランク スマホ 本体 SIMフリー 美品 リファービッシュ',
  'アラミドケース Google Pixel 11 10 9 Pro Fold Google Pixel Fold ケース カバー',
  'Google Pixel 10 Pro Fold フィルム 保護フィルム 耐衝撃 本体 保護',
  '【新品】Google Pixel fold 256GB Obsidian SIMフリー',
  '【新品】Google グーグル Pixel 10 Pro Fold 256GB Moonstone SIMフリー',
  '★Google LLC（グーグル） / Google Google Pixel 10 Pro Fold 256GB SIMフリー [Moonstone]',
  '「新品 未開封品」SIMフリー Google Pixel 10 Pro Fold [256GB/512GB][Moonstone][Jade]',
  'Google Pixel 10 Pro Fold 256GB SIMフリー [Moonstone][ラッピング可]',
  '【新品】Google Pixel 10 Pro Fold 512GB SIMフリー Moonstone',
  '新品 未開封 /Google ストア版 SIMフリー Google Pixel11 pro fold 256GB',
  'バッテリー HT03XL',
];

test('a recorded shop list can pick the Pixel 10 Pro Fold series without a color', async () => {
  const kept = bodyListings(recordedPixelListings, 20, 'Pixel');
  assert.equal(kept.some((title) => title.includes('ケース') || title.includes('フィルム') || title.includes('バッテリー')), false);
  assert.equal(kept.filter((title) => title.includes('10 Pro Fold') && title.includes('Moonstone')).length >= 4, true);
  const index = kept.findIndex((title) => title.includes('256GB Moonstone SIMフリー'));
  assert.equal(index >= 0, true);
  const uncertain = parseEcPick(geminiBody({
    index: index + 1,
    model: 'Pixel 10 Pro Fold',
    color: '',
    confidence: 'high',
    evidence: '閉じた折り目と横長のカメラバー',
  }), kept.length);
  const seriesPick = applyEcListing(pixel, kept, uncertain);
  assert.equal(seriesPick.name, 'Google Pixel Pro Fold 本体');
  assert.equal(seriesPick.model, 'Pixel Pro Fold');
  assert.equal(/\d/.test(seriesPick.model ?? ''), false);
  const wrongGeneration = parseEcPick(geminiBody({
    index: index + 1,
    model: 'Pixel 9 Pro Fold',
    color: 'Moonstone',
    confidence: 'high',
    evidence: '一覧に無い',
  }), kept.length);
  assert.equal(applyEcListing(pixel, kept, wrongGeneration), pixel);
  const seen: string[] = [];
  const picked = await attachEcSeriesLookup({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [{ ...pixel, formFactor: 'bar' }] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'ec', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger: createFlashLedger(),
    search: async () => recordedPixelListings,
    complete: async (request) => {
      const body = JSON.parse(request.body) as { contents: { parts: { inlineData?: { data: string }; text?: string }[] }[] };
      assert.equal(body.contents[0].parts[0].inlineData?.data, Buffer.from(jpeg).toString('base64'));
      const text = body.contents[0].parts[1].text ?? '';
      assert.equal(text.includes('256GB Moonstone'), true);
      assert.equal(text.includes('形と色で系列は選んでよい'), true);
      const line = text.split('\n').find((item) => /^\d+\. /.test(item) && item.includes('256GB Moonstone SIMフリー'));
      seen.push(line ?? '');
      const number = Number((line ?? '').match(/^(\d+)\. /)?.[1]);
      return {
        status: 200,
        body: geminiBody({ index: number, model: 'Pixel 10 Pro Fold', color: '', confidence: 'high', evidence: '折り目' }),
      };
    },
  });
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(picked.value.products[0].name, 'Google Pixel Pro Fold 本体');
  assert.equal(/\d/.test(String(picked.value.products[0].model)), false);
});

const mixedFoldListings = [
  '【新品】Google Pixel 10 Pro Fold 256GB Moonstone SIMフリー',
  'Google Pixel 10 Pro Fold 256GB SIMフリー [Moonstone]',
  '【新品】Google Pixel 10 Pro Fold 512GB SIMフリー Moonstone',
  '★Google Google Pixel 10 Pro Fold 256GB SIMフリー [Moonstone]',
  'Google Pixel 11 Pro Fold 256GB Obsidian',
  '新品 Google Pixel 11 pro fold 256GB',
  'Google Pixel 11 Pro Fold 512GB SIMフリー',
  'Google Pixel 11 Pro Fold 256GB Jade',
];

test('generic fold evidence does not rewrite a mixed list to one generation', () => {
  const kept = bodyListings(mixedFoldListings, 20, 'Pixel');
  const index = kept.findIndex((title) => /pixel\s*11 pro fold/i.test(title));
  assert.equal(index >= 0, true);
  const generic = parseEcPick(geminiBody({
    index: index + 1,
    model: 'Pixel 11 Pro Fold',
    color: '',
    confidence: 'high',
    evidence: 'fold shape, camera module, Google logo',
  }), kept.length);
  const rewritten = applyEcListing(pixel, kept, generic);
  assert.equal(rewritten.name, 'Google Pixel Pro Fold 本体');
  assert.equal(rewritten.model, 'Pixel Pro Fold');
  assert.equal(rewritten.name.includes('11'), false);
  assert.equal(rewritten.name.includes('10'), false);
  const keywords = searchLadderSteps(rewritten).map((step) => storeSearchKeyword(step, { maxChars: 128, maxBytes: 128 }));
  assert.equal(keywords[0], 'Google Pixel Pro Fold 本体');
  const mismatch = parseEcPick(geminiBody({
    index: index + 1,
    model: 'Pixel 9 Pro Fold',
    color: '',
    confidence: 'high',
    evidence: '背面に 11 と読める',
  }), kept.length);
  assert.equal(applyEcListing(pixel, kept, mismatch), pixel);
  const readable = parseEcPick(geminiBody({
    index: index + 1,
    model: 'Pixel 11 Pro Fold',
    color: '',
    confidence: 'high',
    evidence: '背面に 11 と読める',
  }), kept.length);
  const keptGeneration = applyEcListing(pixel, kept, readable);
  assert.equal(keptGeneration.name.includes('11'), true);
  assert.equal(keptGeneration.name.includes('Pixel 11 Pro Fold'), true);
});

test('a color may choose a generation only when that color belongs to one generation', () => {
  const kept = bodyListings(mixedFoldListings, 20, 'Pixel');
  const moonstone = kept.findIndex((title) => title.includes('Moonstone'));
  const byColor = parseEcPick(geminiBody({
    index: moonstone + 1,
    model: 'Pixel 10 Pro Fold',
    color: 'Moonstone',
    confidence: 'high',
    evidence: 'fold shape, camera module, Google logo',
  }), kept.length);
  const colored = applyEcListing(pixel, kept, byColor);
  assert.equal(colored.name, 'Google Pixel 10 Pro Fold Moonstone');
  const shared = [
    'Google Pixel 10 Pro Fold 256GB Moonstone',
    'Google Pixel 11 Pro Fold 256GB Moonstone',
  ];
  const both = parseEcPick(geminiBody({
    index: 1,
    model: 'Pixel 10 Pro Fold',
    color: 'Moonstone',
    confidence: 'sure',
    evidence: 'grey-blue camera bar and Google logo',
  }), shared.length);
  const tied = applyEcListing(pixel, shared, both);
  assert.equal(tied.name, 'Google Pixel Pro Fold 本体');
  assert.equal(tied.name.includes('10'), false);
  assert.equal(tied.name.includes('11'), false);
});
