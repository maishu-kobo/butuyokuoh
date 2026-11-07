import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSearchVariant, SEARCH_VARIANTS } from '../src/lib/capture/ai-variants';
import { identifyHttpBody, WORKERS_AI_MODEL } from '../src/lib/capture/workers-ai';
import {
  createGeminiIdentifier,
  dispatchGemini,
  GEMINI_TIMEOUT_MS,
  geminiConfigFromEnv,
  geminiIdentifierForEnv,
  type GeminiHttpRequest,
} from '../src/lib/capture/gemini';
import {
  type FallbackGuess,
  llama4GeminiActors,
  needsGeminiBeforeSearch,
  productionLadderSearch,
  runGeminiFallback,
} from '../src/lib/capture/gemini-fallback';
import { geminiHarnessBackoffMs, withGeminiHarnessRetry } from './eval/photo-search/gemini-retry';
import { parseGuessDocument, searchGuessRows, summarizeLiveReport } from './eval/photo-search/split-run';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const KEY = 'test-gemini-key';

function geminiReply(candidate: unknown) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(candidate) }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12, thoughtsTokenCount: 0, totalTokenCount: 32 },
  });
}

test('gemini variants stay off the production default and do not spend workers neurons', () => {
  assert.equal(SEARCH_VARIANTS[0].name, 'llama32');
  assert.equal(SEARCH_VARIANTS[0].model.id, WORKERS_AI_MODEL);
  assert.equal(SEARCH_VARIANTS[0].provider, 'workers');
  assert.equal(resolveSearchVariant(undefined).name, 'llama32');
  assert.equal(resolveSearchVariant('nope').provider, 'workers');
  for (const name of ['gemini', 'gemini-ladder', 'gemini-lite', 'gemini-lite-ladder']) {
    assert.equal(SEARCH_VARIANTS.some((variant) => variant.name === name), true, name);
  }
  const flash = resolveSearchVariant('gemini-ladder');
  const lite = resolveSearchVariant('gemini-lite-ladder');
  assert.equal(flash.provider, 'gemini');
  assert.equal(flash.ladder, true);
  assert.equal(flash.model.id, 'gemini-3.5-flash');
  assert.equal(flash.estimatedNeuronsFor23, 0);
  assert.equal(lite.model.id, 'gemini-3.5-flash-lite');
  assert.equal(lite.ladder, true);
  assert.equal(resolveSearchVariant('gemini').ladder, false);
  assert.equal(resolveSearchVariant('gemini-lite').ladder, false);
});

test('gemini config is absent unless the model is explicitly selected', () => {
  assert.equal(geminiConfigFromEnv({}), null);
  assert.equal(geminiConfigFromEnv({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-3.5-flash' }), null);
  assert.equal(geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'llama32', GEMINI_API_KEY: KEY }), null);
  const flash = geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini' });
  assert.equal(flash?.model, 'gemini-3.5-flash');
  assert.equal(flash?.apiKey, null);
  assert.equal(geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini-lite-ladder' })?.model, 'gemini-3.5-flash-lite');
  assert.equal(
    geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_API_KEY: KEY })?.model,
    'gemini-3.5-flash-lite',
  );
  assert.equal(geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: KEY })?.model, null);
  assert.equal(geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini', GEMINI_MODEL: 'gemini-2.0-flash', GEMINI_API_KEY: KEY })?.model, null);
  assert.equal(geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini', GEMINI_API_KEY: 'has space' })?.apiKey, null);
});

test('the gemini request uses the header key, json schema, and thinking budget 0', async () => {
  const calls: GeminiHttpRequest[] = [];
  const identifier = createGeminiIdentifier({
    apiKey: KEY,
    http: async (request) => {
      calls.push(request);
      return {
        status: 200,
        body: geminiReply({
          confidence: 'sure',
          category: 'スニーカー',
          brand: 'Balenciaga',
          model: 'Arena',
          productName: 'Balenciaga Arena ホワイト スニーカー',
          color: 'ホワイト',
          queries: ['Balenciaga Arena スニーカー', '白いスニーカー'],
        }),
      };
    },
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'generativelanguage.googleapis.com');
  assert.equal(url.pathname, '/v1beta/models/gemini-3.5-flash:generateContent');
  assert.equal(url.search, '');
  assert.equal(url.href.includes(KEY), false);
  assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  assert.equal(calls[0].body.includes(KEY), false);
  const body = JSON.parse(calls[0].body) as {
    generationConfig: {
      temperature: number;
      responseMimeType: string;
      responseSchema: { type: string; properties: { queries: { type: string } } };
      thinkingConfig: { thinkingLevel?: string; thinkingBudget?: number };
    };
    contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
  };
  assert.equal(body.generationConfig.temperature, 0);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
  assert.equal(body.generationConfig.responseSchema.properties.queries.type, 'ARRAY');
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, undefined);
  assert.equal(body.contents[0].parts[1].inlineData?.mimeType, 'image/jpeg');
  assert.equal(body.contents[0].parts[1].inlineData?.data, Buffer.from(jpeg).toString('base64'));
  assert.equal(JSON.stringify(body).includes('バレンシアガ'), false);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.confidence, 'sure');
  assert.equal(result.value.products[0].brand, 'Balenciaga');
  assert.equal(result.value.products[0].model, 'Arena');
  assert.equal(result.value.products[0].name.includes('スニーカー'), true);
  assert.equal(result.value.products[0].jan, null);
  assert.deepEqual(result.value.queries, ['Balenciaga Arena スニーカー', '白いスニーカー']);
  const http = identifyHttpBody(result);
  assert.equal(JSON.stringify(http.body).includes('queries'), false);
  assert.equal(JSON.stringify(http.body).includes(KEY), false);
});

test('flash-lite is addressable and a foreign model id makes no request', async () => {
  const calls: GeminiHttpRequest[] = [];
  const http = async (request: GeminiHttpRequest) => {
    calls.push(request);
    return { status: 200, body: geminiReply({ confidence: 'unreadable', productName: '', queries: [] }) };
  };
  const lite = createGeminiIdentifier({ apiKey: KEY, model: 'gemini-3.5-flash-lite', http });
  const result = await lite.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  assert.equal(new URL(calls[0].url).pathname, '/v1beta/models/gemini-3.5-flash-lite:generateContent');
  const liteBody = JSON.parse(calls[0].body) as { generationConfig: { thinkingConfig: { thinkingLevel?: string; thinkingBudget?: number } } };
  assert.equal(liteBody.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(liteBody.generationConfig.thinkingConfig.thinkingBudget, undefined);
  const before = calls.length;
  const rejected = await createGeminiIdentifier({ apiKey: KEY, model: 'gemini-2.0-flash', http })
    .identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'AI_UNAVAILABLE');
  assert.equal(calls.length, before);
  const retired = await createGeminiIdentifier({ apiKey: KEY, model: 'gemini-2.5-flash', http })
    .identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(retired.ok, false);
  const slashed = await createGeminiIdentifier({ apiKey: KEY, model: '../gemini-3.5-flash', http })
    .identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(slashed.ok, false);
  assert.equal(calls.length, before);
});

test('thought text is ignored and an ungrounded brand is not sure', async () => {
  const identifier = createGeminiIdentifier({
    apiKey: KEY,
    http: async () => ({
      status: 200,
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { thought: true, text: JSON.stringify({ confidence: 'sure', productName: '間違った靴', queries: [] }) },
              { text: JSON.stringify({
                confidence: 'sure',
                category: 'ペン',
                brand: '別ブランド',
                model: '',
                productName: '青いペン',
                color: '青',
                queries: ['example ブルー ペン', 'ペン'],
              }) },
            ],
          },
        }],
      }),
    }),
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].name.includes('ペン'), true);
  assert.equal(result.value.products[0].name.includes('間違'), false);
  assert.equal(result.value.products[0].brand, null);
  assert.equal(result.value.confidence, 'unsure');
  assert.equal(result.value.queries?.some((query) => query.includes('example')), false);
  assert.equal(result.value.queries?.includes('ペン'), true);
});

test('selecting gemini without a key does not fall through to workers', async () => {
  let calls = 0;
  const missing = geminiIdentifierForEnv({
    hooked: false,
    fake: { async identify() { throw new Error('fake'); } },
    env: { NODE_ENV: 'test' },
    geminiEnv: { CAPTURE_AI_MODEL: 'gemini' },
    http: async () => { calls += 1; return { status: 200, body: '' }; },
  });
  assert.ok(missing);
  const result = await missing!.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'AI_UNAVAILABLE');
  assert.equal(calls, 0);
  assert.equal(geminiIdentifierForEnv({
    hooked: false,
    fake: { async identify() { throw new Error('fake'); } },
    env: { NODE_ENV: 'test' },
    geminiEnv: {},
  }), null);
  const hooked = await geminiIdentifierForEnv({
    hooked: true,
    fake: { async identify() { return { ok: true, value: { confidence: 'unreadable', products: [] } }; } },
    env: { NODE_ENV: 'test', CAPTURE_TEST_HOOKS: '1' },
    geminiEnv: { CAPTURE_AI_MODEL: 'gemini', GEMINI_API_KEY: KEY },
    http: async () => { calls += 1; return { status: 200, body: '' }; },
  })!.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(hooked.ok, true);
  assert.equal(calls, 0);
});

test('the default transport refuses any host except the generative language API', async () => {
  let called = false;
  const blocked = await dispatchGemini({
    url: `https://evil.example/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`,
    method: 'POST',
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-goog-api-key': KEY },
    body: '{}',
    signal: new AbortController().signal,
  }, async () => { called = true; throw new Error('called'); });
  assert.equal(called, false);
  assert.equal(blocked.status, 0);
  let seen = '';
  let header: string | null = null;
  const allowed = await dispatchGemini({
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    method: 'POST',
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-goog-api-key': KEY },
    body: '{}',
    signal: new AbortController().signal,
  }, async (input, init) => {
    seen = input instanceof URL ? input.href : String(input);
    header = new Headers(init?.headers).get('x-goog-api-key');
    return new Response('{}', { status: 200 });
  });
  assert.equal(allowed.status, 200);
  assert.equal(seen.includes(KEY), false);
  assert.equal(header, KEY);
});

test('guesses can be scored later without another vision call', async () => {
  const parsed = parseGuessDocument({
    mode: 'guess',
    label: 'gemini-ladder',
    variant: 'gemini-ladder',
    model: 'gemini-3.5-flash',
    ladder: true,
    estimatedNeuronsFor23: 0,
    rows: [{
      id: 'balenciaga-arena',
      confidence: 'unsure',
      products: [{ name: '白いスニーカー', brand: null, model: null, jan: null }],
      neurons: 0,
    }],
  });
  assert.equal(parsed.ladder, true);
  let sawLadder = false;
  const rows = await searchGuessRows({
    rows: parsed.rows,
    truth: { 'balenciaga-arena': ['ARENA1'] },
    ladder: parsed.ladder,
    search: async (_product, ladder) => {
      sawLadder = ladder;
      return {
        ok: true,
        sent: [
          { site: 'yahoo', keyword: '白いスニーカー', status: 200 },
          { site: 'rakuten', keyword: '白いスニーカー', status: 200 },
        ],
        failures: [],
        candidates: [
          { site: 'yahoo', title: 'バレンシアガ ハンドバッグ', price: 1000 },
          { site: 'rakuten', title: '白いスニーカー ARENA1', price: 2000 },
        ],
      };
    },
  });
  assert.equal(sawLadder, true);
  const top5 = rows[0].top5 as { title: string }[];
  assert.equal(top5.length, 1);
  assert.equal(top5[0].title.includes('スニーカー'), true);
  assert.equal(rows[0].exactProductTop5, true);
  const report = summarizeLiveReport({
    label: parsed.label,
    variant: parsed.variant,
    model: parsed.model,
    ladder: parsed.ladder,
    estimatedNeuronsFor23: parsed.estimatedNeuronsFor23,
    have: { cf: false, yahoo: true, rakuten: true },
    refererSet: false,
    rows,
    truth: { 'balenciaga-arena': ['ARENA1'] },
  });
  assert.deepEqual(Object.keys(report), [
    'label', 'variant', 'model', 'ladder', 'estimatedNeuronsFor23', 'have', 'refererSet', 'neurons', 'exactProduct', 'diagnosticPoints', 'rows',
  ]);
  assert.equal(report.diagnosticPoints, (rows[0].score as { points: number }).points);
  assert.equal(report.diagnosticPoints, 3);
  assert.equal(report.neurons, 0);
  assert.equal(JSON.stringify(report).includes('http'), false);
  assert.throws(() => parseGuessDocument({ rows: [] }), /variant/);
});

test('the identify route selects gemini without reading the environment itself', () => {
  const route = readFileSync(new URL('../src/app/api/capture/identify/route.ts', import.meta.url), 'utf8');
  const gemini = readFileSync(join('src', 'lib', 'capture', 'gemini.ts'), 'utf8');
  const harness = readFileSync(join('tests', 'eval', 'photo-search', 'live-harness.ts'), 'utf8');
  assert.equal(/process\.env/.test(route), false);
  assert.equal(route.includes('GEMINI_API_KEY'), false);
  assert.ok(route.indexOf('runGeminiFallback(') < route.indexOf('geminiIdentifierForEnv('));
  assert.ok(route.indexOf('geminiIdentifierForEnv(') < route.indexOf('resolveProductIdentifier('));
  assert.equal(route.includes('runGeminiFallback'), true);
  assert.equal(harness.includes('runGeminiFallback'), true);
  assert.equal(gemini.includes('10_000'), false);
  assert.equal(harness.includes('withGeminiHarnessRetry'), true);
  assert.equal(harness.includes("provider === 'fallback'"), true);
  assert.equal(gemini.includes('process.env.GEMINI_API_KEY'), false);
  assert.equal(gemini.includes('process.env.GEMINI_MODEL'), false);
  assert.equal(gemini.includes('process.env.CAPTURE_AI_MODEL'), false);
  assert.equal(gemini.includes('console.'), false);
  assert.equal(gemini.includes('バレンシアガ'), false);
  assert.equal(gemini.includes('島津'), false);
  assert.equal(harness.includes('--mode'), true);
  assert.equal(harness.includes('searchOnly'), true);
  assert.equal(harness.includes('src/lib/db.ts'), true);
  const budgetBody = harness.slice(harness.indexOf('async function loadWorkersBudget'), harness.indexOf('async function searchOnly'));
  assert.equal(budgetBody.includes('src/lib/db.ts'), true);
  assert.equal(harness.slice(harness.indexOf('async function searchOnly')).includes('src/lib/db.ts'), false);
  const fallback = readFileSync(join('src', 'lib', 'capture', 'gemini-fallback.ts'), 'utf8');
  assert.equal(fallback.includes('process.env.GEMINI_API_KEY'), false);
  assert.equal(fallback.includes('process.env.CAPTURE_AI_MODEL'), false);
});

test('an AQ-prefixed Gemini key is sent and a dotted key stays out of the URL', async () => {
  const apiKey = 'AQ.exampleGeminiKeyValue';
  const calls: GeminiHttpRequest[] = [];
  const identifier = createGeminiIdentifier({
    apiKey,
    http: async (request) => {
      calls.push(request);
      return { status: 200, body: geminiReply({ confidence: 'unreadable', productName: '', queries: [] }) };
    },
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  assert.equal(calls[0].headers['x-goog-api-key'], apiKey);
  assert.equal(calls[0].url.includes(apiKey), false);
  assert.equal(calls[0].url.includes('.'), true);
  assert.equal(GEMINI_TIMEOUT_MS, 90_000);
  const started = Date.now();
  let tries = 0;
  await createGeminiIdentifier({
    apiKey,
    http: async () => {
      tries += 1;
      return { status: tries === 1 ? 429 : 200, body: geminiReply({ confidence: 'unreadable', productName: '', queries: [] }) };
    },
  }).identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(tries, 2);
  assert.equal(Date.now() - started < 2_000, true);
});

test('llama 4 calls Gemini only when unreadable or the ladder has no hits, and keeps a worse Gemini result', async () => {
  const photo = { mediaType: 'image/jpeg' as const, bytes: jpeg };
  const llama = {
    ok: true as const,
    value: { confidence: 'unsure' as const, products: [{ name: '白いスニーカー', brand: null, model: null, jan: null }] },
  };
  const specific = {
    ok: true as const,
    value: { confidence: 'sure' as const, products: [{ name: 'Dyson V11 掃除機', brand: 'Dyson', model: null, jan: null }] },
  };
  const geminiHit = {
    ok: true as const,
    value: { confidence: 'sure' as const, products: [{ name: 'Balenciaga Arena スニーカー', brand: 'Balenciaga', model: 'Arena', jan: null }] },
  };
  const unreadable = { ok: true as const, value: { confidence: 'unreadable' as const, products: [] } };
  const limit = { ok: false as const, error: { code: 'AI_LIMIT' }, status: 429 };
  const timeout = { ok: false as const, error: { code: 'AI_TIMEOUT' }, status: 504 };
  const vague = {
    ok: true as const,
    value: { confidence: 'sure' as const, products: [{ name: '靴', brand: null, model: null, jan: null }] },
  };
  assert.equal(needsGeminiBeforeSearch(llama), false);
  assert.equal(needsGeminiBeforeSearch(specific), false);
  assert.equal(needsGeminiBeforeSearch(vague), false);
  assert.equal(needsGeminiBeforeSearch(unreadable), true);
  assert.equal(needsGeminiBeforeSearch(limit), false);
  assert.equal(needsGeminiBeforeSearch(timeout), true);

  const searched: string[] = [];
  const hitsFor = async (name: string) => {
    searched.push(name);
    return { hits: name.includes('Balenciaga') ? 3 : name.includes('スニーカー') ? 0 : 4, value: name };
  };
  const sureKept = await runGeminiFallback({
    photo,
    primary: { async identify() { return specific; } },
    gemini: { async identify() { throw new Error('unused'); } },
    search: (product) => hitsFor(product.name),
  });
  assert.equal(sureKept.usedGemini, false);
  assert.equal(sureKept.guess.ok && sureKept.guess.value?.products[0].name.includes('Dyson'), true);
  assert.deepEqual(searched, ['Dyson V11 掃除機']);

  searched.length = 0;
  let geminiCalls = 0;
  const unsureKept = await runGeminiFallback({
    photo,
    primary: { async identify() { return llama; } },
    gemini: { async identify(): Promise<FallbackGuess> { geminiCalls += 1; return geminiHit; } },
    search: async (product) => {
      searched.push(product.name);
      return { hits: 5, value: product.name };
    },
  });
  assert.equal(geminiCalls, 0);
  assert.equal(unsureKept.usedGemini, false);
  assert.deepEqual(searched, ['白いスニーカー']);

  searched.length = 0;
  geminiCalls = 0;
  const replaced = await runGeminiFallback({
    photo,
    primary: { async identify() { return llama; } },
    gemini: { async identify(): Promise<FallbackGuess> { geminiCalls += 1; return geminiHit; } },
    search: async (product) => ({ hits: product.name.includes('Balenciaga') ? 2 : 0, value: product.name }),
  });
  assert.equal(geminiCalls, 1);
  assert.equal(replaced.usedGemini, true);
  assert.equal(replaced.guess.ok && replaced.guess.value?.products[0].brand, 'Balenciaga');
  assert.equal(replaced.found?.hits, 2);

  searched.length = 0;
  const bothEmpty = await runGeminiFallback({
    photo,
    primary: { async identify() { return llama; } },
    gemini: { async identify(): Promise<FallbackGuess> { return geminiHit; } },
    search: async () => ({ hits: 0, value: 'empty' }),
  });
  assert.equal(bothEmpty.usedGemini, false);
  assert.equal(bothEmpty.guess.ok && bothEmpty.guess.value?.products[0].name, '白いスニーカー');
  assert.equal(bothEmpty.found?.value, 'empty');

  const timedOut = await runGeminiFallback({
    photo,
    primary: { async identify() { return llama; } },
    gemini: { async identify(): Promise<FallbackGuess> { return timeout; } },
    search: async () => ({ hits: 0, value: 'llama-search' }),
  });
  assert.equal(timedOut.usedGemini, false);
  assert.equal(timedOut.guess.ok && timedOut.guess.value?.confidence, 'unsure');
  assert.equal(timedOut.found?.value, 'llama-search');

  const fromUnreadable = await runGeminiFallback({
    photo,
    primary: { async identify() { return unreadable; } },
    gemini: { async identify(): Promise<FallbackGuess> { return geminiHit; } },
    search: async (product) => ({ hits: product.name.includes('Balenciaga') ? 2 : 0, value: product.name }),
  });
  assert.equal(fromUnreadable.usedGemini, true);
  assert.equal(fromUnreadable.guess.ok && fromUnreadable.guess.value?.products[0].brand, 'Balenciaga');

  const unreadableKept = await runGeminiFallback({
    photo,
    primary: { async identify() { return unreadable; } },
    gemini: { async identify(): Promise<FallbackGuess> { return geminiHit; } },
    search: async () => ({ hits: 0, value: 'gemini-empty' }),
  });
  assert.equal(unreadableKept.usedGemini, false);
  assert.equal(unreadableKept.guess.ok && unreadableKept.guess.value?.confidence, 'unreadable');
  assert.equal(unreadableKept.found, null);

  let afterLimit = 0;
  const stopped = await runGeminiFallback({
    photo,
    primary: { async identify() { return limit; } },
    gemini: { async identify(): Promise<FallbackGuess> { afterLimit += 1; return geminiHit; } },
    search: async () => { afterLimit += 1; return { hits: 0, value: 'no' }; },
  });
  assert.equal(afterLimit, 0);
  assert.equal(stopped.guess.ok, false);

  let geminiOnOutage = 0;
  const outageKept = await runGeminiFallback({
    photo,
    primary: { async identify() { return llama; } },
    gemini: { async identify(): Promise<FallbackGuess> { geminiOnOutage += 1; return geminiHit; } },
    search: async () => ({ hits: 0, value: 'outage', failed: true }),
  });
  assert.equal(geminiOnOutage, 0);
  assert.equal(outageKept.usedGemini, false);
  assert.equal(outageKept.guess.ok && outageKept.guess.value?.products[0].name, '白いスニーカー');
  assert.equal(outageKept.found?.failed, true);

  const emptyStillFallsBack = await runGeminiFallback({
    photo,
    primary: { async identify() { return llama; } },
    gemini: { async identify(): Promise<FallbackGuess> { return geminiHit; } },
    search: async (product) => ({
      hits: product.name.includes('Balenciaga') ? 2 : 0,
      value: product.name,
    }),
  });
  assert.equal(emptyStillFallsBack.usedGemini, true);
  assert.equal(emptyStillFallsBack.guess.ok && emptyStillFallsBack.guess.value?.products[0].brand, 'Balenciaga');

  const outageSearch = await productionLadderSearch(
    { name: '白いスニーカー', brand: null, model: null, jan: null },
    {
      yahooAppId: null,
      rakutenAppId: null,
      rakutenAccessKey: null,
      rakutenAffiliateId: null,
      userId: '',
      origin: null,
      associateTag: null,
    },
  );
  assert.equal(outageSearch.hits, 0);
  assert.equal(outageSearch.failed, true);

  const fallback = resolveSearchVariant('llama4-gemini-fallback');
  assert.equal(fallback.provider, 'fallback');
  assert.equal(fallback.ladder, true);
  assert.equal(fallback.model.id, '@cf/meta/llama-4-scout-17b-16e-instruct');
  assert.equal(fallback.secondModel?.id, 'gemini-3.5-flash-lite');
  assert.equal(resolveSearchVariant(undefined).provider, 'workers');
  let called = false;
  const gated = llama4GeminiActors({
    hooked: false,
    fake: { async identify() { throw new Error('fake'); } },
    env: { NODE_ENV: 'test' },
    geminiEnv: {},
    accountId: null,
    apiToken: null,
    userId: 'member',
    geminiHttp: async () => { called = true; return { status: 200, body: '' }; },
  });
  assert.equal(gated, null);
  const selected = llama4GeminiActors({
    hooked: false,
    fake: { async identify() { throw new Error('fake'); } },
    env: { NODE_ENV: 'test' },
    geminiEnv: { CAPTURE_AI_MODEL: 'llama4-gemini-fallback', GEMINI_API_KEY: 'AQ.exampleGeminiKeyValue' },
    accountId: null,
    apiToken: null,
    userId: 'member',
    geminiHttp: async () => { called = true; return { status: 200, body: '' }; },
  });
  assert.equal(selected?.kind, 'fake');
  if (selected?.kind === 'fake') {
    const body = await selected.identify.identify(photo);
    assert.equal(body.ok, false);
  }
  assert.equal(called, false);
  const waits: number[] = [];
  const statuses = [429, 503, 200];
  let index = 0;
  const done = await withGeminiHarnessRetry({
    sleep: async (ms) => { waits.push(ms); },
    run: async () => ({ status: statuses[index], value: statuses[index++] }),
  });
  assert.equal(done, 200);
  assert.deepEqual(waits, [geminiHarnessBackoffMs(0), geminiHarnessBackoffMs(1)]);
  let attempts = 0;
  const limited: number[] = [];
  await withGeminiHarnessRetry({
    sleep: async (ms) => { limited.push(ms); },
    run: async () => { attempts += 1; return { status: 429, value: attempts }; },
  });
  assert.equal(attempts, 6);
  assert.deepEqual(limited, [10_000, 20_000, 30_000, 40_000, 50_000]);
});
