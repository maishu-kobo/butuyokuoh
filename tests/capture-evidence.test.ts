import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelIdFromEnv, resolveSearchVariant } from '../src/lib/capture/ai-variants';
import { EVIDENCE_BRAND_RULES, GEMINI_EVIDENCE_SUFFIX, WORKERS_EVIDENCE_SUFFIX } from '../src/lib/capture/evidence-prompt';
import { identifyEvidenceVariant, selectedEvidenceMode } from '../src/lib/capture/evidence-variant';
import { createGeminiIdentifier, type GeminiHttpRequest } from '../src/lib/capture/gemini';
import { attachEcSeriesLookup, ecLookupEnabled } from '../src/lib/capture/ec-lookup';
import { attachWikipediaModel, wikipediaLookupEnabled } from '../src/lib/capture/wikipedia-lookup';
import { AI_LIMIT_MESSAGE, createAiBudget, createWorkersAiIdentifier, WORKERS_AI_MODEL, type WorkersAiHttpRequest } from '../src/lib/capture/workers-ai';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const KEY = 'test-gemini-key';
const ACCOUNT = 'a'.repeat(32);

function geminiReply(candidate: unknown) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(candidate) }] } }],
  });
}

test('evidence prompts name a brand only with visible evidence and keep the product type', () => {
  for (const text of [EVIDENCE_BRAND_RULES, WORKERS_EVIDENCE_SUFFIX, GEMINI_EVIDENCE_SUFFIX]) {
    assert.equal(text.includes('見える根拠があるときだけ'), true);
    assert.equal(text.includes('読めるブランドの文字'), true);
    assert.equal(text.includes('印刷された文字'), true);
    assert.equal(text.includes('ロゴでなくても必ず根拠'), true);
    assert.equal(text.includes('足床'), true);
    assert.equal(text.includes('ブランド名だけにしない'), true);
    assert.equal(text.includes('靴は靴'), true);
    assert.equal(text.includes('バレンシアガ'), false);
  }
  assert.equal(WORKERS_EVIDENCE_SUFFIX.includes('visibleText'), true);
  assert.equal(GEMINI_EVIDENCE_SUFFIX.includes('evidence'), true);
  assert.equal(selectedEvidenceMode({}), null);
  assert.equal(selectedEvidenceMode({ CAPTURE_AI_MODEL: 'llama32' }), null);
  assert.equal(selectedEvidenceMode({ CAPTURE_AI_MODEL: 'llama4-gemini-fallback' }), null);
  assert.equal(selectedEvidenceMode({ CAPTURE_AI_MODEL: 'llama4-evidence' }), 'llama4');
  assert.equal(selectedEvidenceMode({ CAPTURE_AI_MODEL: 'gemini-lite-evidence' }), 'lite');
});

test('the evidence variants are opt-in and the production default stays llama 3.2', () => {
  assert.equal(resolveSearchVariant(undefined).model.id, WORKERS_AI_MODEL);
  assert.equal(resolveSearchVariant('llama4-gemini-fallback').evidencePrompt, undefined);
  assert.equal(resolveSearchVariant('llama4-gemini-fallback').secondModel?.id, 'gemini-3.5-flash-lite');
  const llama = resolveSearchVariant('llama4-evidence');
  assert.equal(llama.evidencePrompt, true);
  assert.equal(llama.provider, 'fallback');
  assert.equal(llama.model.id, '@cf/meta/llama-4-scout-17b-16e-instruct');
  assert.equal(llama.secondModel?.id, 'gemini-3.5-flash-lite');
  assert.equal(llama.brandGuard, true);
  assert.equal(resolveSearchVariant('gemini-lite-evidence').brandGuard, undefined);
  const lite = resolveSearchVariant('gemini-lite-evidence');
  assert.equal(lite.evidencePrompt, true);
  assert.equal(lite.provider, 'gemini');
  assert.equal(lite.model.id, 'gemini-3.5-flash-lite');
  assert.equal(lite.ladder, true);
  const route = readFileSync(new URL('../src/app/api/capture/identify/route.ts', import.meta.url), 'utf8');
  const harness = readFileSync(new URL('./eval/photo-search/live-harness.ts', import.meta.url), 'utf8');
  assert.equal(/process\.env/.test(route), false);
  assert.equal(route.indexOf('await identifyEvidenceVariant(') < route.indexOf('geminiIdentifierForEnv({'), true);
  assert.equal(harness.includes('GEMINI_EVIDENCE_SUFFIX'), true);
  assert.equal(harness.includes('WORKERS_EVIDENCE_SUFFIX'), true);
  assert.equal(harness.includes("evidencePrompt ? 'gemini-lite'"), true);
});

test('the default gemini and workers prompts stay free of the evidence rule', async () => {
  const geminiCalls: GeminiHttpRequest[] = [];
  const plain = createGeminiIdentifier({
    apiKey: KEY,
    model: 'gemini-3.5-flash-lite',
    http: async (request) => {
      geminiCalls.push(request);
      return { status: 200, body: geminiReply({ confidence: 'unsure', productName: '白いスニーカー', category: 'スニーカー', brand: '', queries: ['スニーカー'] }) };
    },
  });
  await plain.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  const plainBody = JSON.parse(geminiCalls[0].body) as { generationConfig: { responseSchema: { required: string[]; properties: Record<string, unknown> } } };
  assert.equal(geminiCalls[0].body.includes('足床'), false);
  assert.equal(plainBody.generationConfig.responseSchema.properties.evidence, undefined);

  const workerCalls: WorkersAiHttpRequest[] = [];
  const workers = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'plain',
    model: '@cf/meta/llama-4-scout-17b-16e-instruct',
    now: () => 1_000,
    http: async (request) => {
      workerCalls.push(request);
      return { status: 200, body: JSON.stringify({ success: true, result: { response: JSON.stringify({ confidence: 'unsure', products: [{ name: '白いスニーカー', brand: null, model: null, productType: 'スニーカー', jan: null }] }) } }) };
    },
  });
  await workers.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(workerCalls[0].body.includes('足床'), false);
});

test('an evidence gemini guess keeps shoes on a brand and records the evidence', async () => {
  const calls: GeminiHttpRequest[] = [];
  const identifier = createGeminiIdentifier({
    apiKey: KEY,
    model: 'gemini-3.5-flash-lite',
    instructionSuffix: GEMINI_EVIDENCE_SUFFIX,
    http: async (request) => {
      calls.push(request);
      return {
        status: 200,
        body: geminiReply({
          confidence: 'unsure',
          category: 'スニーカー',
          brand: 'Balenciaga',
          model: '',
          productName: 'Balenciaga',
          color: '白',
          evidence: '金具の形',
          queries: ['Balenciaga スニーカー'],
        }),
      };
    },
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  const body = JSON.parse(calls[0].body) as { generationConfig: { responseSchema: { required: string[] } } };
  assert.equal(calls[0].url.includes('gemini-3.5-flash-lite'), true);
  assert.equal(calls[0].body.includes('足床'), true);
  assert.equal(calls[0].body.includes('ブランド名だけにしない'), true);
  assert.equal(body.generationConfig.responseSchema.required.includes('evidence'), true);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].brand, 'Balenciaga');
  assert.equal(result.value.products[0].name.includes('スニーカー'), true);
  assert.equal(result.value.products[0].name === 'Balenciaga', false);
  assert.equal(result.value.evidence?.visibleText, '金具の形');
});

test('llama4-evidence demotes a sure MLB on a watch and keeps a sure A.L.B', async () => {
  const openBudget = {
    tryBegin() { return { ok: true as const, token: 1 }; },
    settle() {},
    trip() {},
    usedNeurons() { return 0 },
  };
  const run = (body: unknown) => identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence' },
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'mlb-watch',
    budget: openBudget,
    workersHttp: async () => ({
      status: 200,
      body: JSON.stringify({ success: true, result: { response: JSON.stringify(body) } }),
    }),
    search: async () => ({ hits: 2, value: null }),
  });
  const mlb = await run({
    confidence: 'sure',
    products: [{ name: 'MLB 腕時計', brand: 'MLB', model: null, productType: '腕時計', color: 'シルバー', visibleText: 'MLB', jan: null }],
  });
  assert.equal(mlb?.ok, true);
  if (!mlb?.ok) return;
  assert.equal(mlb.value.confidence, 'unsure');
  assert.equal(mlb.value.products[0].brand, null);
  assert.equal(mlb.value.products[0].name.includes('MLB'), false);
  assert.equal(mlb.value.products[0].name.includes('腕時計'), true);

  const alb = await run({
    confidence: 'sure',
    products: [{ name: 'A.L.B 腕時計', brand: 'A.L.B', model: null, productType: '腕時計', color: 'シルバー', visibleText: 'ALB', jan: null }],
  });
  assert.equal(alb?.ok, true);
  if (!alb?.ok) return;
  assert.equal(alb.value.confidence, 'sure');
  assert.equal(alb.value.products[0].brand, 'A.L.B');
  assert.equal(alb.value.products[0].name.includes('腕時計'), true);
});

test('llama4-evidence uses the evidence prompt and lite only after an unreadable guess', async () => {
  const urls: string[] = [];
  const result = await identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence', GEMINI_API_KEY: KEY },
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'evidence',
    budget: {
      tryBegin() { return { ok: true, token: 1 }; },
      settle() {},
      trip() {},
      usedNeurons() { return 0; },
    },
    workersHttp: async (request) => {
      urls.push(request.url);
      assert.equal(request.body.includes('足床'), true);
      return { status: 200, body: JSON.stringify({ success: true, result: { response: JSON.stringify({ confidence: 'unreadable', products: [] }) } }) };
    },
    geminiHttp: async (request) => {
      urls.push(request.url);
      assert.equal(request.url.includes('gemini-3.5-flash-lite'), true);
      assert.equal(request.url.includes('gemini-3.5-flash-lite') && !request.url.includes('models/gemini-3.5-flash:'), true);
      assert.equal(request.body.includes('靴は靴'), true);
      return {
        status: 200,
        body: geminiReply({
          confidence: 'unsure',
          category: 'スニーカー',
          brand: 'Balenciaga',
          productName: 'Balenciaga スニーカー',
          evidence: 'ロゴの文字',
          queries: ['Balenciaga スニーカー'],
        }),
      };
    },
    search: async () => ({ hits: 2, value: null }),
  });
  assert.equal(urls.some((url) => url.includes('llama-4-scout')), true);
  assert.equal(urls.some((url) => url.includes('gemini-3.5-flash-lite')), true);
  assert.equal(result?.ok, true);
  if (!result?.ok) return;
  assert.equal(result.value.products[0].name.includes('スニーカー'), true);
  assert.equal(result.value.products[0].brand, 'Balenciaga');
});

test('a selected evidence variant does not fall through when its key is missing', async () => {
  const llama = await identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { return { ok: true, value: { confidence: 'sure', products: [{ name: '偽物', brand: null, model: null, jan: null }] } }; } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence' },
    accountId: null,
    apiToken: null,
    userId: '',
    search: async () => ({ hits: 0, value: null }),
  });
  assert.equal(llama?.ok, false);
  if (llama?.ok !== false) return;
  assert.equal(llama.error.code, 'AI_UNAVAILABLE');

  const lite = await identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'gemini-lite-evidence' },
    accountId: null,
    apiToken: null,
    userId: '',
    search: async () => ({ hits: 0, value: null }),
  });
  assert.equal(lite?.ok, false);
  if (lite?.ok !== false) return;
  assert.equal(lite.error.code, 'AI_UNAVAILABLE');

  const absent = await identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: {},
    accountId: null,
    apiToken: null,
    userId: '',
    search: async () => ({ hits: 0, value: null }),
  });
  assert.equal(absent, null);
});

test('llama4-evidence without a Gemini key stays on Workers AI and skips Flash and lookups', async () => {
  assert.equal(modelIdFromEnv({}), WORKERS_AI_MODEL);
  assert.equal(modelIdFromEnv({ CAPTURE_AI_MODEL: '' }), WORKERS_AI_MODEL);
  assert.equal(selectedEvidenceMode({}), null);
  assert.equal(wikipediaLookupEnabled({}), false);
  assert.equal(ecLookupEnabled({}), false);
  let workers = 0;
  let gemini = 0;
  let searches = 0;
  const started = Date.now();
  const result = await identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence' },
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'llama4-no-gemini',
    budget: createAiBudget(),
    workersHttp: async (request) => {
      workers += 1;
      assert.equal(request.url.includes('llama-4-scout'), true);
      assert.equal(request.url.includes('llama-3.2'), false);
      return {
        status: 200,
        body: JSON.stringify({
          success: true,
          result: { response: JSON.stringify({ confidence: 'sure', products: [{ name: 'Google Pixel スマートフォン 本体', brand: 'Google', model: null, series: 'Pixel', jan: null }] }) },
        }),
      };
    },
    geminiHttp: async () => {
      gemini += 1;
      throw new Error('gemini should not be called');
    },
    search: async () => {
      searches += 1;
      return { hits: 0, value: null };
    },
  });
  assert.equal(Date.now() - started < 1_000, true);
  assert.equal(workers, 1);
  assert.equal(gemini, 0);
  assert.equal(searches, 1);
  assert.equal(result?.ok, true);
  if (!result?.ok) return;
  assert.equal(result.value.products[0].brand, 'Google');
  const photo = { mediaType: 'image/jpeg', bytes: jpeg };
  const wiki = await attachWikipediaModel(photo, result, {
    env: {},
    wikiFetch: async () => { throw new Error('wikipedia should stay off'); },
    complete: async () => { gemini += 1; throw new Error('lookup gemini should stay off'); },
  });
  const ec = await attachEcSeriesLookup(photo, wiki, {
    env: {},
    search: async () => { throw new Error('lookup search should stay off'); },
    complete: async () => { gemini += 1; throw new Error('lookup gemini should stay off'); },
  });
  assert.equal(gemini, 0);
  assert.equal(ec.ok && ec.value.products[0].name, result.value.products[0].name);
});

test('llama4-evidence treats Workers AI 4006 as the daily cap and does not retry', async () => {
  const budget = createAiBudget();
  let workers = 0;
  let gemini = 0;
  let searches = 0;
  const once = () => identifyEvidenceVariant({
    photo: { mediaType: 'image/jpeg', bytes: jpeg },
    hooked: false,
    fake: { async identify() { throw new Error('unused'); } },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-evidence' },
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'llama4-cap',
    budget,
    workersHttp: async (request) => {
      workers += 1;
      assert.equal(request.url.includes('@cf/meta/llama-4-scout-17b-16e-instruct'), true);
      return {
        status: 429,
        body: JSON.stringify({
          success: false,
          errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }],
        }),
      };
    },
    geminiHttp: async () => {
      gemini += 1;
      throw new Error('gemini should not be called');
    },
    search: async () => {
      searches += 1;
      return { hits: 0, value: null };
    },
  });
  const hit = await once();
  assert.equal(hit?.ok, false);
  if (hit?.ok !== false) return;
  assert.equal(hit.error.code, 'AI_LIMIT');
  assert.equal(hit.error.error, AI_LIMIT_MESSAGE);
  assert.equal(hit.error.retryable, undefined);
  assert.equal(JSON.stringify(hit).includes('4006'), false);
  assert.equal(JSON.stringify(hit).includes('allocation'), false);
  const again = await once();
  assert.equal(again?.ok, false);
  if (again?.ok !== false) return;
  assert.equal(again.error.code, 'AI_LIMIT');
  assert.equal(workers, 1);
  assert.equal(gemini, 0);
  assert.equal(searches, 0);
});
