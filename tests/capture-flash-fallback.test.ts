import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSearchVariant } from '../src/lib/capture/ai-variants';
import { identifyEvidenceVariant } from '../src/lib/capture/evidence-variant';
import {
  FLASH_DAILY_CAP,
  chooseFlashFallback,
  createFlashLedger,
  flashImproves,
  flashUpgradeEligible,
  geminiQuotaExhausted,
  maybeUpgradeWithFlash,
  withFlashRetry,
} from '../src/lib/capture/flash-fallback';
import { WORKERS_AI_MODEL } from '../src/lib/capture/workers-ai';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const KEY = 'test-gemini-key';
const ACCOUNT = 'a'.repeat(32);
const DAY = Date.parse('2026-10-29T12:00:00.000Z');
const NEXT_DAY = Date.parse('2026-10-30T00:00:00.000Z');

function geminiReply(candidate: unknown) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(candidate) }] } }] });
}

function guess(confidence: 'sure' | 'unsure' | 'unreadable', name: string, brand: string | null) {
  return {
    ok: true as const,
    value: {
      confidence,
      products: confidence === 'unreadable' ? [] : [{ name, brand, model: null, jan: null }],
    },
  };
}

test('flash stays off the default model and the lite fallback', () => {
  assert.equal(FLASH_DAILY_CAP, 15);
  assert.equal(resolveSearchVariant(undefined).model.id, WORKERS_AI_MODEL);
  assert.equal(resolveSearchVariant('llama4-gemini-fallback').flashFallback, undefined);
  assert.equal(resolveSearchVariant('llama4-gemini-fallback').secondModel?.id, 'gemini-3.5-flash-lite');
  assert.equal(resolveSearchVariant('gemini').flashFallback, undefined);
  assert.equal(resolveSearchVariant('llama4-evidence').flashFallback, true);
  assert.equal(resolveSearchVariant('gemini-lite-evidence').flashFallback, true);
  assert.equal(resolveSearchVariant('llama4-evidence').secondModel?.id, 'gemini-3.5-flash-lite');
  const fallback = readFileSync(new URL('../src/lib/capture/gemini-fallback.ts', import.meta.url), 'utf8');
  const harness = readFileSync(new URL('./eval/photo-search/live-harness.ts', import.meta.url), 'utf8');
  assert.equal(fallback.includes('flash-fallback'), false);
  assert.equal(fallback.includes('GEMINI_DEFAULT_MODEL'), false);
  assert.equal(harness.includes('maybeUpgradeWithFlash'), true);
  assert.equal(harness.includes('withFlashRetry'), true);
  assert.equal(harness.includes("GEMINI_EVIDENCE_SUFFIX, 'flash'"), true);
  assert.equal(harness.includes('GEMINI_DEFAULT_MODEL'), true);
  assert.equal(harness.includes('variant.flashFallback === true'), true);
});

test('only a low-confidence unbranded shoe, bag, or garment can call flash', () => {
  assert.equal(flashUpgradeEligible(guess('unsure', '白いスニーカー', null)), true);
  assert.equal(flashUpgradeEligible(guess('unsure', 'トートバッグ', null)), true);
  assert.equal(flashUpgradeEligible(guess('unsure', 'デニムジャケット', null)), true);
  assert.equal(flashUpgradeEligible(guess('unsure', '青いジーンズ', null)), true);
  assert.equal(flashUpgradeEligible(guess('unsure', '白いTシャツ', null)), true);
  assert.equal(flashUpgradeEligible(guess('sure', '白いスニーカー', null)), false);
  assert.equal(flashUpgradeEligible(guess('unsure', 'Balenciaga スニーカー', 'Balenciaga')), false);
  assert.equal(flashUpgradeEligible(guess('unsure', 'Bose ヘッドホン', null)), false);
  assert.equal(flashUpgradeEligible(guess('unsure', '腕時計', null)), false);
  assert.equal(flashUpgradeEligible(guess('unsure', '香水', null)), false);
  assert.equal(flashUpgradeEligible(guess('unreadable', '', null)), false);
  assert.equal(flashUpgradeEligible(guess('unsure', 'ナイキ スニーカー', null)), false);
  assert.equal(flashUpgradeEligible(guess('unsure', 'Arena スニーカー', null)), false);
  assert.equal(flashUpgradeEligible({
    ok: true,
    value: { confidence: 'unsure', products: [{ name: '白いスニーカー', brand: null, model: 'Arena' }] },
  }), false);
  assert.equal(flashImproves(
    guess('unsure', '白いスニーカー', null).value,
    guess('unsure', 'Balenciaga', null),
  ), false);
  assert.equal(flashImproves(
    guess('unsure', '白いスニーカー', null).value,
    guess('unsure', 'Balenciaga スニーカー', 'Balenciaga'),
  ), true);
});

test('the flash ledger stops at 15 calls and starts again the next UTC day', () => {
  const ledger = createFlashLedger();
  for (let index = 0; index < 15; index += 1) assert.equal(ledger.tryConsume(DAY), true);
  assert.equal(ledger.tryConsume(DAY), false);
  assert.equal(ledger.used(DAY), 15);
  assert.equal(ledger.tryConsume(NEXT_DAY), true);
  assert.equal(createFlashLedger().used(DAY), 0);
});

test('a disabled flag and a failed flash call do not replace the lite guess', async () => {
  const current = guess('unsure', '白いスニーカー', null);
  let calls = 0;
  const skipped = await maybeUpgradeWithFlash({
    enabled: false,
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    guess: current,
    now: DAY,
    ledger: createFlashLedger(),
    flash: { async identify() { calls += 1; return guess('unsure', 'Balenciaga スニーカー', 'Balenciaga'); } },
  });
  assert.equal(calls, 0);
  assert.equal(skipped.usedFlash, false);
  assert.equal(skipped.guess, current);

  const kept = await maybeUpgradeWithFlash({
    enabled: true,
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    guess: current,
    now: DAY,
    ledger: createFlashLedger(),
    flash: { async identify() { calls += 1; return { ok: false as const }; } },
  });
  assert.equal(calls, 1);
  assert.equal(kept.usedFlash, true);
  assert.equal(kept.guess.value?.products[0].name, '白いスニーカー');
});

test('a Flash 429 is not retried and blocks the rest of the UTC day', async () => {
  assert.equal(geminiQuotaExhausted(429), true);
  assert.equal(geminiQuotaExhausted(503), false);
  assert.equal(geminiQuotaExhausted(403, '{"error":{"status":"RESOURCE_EXHAUSTED"}}'), true);
  let slept = 0;
  let calls = 0;
  const quota = await withFlashRetry({
    sleep: async () => { slept += 1; },
    run: async () => {
      calls += 1;
      return { status: calls === 1 ? 429 : 200, body: 'You exceeded your current quota', value: calls };
    },
  });
  assert.equal(calls, 1);
  assert.equal(quota.quotaExceeded, true);
  assert.equal(quota.value, 1);
  assert.equal(slept, 0);

  calls = 0;
  const unavailable = await withFlashRetry({
    sleep: async () => { slept += 1; },
    run: async () => {
      calls += 1;
      return { status: 503, value: calls };
    },
  });
  assert.equal(calls, 2);
  assert.equal(unavailable.quotaExceeded, false);
  assert.equal(unavailable.value, 2);
  assert.equal(slept, 1);

  const ledger = createFlashLedger();
  const shoe = guess('unsure', '白いスニーカー', null);
  let flashCalls = 0;
  let liteCalls = 0;
  const once = () => maybeUpgradeWithFlash({
    enabled: true,
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    guess: shoe,
    now: DAY,
    ledger,
    flash: { async identify() { flashCalls += 1; return { ok: false, quotaExceeded: true }; } },
    lite: { async identify() { liteCalls += 1; return guess('unsure', 'Balenciaga スニーカー', 'Balenciaga'); } },
  });
  const first = await once();
  const second = await once();
  assert.equal(flashCalls, 1);
  assert.equal(liteCalls, 0);
  assert.equal(first.guess.value?.products[0].name, '白いスニーカー');
  assert.equal(second.usedFlash, false);
  assert.equal(ledger.tryConsume(NEXT_DAY), true);

  const empty = { ok: true as const, value: { confidence: 'unreadable' as const, products: [] as { name: string; brand: null }[] } };
  const liteGuess = guess('unsure', '白いスニーカー', null);
  assert.equal(chooseFlashFallback(empty, liteGuess).value?.products[0].name, '白いスニーカー');
  assert.equal(chooseFlashFallback(shoe, liteGuess), shoe);
});

test('llama4-evidence keeps the current guess after one Flash 429', async () => {
  const ledger = createFlashLedger();
  let flashHttp = 0;
  const run = () => identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence', GEMINI_API_KEY: KEY },
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'flash-429',
    now: DAY,
    flashLedger: ledger,
    budget: {
      tryBegin() { return { ok: true, token: 1 }; },
      settle() {},
      trip() {},
      usedNeurons() { return 0; },
    },
    workersHttp: async () => ({
      status: 200,
      body: JSON.stringify({
        success: true,
        result: { response: JSON.stringify({ confidence: 'unsure', products: [{ name: '白いスニーカー', brand: null, model: null, productType: 'スニーカー', jan: null }] }) },
      }),
    }),
    geminiHttp: async (request) => {
      flashHttp += 1;
      assert.equal(request.url.includes('/models/gemini-3.5-flash:generateContent'), true);
      return { status: 429, body: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"You exceeded your current quota"}}' };
    },
    search: async () => ({ hits: 3, value: null }),
  });
  const first = await run();
  assert.equal(first?.ok, true);
  if (!first?.ok) return;
  assert.equal(first.value.products[0].name.includes('スニーカー'), true);
  assert.equal(first.value.products[0].brand, null);
  assert.equal(flashHttp, 1);
  await run();
  assert.equal(flashHttp, 1);
});

test('llama4-evidence calls flash once for an unbranded shoe and then stops at the daily cap', async () => {
  const ledger = createFlashLedger();
  let flashCalls = 0;
  const once = async () => identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence', GEMINI_API_KEY: KEY },
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'flash',
    now: DAY,
    flashLedger: ledger,
    budget: {
      tryBegin() { return { ok: true, token: 1 }; },
      settle() {},
      trip() {},
      usedNeurons() { return 0; },
    },
    workersHttp: async () => ({
      status: 200,
      body: JSON.stringify({ success: true, result: { response: JSON.stringify({ confidence: 'unreadable', products: [] }) } }),
    }),
    geminiHttp: async (request) => {
      if (request.url.includes('gemini-3.5-flash-lite')) {
        return {
          status: 200,
          body: geminiReply({
            confidence: 'unsure',
            category: 'スニーカー',
            brand: '',
            productName: '白いスニーカー',
            evidence: '',
            queries: ['白いスニーカー'],
          }),
        };
      }
      flashCalls += 1;
      assert.equal(request.url.includes('/models/gemini-3.5-flash:generateContent'), true);
      assert.equal(request.body.includes('靴は靴'), true);
      return {
        status: 200,
        body: geminiReply({
          confidence: 'unsure',
          category: 'スニーカー',
          brand: 'Balenciaga',
          productName: 'Balenciaga スニーカー',
          evidence: '金具の形',
          queries: ['Balenciaga スニーカー'],
        }),
      };
    },
    search: async () => ({ hits: 1, value: null }),
  });
  const first = await once();
  assert.equal(first?.ok, true);
  if (!first?.ok) return;
  assert.equal(first.value.products[0].brand, 'Balenciaga');
  assert.equal(first.value.products[0].name.includes('スニーカー'), true);
  assert.equal(flashCalls, 1);
  for (let index = 1; index < 15; index += 1) await once();
  assert.equal(flashCalls, 15);
  const blocked = await once();
  assert.equal(flashCalls, 15);
  assert.equal(blocked?.ok, true);
  if (!blocked?.ok) return;
  assert.equal(blocked.value.products[0].brand, null);
  assert.equal(blocked.value.products[0].name.includes('スニーカー'), true);
});
