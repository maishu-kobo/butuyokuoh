import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CaptureMessages, type IdentifyResponse, type ProductIdentifier } from '../src/lib/capture/contract';
import {
  AI_LIMIT_MESSAGE,
  AI_MINUTE_LIMIT_MESSAGE,
  AI_NEURONS_PER_MILLION_INPUT,
  AI_NEURONS_PER_MILLION_OUTPUT,
  AI_NEURONS_WHEN_USAGE_MISSING,
  AI_NEURON_DAILY_CAP,
  AI_USER_PER_DAY,
  AI_USER_PER_MINUTE,
  createAiBudget,
  createWorkersAiIdentifier,
  identifyHttpBody,
  neuronsFromTokenUsage,
  resolveProductIdentifier,
  type WorkersAiHttpRequest,
  type WorkersAiHttpResponse,
} from '../src/lib/capture/workers-ai';

const ACCOUNT = 'b'.repeat(32);
const TOKEN = 'test-cloudflare-token';
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const SURE = {
  confidence: 'sure' as const,
  products: [{ name: '牛乳', brand: null, model: null, jan: null }],
};

function textResult(usage?: Record<string, number> | null): WorkersAiHttpResponse {
  const result: Record<string, unknown> = { response: JSON.stringify(SURE) };
  if (usage) result.usage = usage;
  return { status: 200, body: JSON.stringify({ success: true, result, errors: [], messages: [] }) };
}

function harness(options: {
  budget: ReturnType<typeof createAiBudget>;
  userId?: string;
  clock: { t: number };
  responses?: WorkersAiHttpResponse[];
  http?: (request: WorkersAiHttpRequest) => Promise<WorkersAiHttpResponse>;
}) {
  const calls: WorkersAiHttpRequest[] = [];
  const queued = [...(options.responses ?? [])];
  const identifier = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: TOKEN,
    userId: options.userId ?? '7',
    budget: options.budget,
    now: () => options.clock.t,
    timeoutMs: 30_000,
    http: options.http ?? (async (request) => {
      calls.push(request);
      const next = queued.shift() ?? textResult({ neurons: 0 });
      return next;
    }),
  });
  return { calls, identifier };
}

test('published neuron rates and the free-tier caps stay fixed', () => {
  assert.equal(AI_NEURONS_PER_MILLION_INPUT, 4410);
  assert.equal(AI_NEURONS_PER_MILLION_OUTPUT, 61493);
  assert.equal(AI_NEURON_DAILY_CAP, 8000);
  assert.equal(AI_USER_PER_MINUTE, 3);
  assert.equal(AI_USER_PER_DAY, 10);
  assert.equal(AI_NEURONS_WHEN_USAGE_MISSING, 378);
  assert.equal(neuronsFromTokenUsage({ prompt_tokens: 1_000_000, completion_tokens: 0 }), 4410);
  assert.equal(neuronsFromTokenUsage({ prompt_tokens: 0, completion_tokens: 1_000_000 }), 61493);
  assert.equal(neuronsFromTokenUsage({ prompt_tokens: 1, completion_tokens: 1 }), 1);
  assert.equal(neuronsFromTokenUsage({ prompt_tokens: 1_814_058, completion_tokens: 0 }), 8000);
  assert.equal(neuronsFromTokenUsage({ total_tokens: 1_000_000 }), 61493);
  assert.equal(neuronsFromTokenUsage({}), null);
  assert.equal(neuronsFromTokenUsage(null), null);
});

test('one person gets 3 calls a minute and 10 a UTC day, and failures count', async () => {
  const budget = createAiBudget();
  const clock = { t: Date.UTC(2026, 9, 22, 0, 0, 0) };
  const { calls, identifier } = harness({ budget, clock });
  for (let index = 0; index < AI_USER_PER_MINUTE; index += 1) {
    const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(result.ok, true, `call ${index}`);
  }
  const blocked = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 429);
    assert.equal(blocked.error.code, 'AI_LIMIT');
    assert.equal(blocked.error.error, AI_MINUTE_LIMIT_MESSAGE);
    assert.equal(JSON.stringify(blocked).includes(TOKEN), false);
  }
  assert.equal(calls.length, AI_USER_PER_MINUTE);

  clock.t += 60_001;
  const again = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(again.ok, true);
  assert.equal(calls.length, AI_USER_PER_MINUTE + 1);

  const other = harness({ budget, clock, userId: '8' });
  const otherResult = await other.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(otherResult.ok, true);
  assert.equal(other.calls.length, 1);

  const failing = createAiBudget();
  const failClock = { t: Date.UTC(2026, 9, 22, 3, 0, 0) };
  const failed = harness({
    budget: failing,
    clock: failClock,
    responses: [
      { status: 500, body: JSON.stringify({ success: false, errors: [{ code: 1, message: `boom ${TOKEN}` }], messages: [] }) },
      { status: 500, body: '{"success":false,"errors":[{"code":1,"message":"boom"}],"messages":[]}' },
      { status: 500, body: '{"success":false,"errors":[{"code":1,"message":"boom"}],"messages":[]}' },
      textResult({ neurons: 0 }),
    ],
  });
  for (let index = 0; index < 3; index += 1) {
    const result = await failed.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.error, CaptureMessages.aiFailed);
      assert.equal(JSON.stringify(result).includes('boom'), false);
    }
  }
  const fourth = await failed.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(fourth.ok, false);
  if (!fourth.ok) assert.equal(fourth.error.error, AI_MINUTE_LIMIT_MESSAGE);
  assert.equal(failed.calls.length, 3);

  const day = createAiBudget();
  const dayClock = { t: Date.UTC(2026, 9, 22, 0, 0, 0) };
  const daily = harness({ budget: day, clock: dayClock });
  for (let index = 0; index < AI_USER_PER_DAY; index += 1) {
    const result = await daily.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(result.ok, true, `day ${index}`);
    dayClock.t += 60_001;
  }
  const overDay = await daily.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(overDay.ok, false);
  if (!overDay.ok) {
    assert.equal(overDay.status, 429);
    assert.equal(overDay.error.code, 'AI_LIMIT');
    assert.equal(overDay.error.error, AI_LIMIT_MESSAGE);
  }
  assert.equal(daily.calls.length, AI_USER_PER_DAY);

  dayClock.t = Date.UTC(2026, 9, 23, 0, 0, 0);
  const reset = await daily.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(reset.ok, true);
  assert.equal(daily.calls.length, AI_USER_PER_DAY + 1);
});

test('invalid photos do not spend the per-user allowance', async () => {
  const budget = createAiBudget();
  const clock = { t: Date.UTC(2026, 9, 22, 4, 0, 0) };
  const { calls, identifier } = harness({ budget, clock });
  for (let index = 0; index < 3; index += 1) {
    const rejected = await identifier.identify({ mediaType: 'image/jpeg', bytes: Uint8Array.of(1, 2, 3, 4) });
    assert.equal(rejected.ok, false);
  }
  for (let index = 0; index < AI_USER_PER_MINUTE; index += 1) {
    assert.equal((await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  }
  assert.equal(calls.length, AI_USER_PER_MINUTE);
  assert.equal(budget.usedNeurons(clock.t), 0);
});

test('reported neurons are counted, including zero, and token prices are not added', async () => {
  const clock = { t: Date.UTC(2026, 9, 22, 5, 10, 0) };
  const measured = createAiBudget();
  const measuredCall = harness({
    budget: measured,
    clock,
    responses: [
      textResult({ neurons: 15, prompt_tokens: 1_814_058, completion_tokens: 400 }),
      textResult({ neurons: 30, prompt_tokens: 6_500, completion_tokens: 20 }),
    ],
  });
  assert.equal((await measuredCall.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal(measured.usedNeurons(clock.t), 15);
  clock.t += 60_001;
  assert.equal((await measuredCall.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal(measured.usedNeurons(clock.t), 45);
  assert.equal(measuredCall.calls.length, 2);

  const zeroBudget = createAiBudget();
  const zeroClock = { t: Date.UTC(2026, 9, 22, 5, 20, 0) };
  const zero = harness({
    budget: zeroBudget,
    clock: zeroClock,
    responses: [textResult({ neurons: 0, prompt_tokens: 1_814_058, completion_tokens: 400 })],
  });
  assert.equal((await zero.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal(zeroBudget.usedNeurons(zeroClock.t), 0);

  const missingBudget = createAiBudget();
  const missingClock = { t: Date.UTC(2026, 9, 22, 5, 30, 0) };
  const missing = harness({
    budget: missingBudget,
    clock: missingClock,
    responses: [textResult({ prompt_tokens: 1_000_000, completion_tokens: 0 })],
  });
  assert.equal((await missing.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal(missingBudget.usedNeurons(missingClock.t), AI_NEURONS_WHEN_USAGE_MISSING);

  const blankBudget = createAiBudget();
  const blank = harness({
    budget: blankBudget,
    clock: missingClock,
    userId: '16',
    responses: [textResult(null)],
  });
  assert.equal((await blank.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal(blankBudget.usedNeurons(missingClock.t), AI_NEURONS_WHEN_USAGE_MISSING);

  const oddClock = { t: Date.UTC(2026, 9, 22, 5, 40, 0) };
  for (const neurons of [-1, '15', null] as unknown[]) {
    const budget = createAiBudget();
    const odd = harness({
      budget,
      clock: oddClock,
      responses: [{
        status: 200,
        body: JSON.stringify({
          success: true,
          result: { response: JSON.stringify(SURE), usage: { neurons, prompt_tokens: 1_000_000, completion_tokens: 400 } },
          errors: [],
          messages: [],
        }),
      }],
    });
    assert.equal((await odd.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true, String(neurons));
    assert.equal(budget.usedNeurons(oddClock.t), AI_NEURONS_WHEN_USAGE_MISSING, String(neurons));
  }
});

test('the global neuron stop is 8000 per UTC day and a missing usage count is reserved', async () => {
  const budget = createAiBudget();
  const clock = { t: Date.UTC(2026, 9, 22, 5, 0, 0) };
  const priced = harness({
    budget,
    clock,
    responses: [textResult({ neurons: 8000 })],
  });
  const spent = await priced.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(spent.ok, true);
  assert.equal(budget.usedNeurons(clock.t), 8000);
  const stopped = await priced.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(stopped.ok, false);
  if (!stopped.ok) {
    assert.equal(stopped.error.code, 'AI_LIMIT');
    assert.equal(stopped.error.error, AI_LIMIT_MESSAGE);
    assert.equal(JSON.stringify(stopped).includes('8000'), false);
  }
  assert.equal(priced.calls.length, 1);

  const other = harness({ budget, clock, userId: '9' });
  const otherStopped = await other.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(otherStopped.ok, false);
  if (!otherStopped.ok) assert.equal(otherStopped.error.error, AI_LIMIT_MESSAGE);
  assert.equal(other.calls.length, 0);

  clock.t = Date.UTC(2026, 9, 23, 5, 0, 0);
  const nextDay = await other.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(nextDay.ok, true);
  assert.equal(other.calls.length, 1);

  const missing = createAiBudget();
  const missingClock = { t: Date.UTC(2026, 9, 22, 6, 0, 0) };
  const unmetered = harness({
    budget: missing,
    clock: missingClock,
    responses: [textResult(null)],
  });
  assert.equal((await unmetered.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal(missing.usedNeurons(missingClock.t), AI_NEURONS_WHEN_USAGE_MISSING);

  const upstream = createAiBudget();
  const upstreamClock = { t: Date.UTC(2026, 9, 22, 7, 0, 0) };
  const capped = harness({
    budget: upstream,
    clock: upstreamClock,
    responses: [{
      status: 429,
      body: JSON.stringify({
        success: false,
        errors: [{ code: 3036, message: 'You have used up your daily free allocation of 10,000 neurons. Please upgrade' }],
        messages: [],
      }),
    }],
  });
  const hit = await capped.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(hit.ok, false);
  if (!hit.ok) {
    assert.equal(hit.status, 429);
    assert.equal(hit.error.code, 'AI_LIMIT');
    assert.equal(hit.error.error, AI_LIMIT_MESSAGE);
    assert.equal(JSON.stringify(hit).includes('10,000'), false);
    assert.equal(JSON.stringify(hit).includes('upgrade'), false);
    assert.equal(JSON.stringify(hit).includes('neurons'), false);
  }
  const follow = await capped.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(follow.ok, false);
  if (!follow.ok) assert.equal(follow.error.error, AI_LIMIT_MESSAGE);
  assert.equal(capped.calls.length, 1);
  assert.equal(upstream.usedNeurons(upstreamClock.t) >= AI_NEURON_DAILY_CAP, true);
});

test('a 5016 response is one user attempt, returns AI_UNAVAILABLE, and does not agree', async () => {
  const budget = createAiBudget();
  const clock = { t: Date.UTC(2026, 9, 22, 8, 0, 0) };
  const license = {
    status: 403,
    body: JSON.stringify({
      success: false,
      errors: [{ code: 5016, message: `terms ${TOKEN}` }],
      messages: [],
    }),
  };
  const { calls, identifier } = harness({
    budget,
    clock,
    responses: [license, textResult({ neurons: 4410, prompt_tokens: 1_000_000, completion_tokens: 0 })],
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.equal(result.error.code, 'AI_UNAVAILABLE');
    assert.equal(result.error.error, CaptureMessages.aiFailed);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    assert.equal(JSON.stringify(result).includes('agree'), false);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls.some((call) => call.body.includes('"agree"')), false);
  assert.equal(budget.usedNeurons(clock.t), AI_NEURONS_WHEN_USAGE_MISSING);
  assert.equal((await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  assert.equal((await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
  const blocked = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.error, AI_MINUTE_LIMIT_MESSAGE);
  assert.equal(calls.length, 3);
});

test('AI failures tell the client to enter the product name, and photo errors do not', () => {
  const limited = identifyHttpBody({
    ok: false,
    status: 429,
    error: { code: 'AI_LIMIT', error: AI_LIMIT_MESSAGE },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.fallback, 'manual-entry');
  assert.equal(limited.body.code, 'AI_LIMIT');
  assert.equal(limited.body.error, AI_LIMIT_MESSAGE);

  for (const code of ['AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_INVALID_RESPONSE'] as const) {
    const body = identifyHttpBody({ ok: false, status: 503, error: { code, error: CaptureMessages.aiFailed } });
    assert.equal(body.body.fallback, 'manual-entry', code);
  }

  const photo = identifyHttpBody({
    ok: false,
    status: 413,
    error: { code: 'PHOTO_TOO_LARGE', error: CaptureMessages.photoTooLarge },
  });
  assert.equal('fallback' in photo.body, false);
  assert.equal(photo.body.error, CaptureMessages.photoTooLarge);

  const ok = identifyHttpBody({ ok: true, value: SURE });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, SURE);
});

test('real identification is used only when secrets exist outside the explicit test hook', async () => {
  const calls: string[] = [];
  const http = async (request: WorkersAiHttpRequest): Promise<WorkersAiHttpResponse> => {
    calls.push(request.url);
    return textResult({ neurons: 0 });
  };
  const fake: ProductIdentifier = {
    async identify(): Promise<{ ok: true; value: IdentifyResponse }> {
      throw new Error('fake should not run');
    },
  };
  const budget = createAiBudget();
  const hooked = resolveProductIdentifier({
    hooked: true,
    accountId: ACCOUNT,
    apiToken: TOKEN,
    userId: '7',
    fake,
    budget,
    http,
    now: () => Date.UTC(2026, 9, 22, 9, 0, 0),
    env: { NODE_ENV: 'development', CAPTURE_TEST_HOOKS: '1' },
  });
  assert.equal(hooked, fake);

  const missing = resolveProductIdentifier({
    hooked: false,
    accountId: null,
    apiToken: TOKEN,
    userId: '7',
    fake,
    budget,
    http,
    env: { NODE_ENV: 'development' },
  });
  assert.notEqual(missing, fake);
  const missingResult = await missing.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) {
    assert.equal(missingResult.error.code, 'AI_UNAVAILABLE');
    assert.equal(missingResult.status, 503);
  }
  assert.equal(calls.length, 0);

  const real = resolveProductIdentifier({
    hooked: false,
    accountId: ACCOUNT,
    apiToken: TOKEN,
    userId: '7',
    fake,
    budget,
    http,
    now: () => Date.UTC(2026, 9, 22, 9, 0, 0),
    env: { NODE_ENV: 'production', CAPTURE_TEST_HOOKS: '1' },
  });
  assert.notEqual(real, fake);
  const result = await real.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes(TOKEN), false);
  assert.equal(calls[0].startsWith('https://api.cloudflare.com/'), true);
});

test('the identify route keeps the kill switch and reads keys only through capture secrets', () => {
  const route = readFileSync(new URL('../src/app/api/capture/identify/route.ts', import.meta.url), 'utf8');
  assert.equal(route.includes('withCaptureAi'), true);
  assert.equal(route.includes('readCapturePhoto'), true);
  assert.equal(route.includes('formData'), false);
  assert.equal(route.includes('resolveProductIdentifier'), true);
  assert.equal(route.includes('captureTestEnv'), true);
  assert.equal(route.includes('readCaptureSecrets'), true);
  assert.equal(route.includes('identifyHttpBody'), true);
  assert.equal(/process\.env/.test(route), false);
  assert.equal(route.includes('CLOUDFLARE_API_TOKEN'), false);
  const source = readFileSync(new URL('../src/lib/capture/workers-ai.ts', import.meta.url), 'utf8');
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/console\./.test(source), false);
  assert.equal(source.includes('{"prompt":"agree"}'), false);
  assert.equal(source.includes('"agree"'), false);
  assert.equal(source.includes('appAiBudget'), true);
  assert.equal(source.includes('createSqliteAiBudget'), true);
});

test('the capture AI doc counts reported neurons, keeps a Read token, and does not agree', () => {
  const doc = readFileSync(new URL('../docs/capture-ai.md', import.meta.url), 'utf8');
  assert.equal(/agree/i.test(doc), false);
  assert.equal(doc.includes('同意'), false);
  assert.equal(doc.includes('Read と Edit'), false);
  assert.equal(doc.includes('Edit'), false);
  assert.equal(doc.includes('Workers AI の Read'), true);
  assert.equal(doc.includes('result.usage.neurons'), true);
  assert.equal(doc.includes('capture_ai_usage'), true);
  assert.equal(doc.includes('メモリ上'), false);
  assert.equal(doc.includes('prompt_tokens'), false);
});
