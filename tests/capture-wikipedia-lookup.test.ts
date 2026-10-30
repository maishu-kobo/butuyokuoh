import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFlashLedger } from '../src/lib/capture/flash-fallback';
import { searchLadderSteps, storeSearchKeyword } from '../src/lib/capture/product-query';
import {
  LOOKUP_LITE_TIMEOUT_MS,
  WIKIPEDIA_TIMEOUT_MS,
  WIKIPEDIA_USER_AGENT,
  allowedWikipediaUrl,
  applyHighConfidenceModel,
  attachWikipediaModel,
  needsWikipediaLookup,
  parseWikiPick,
  printedModelNumber,
  trimWikiText,
  wikipediaLookupEnabled,
  wikipediaQueries,
  wikipediaTitles,
  type WikiFetch,
} from '../src/lib/capture/wikipedia-lookup';
import type { ProductGuess } from '../src/lib/capture/contract';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const KEY = 'test-gemini-key';
const DAY = Date.parse('2026-10-30T00:00:00.000Z');
const pixel: ProductGuess = {
  name: 'Google Pixel スマートフォン 本体',
  brand: 'Google',
  model: null,
  jan: null,
  series: 'Pixel',
  formFactor: 'foldable',
};
const page = [
  'Google Pixel is a line of Android phones.',
  '== Design ==',
  'A closed fold with a silver camera bar.',
  '== Colors ==',
  'Moonstone and Porcelain.',
].join('\n');

function searchBody(titles: string[]) {
  return JSON.stringify({ query: { search: titles.map((title) => ({ title })) } });
}

function parseBody(wikitext: string) {
  return JSON.stringify({ parse: { wikitext } });
}

function geminiBody(pick: { model: string; confidence: string; evidence: string }) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(pick) }] } }] });
}

function wikiMock(seen: string[]): WikiFetch {
  return async (url, init) => {
    seen.push(url);
    assert.equal(init.headers['User-Agent'], WIKIPEDIA_USER_AGENT);
    assert.equal(allowedWikipediaUrl(url), true);
    const parsed = new URL(url);
    const search = parsed.searchParams.get('srsearch') ?? '';
    if (parsed.searchParams.get('action') === 'query') {
      if (search.includes('foldable') || search.includes('折りたたみ')) return { status: 200, body: searchBody([]) };
      return { status: 200, body: searchBody(['Google Pixel']) };
    }
    return { status: 200, body: parseBody(page) };
  };
}

test('printed model numbers need letter-digit tokens, not 5G, capacity, or years', () => {
  assert.equal(printedModelNumber(pixel, ''), false);
  assert.equal(printedModelNumber(pixel, '5G'), false);
  assert.equal(printedModelNumber(pixel, '256'), false);
  assert.equal(printedModelNumber(pixel, '256GB'), false);
  assert.equal(printedModelNumber(pixel, '2024'), false);
  assert.equal(printedModelNumber(pixel, 'A2631'), true);
  assert.equal(printedModelNumber(pixel, 'MG674J'), true);
  assert.equal(printedModelNumber({ ...pixel, model: 'Pixel 8' }, ''), true);
  assert.equal(printedModelNumber({ ...pixel, model: 'Pixel 10 Pro Fold' }, ''), true);
  assert.equal(needsWikipediaLookup(pixel, '5G'), true);
  assert.equal(needsWikipediaLookup(pixel, '256'), true);
  assert.equal(needsWikipediaLookup(pixel, 'A2631'), false);
});

test('wikipedia lookup stays off unless the flag is wikipedia', () => {
  assert.equal(wikipediaLookupEnabled({}), false);
  assert.equal(wikipediaLookupEnabled({ CAPTURE_WEB_LOOKUP: 'off' }), false);
  assert.equal(wikipediaLookupEnabled({ CAPTURE_WEB_LOOKUP: 'wikipedia' }), true);
  assert.equal(needsWikipediaLookup(pixel, ''), true);
  assert.equal(needsWikipediaLookup({ ...pixel, model: 'Pixel 8' }, ''), false);
  assert.equal(needsWikipediaLookup({ name: '白いスニーカー', brand: null, model: null, jan: null }), false);
  assert.equal(wikipediaQueries(pixel).first, 'Google Pixel foldable');
  assert.equal(wikipediaQueries(pixel).fallback, 'Google Pixel');
  assert.equal(allowedWikipediaUrl('https://evil.example/w/api.php'), false);
  const harness = readFileSync(new URL('./eval/photo-search/live-harness.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/app/api/capture/identify/route.ts', import.meta.url), 'utf8');
  assert.equal(harness.includes('attachWikipediaModel'), true);
  assert.equal(harness.includes('CAPTURE_WEB_LOOKUP'), true);
  assert.equal(harness.includes('ledger: appFlashLiteLedger()'), true);
  assert.equal(/process\.env/.test(route), false);
  assert.equal(LOOKUP_LITE_TIMEOUT_MS, 5_000);
  assert.equal(WIKIPEDIA_TIMEOUT_MS, 3_000);
  const wiki = readFileSync(new URL('../src/lib/capture/wikipedia-lookup.ts', import.meta.url), 'utf8');
  assert.equal(wiki.includes('setTimeout(() => controller.abort(), LOOKUP_LITE_TIMEOUT_MS)'), true);
  assert.equal(wiki.includes('setTimeout(() => controller.abort(), WIKIPEDIA_TIMEOUT_MS)'), true);
});

test('a foldable Pixel keeps the series query until Wikipedia snippets support a high pick', async () => {
  const trimmed = trimWikiText(page);
  assert.equal(trimmed.includes('Moonstone'), true);
  assert.equal(trimmed.includes('Porcelain'), true);
  assert.equal(wikipediaTitles(searchBody(['Google Pixel']))[0], 'Google Pixel');
  const low = parseWikiPick(geminiBody({ model: 'prototype', confidence: 'low', evidence: '抜粋が無い' }));
  assert.equal(applyHighConfidenceModel(pixel, low).name, pixel.name);
  const seen: string[] = [];
  let gemini = 0;
  const kept = await attachWikipediaModel({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [pixel] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'wikipedia', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger: createFlashLedger(),
    wikiFetch: wikiMock(seen),
    complete: async (request) => {
      gemini += 1;
      assert.equal(request.url.includes('gemini-3.5-flash-lite'), true);
      assert.equal(request.url.includes(KEY), false);
      assert.equal(request.body.includes('Moonstone'), true);
      return { status: 200, body: geminiBody({ model: 'prototype', confidence: 'low', evidence: '色が足りない' }) };
    },
  });
  assert.equal(gemini, 1);
  assert.equal(seen.some((url) => url.includes('foldable') || url.includes('%E6%8A%98%E3%82%8A%E3%81%9F%E3%81%9F%E3%81%BF')), true);
  assert.equal(seen.some((url) => new URL(url).searchParams.get('srsearch') === 'Google Pixel'), true);
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.value.products[0].name, pixel.name);
  assert.equal(kept.value.products[0].model, null);
});

test('high confidence from Wikipedia snippets becomes the EC query and a 429 stops the rest of the day', async () => {
  const seen: string[] = [];
  let gemini = 0;
  const ledger = createFlashLedger();
  const picked = await attachWikipediaModel({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [pixel] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'wikipedia', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger,
    wikiFetch: wikiMock(seen),
    complete: async () => {
      gemini += 1;
      return { status: 200, body: geminiBody({ model: 'Pixel 10 Pro Fold', confidence: 'high', evidence: 'Moonstone のカメラ台' }) };
    },
  });
  assert.equal(picked.ok, true);
  if (!picked.ok) return;
  assert.equal(picked.value.products[0].model, 'Pixel 10 Pro Fold');
  assert.equal(picked.value.products[0].name, 'Google Pixel 10 Pro Fold');
  const keywords = searchLadderSteps(picked.value.products[0]).map((step) => storeSearchKeyword(step, { maxChars: 128, maxBytes: 128 }));
  assert.equal(keywords[0], 'Google Pixel 10 Pro Fold');
  const callsBeforeBlock = gemini;
  const blocked = await attachWikipediaModel({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [pixel] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'wikipedia', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger,
    wikiFetch: wikiMock(seen),
    complete: async () => {
      gemini += 1;
      return { status: 429, body: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"You exceeded your current quota"}}' };
    },
  });
  assert.equal(blocked.ok, true);
  if (!blocked.ok) return;
  assert.equal(blocked.value.products[0].name, pixel.name);
  assert.equal(ledger.blocked(DAY), true);
  assert.equal(gemini, callsBeforeBlock + 1);
  const again = await attachWikipediaModel({ mediaType: 'image/jpeg', bytes: jpeg }, {
    ok: true,
    value: { confidence: 'unsure', products: [pixel] },
  }, {
    env: { CAPTURE_WEB_LOOKUP: 'wikipedia', GEMINI_API_KEY: KEY },
    now: DAY,
    ledger,
    wikiFetch: async () => { throw new Error('wikipedia should not be called'); },
    complete: async () => { gemini += 1; return { status: 200, body: '' }; },
  });
  assert.equal(again.ok && again.value.products[0].name, pixel.name);
  assert.equal(gemini, callsBeforeBlock + 1);
});
