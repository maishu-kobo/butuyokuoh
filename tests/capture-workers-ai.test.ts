import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages } from '../src/lib/capture/contract';
import {
  AI_MAX_OUTPUT_TOKENS,
  WORKERS_AI_MODEL,
  WORKERS_AI_TIMEOUT_MS,
  createWorkersAiIdentifier,
  type WorkersAiHttpRequest,
  type WorkersAiHttpResponse,
} from '../src/lib/capture/workers-ai';

const ACCOUNT = 'a'.repeat(32);
const TOKEN = 'test-cloudflare-token';
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const heic = Uint8Array.of(0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0);
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/AA==';

const SURE = {
  confidence: 'sure',
  products: [{ name: '物欲文具 BY-05 ゲルボールペン 0.5', brand: '物欲文具', model: 'BY-05', jan: null }],
};

function endpoint(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${WORKERS_AI_MODEL}`;
}

function cf(result: unknown, status = 200): WorkersAiHttpResponse {
  return { status, body: JSON.stringify({ success: status < 400, result, errors: [], messages: [] }) };
}

function textResult(text: string, extra: Record<string, unknown> = {}): WorkersAiHttpResponse {
  return cf({ response: text, ...extra });
}

function harness(options: {
  responses?: WorkersAiHttpResponse[];
  http?: (request: WorkersAiHttpRequest) => Promise<WorkersAiHttpResponse>;
  accountId?: string;
  apiToken?: string;
  userId?: string;
  timeoutMs?: number;
  clock?: { t: number };
} = {}) {
  const calls: WorkersAiHttpRequest[] = [];
  const timings: { elapsedMs: number }[] = [];
  const clock = options.clock ?? { t: 1_000 };
  const queued = [...(options.responses ?? [textResult(JSON.stringify(SURE))])];
  const identifier = createWorkersAiIdentifier({
    accountId: options.accountId ?? ACCOUNT,
    apiToken: options.apiToken ?? TOKEN,
    userId: options.userId ?? '7',
    timeoutMs: options.timeoutMs ?? WORKERS_AI_TIMEOUT_MS,
    now: () => clock.t,
    onTiming: (timing) => timings.push(timing),
    http: options.http ?? (async (request) => {
      calls.push(request);
      clock.t += 25;
      const next = queued.shift();
      if (!next) throw new Error('no queued response');
      return next;
    }),
  });
  return { calls, clock, timings, identifier };
}

async function withFetchBlocked<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let leaked = 0;
  globalThis.fetch = (async () => {
    leaked += 1;
    throw new Error(`network disabled ${TOKEN}`);
  }) as typeof fetch;
  try {
    const value = await fn();
    assert.equal(leaked, 0);
    return value;
  } finally {
    globalThis.fetch = original;
  }
}

test('workers ai uses the documented vision model and a 30 second cutoff', () => {
  assert.equal(WORKERS_AI_MODEL, '@cf/meta/llama-3.2-11b-vision-instruct');
  assert.equal(WORKERS_AI_TIMEOUT_MS, 30_000);
  assert.equal(AI_MAX_OUTPUT_TOKENS, 400);
});

test('a photo is sent once as a data URL and the JSON reply becomes a product guess', async () => {
  await withFetchBlocked(async () => {
    const { calls, timings, identifier } = harness();
    const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, SURE);
    assert.equal('score' in result.value, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].redirect, 'manual');
    assert.equal(calls[0].cache, 'no-store');
    assert.equal(calls[0].url, endpoint());
    assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].url.includes(TOKEN), false);
    assert.equal(calls[0].headers.Accept, 'application/json');
    const payload = JSON.parse(calls[0].body) as {
      image?: string;
      max_tokens?: number;
      temperature?: number;
      stream?: boolean;
      messages?: unknown[];
    };
    assert.equal(payload.image, JPEG_DATA_URL);
    assert.equal(payload.max_tokens, AI_MAX_OUTPUT_TOKENS);
    assert.equal(payload.temperature, 0);
    assert.equal(payload.stream, undefined);
    assert.equal(Array.isArray(payload.messages), true);
    assert.equal(calls[0].body.includes('https://'), false);
    assert.equal(timings.length, 1);
    assert.equal(timings[0].elapsedMs, 25);
  });
});

test('markdown, an OpenAI-shaped reply, and a direct result string all parse into the same guess', async () => {
  const fenced = '説明は捨てる\n```json\n' + JSON.stringify({
    confidence: 'unsure',
    products: [
      { name: '牛乳', brand: '明治', model: null, jan: '4900000000009', url: 'https://evil.example/milk' },
      { name: ' 豆乳 ', brand: 'https://evil.example/brand', model: 'A1', jan: '4900000000008' },
    ],
    tool_calls: [{ function: { name: 'fetch', arguments: 'https://evil.example/run' } }],
  }) + '\n```\n続き https://evil.example/more';
  const cases = [
    textResult(fenced),
    cf({ choices: [{ message: { content: JSON.stringify(SURE) } }] }),
    cf(JSON.stringify({ confidence: 'unreadable', products: [] })),
  ];
  await withFetchBlocked(async () => {
    const first = harness({ responses: [cases[0]] });
    const unsure = await first.identifier.identify({ mediaType: 'image/png', bytes: png });
    assert.equal(unsure.ok, true);
    if (!unsure.ok) return;
    assert.equal(unsure.value.confidence, 'unsure');
    assert.deepEqual(unsure.value.products, [
      { name: '牛乳', brand: null, model: null, jan: null },
      { name: '豆乳', brand: null, model: null, jan: null },
    ]);
    assert.equal(JSON.stringify(unsure.value).includes('evil.example'), false);
    assert.equal(first.calls.length, 1);

    const second = harness({ responses: [cases[1]] });
    const sure = await second.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(sure.ok, true);
    if (sure.ok) assert.deepEqual(sure.value, SURE);

    const third = harness({ responses: [cases[2]] });
    const unreadable = await third.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(unreadable.ok, true);
    if (unreadable.ok) assert.deepEqual(unreadable.value, { confidence: 'unreadable', products: [] });
  });
});

test('a bad shape, a check-digit failure alone, and a URL name do not leak the model text', async () => {
  const leak = `upstream said ${TOKEN} https://evil.example/secret`;
  await withFetchBlocked(async () => {
    const invalid = harness({ responses: [textResult(`not-json ${leak}`)] });
    const bad = await invalid.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.status, 502);
      assert.equal(bad.error.code, 'AI_INVALID_RESPONSE');
      assert.equal(bad.error.error, CaptureMessages.aiRetryable);
      assert.equal(bad.error.retryable, true);
      assert.equal(JSON.stringify(bad).includes(TOKEN), false);
      assert.equal(JSON.stringify(bad).includes('evil.example'), false);
      assert.equal(JSON.stringify(bad).includes('not-json'), false);
    }

    const urlName = harness({
      responses: [textResult(JSON.stringify({
        confidence: 'sure',
        products: [{ name: 'https://evil.example/p', brand: null, model: null, jan: null }],
      }))],
    });
    const dropped = await urlName.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(dropped.ok, false);
    if (!dropped.ok) {
      assert.equal(dropped.error.code, 'AI_INVALID_RESPONSE');
      assert.equal(dropped.error.error, CaptureMessages.aiRetryable);
      assert.equal(JSON.stringify(dropped).includes('evil.example'), false);
    }

    const huge = harness({ responses: [{ status: 200, body: `{"response":"${'x'.repeat(70_000)}"}` }] });
    const oversized = await huge.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.equal(oversized.error.code, 'AI_INVALID_RESPONSE');
      assert.equal(oversized.error.error, CaptureMessages.aiRetryable);
    }
  });
});

test('a 5016 response is AI_UNAVAILABLE and does not send prompt agree', async () => {
  const license = {
    status: 403,
    body: JSON.stringify({
      success: false,
      errors: [{ code: 5016, message: `User has not agreed to Llama3.2 model terms ${TOKEN}` }],
      messages: [],
    }),
  };
  await withFetchBlocked(async () => {
    const { calls, identifier } = harness({ responses: [license, textResult(JSON.stringify(SURE))] });
    const failed = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.status, 503);
      assert.equal(failed.error.code, 'AI_UNAVAILABLE');
      assert.equal(failed.error.error, CaptureMessages.aiFailed);
      assert.equal(JSON.stringify(failed).includes(TOKEN), false);
      assert.equal(JSON.stringify(failed).includes('Llama'), false);
      assert.equal(JSON.stringify(failed).includes('agree'), false);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, endpoint());
    assert.equal(calls[0].body.includes(JPEG_DATA_URL), true);
    assert.equal(calls.some((call) => call.body.includes('"agree"')), false);
    assert.equal(calls.some((call) => call.body === '{"prompt":"agree"}'), false);
  });
});

test('timeouts and upstream failures use fixed messages and do not follow redirects', async () => {
  await withFetchBlocked(async () => {
    const clock = { t: 5_000 };
    const timings: { elapsedMs: number }[] = [];
    const identifier = createWorkersAiIdentifier({
      accountId: ACCOUNT,
      apiToken: TOKEN,
      userId: '7',
      timeoutMs: 20,
      now: () => clock.t,
      onTiming: (timing) => timings.push(timing),
      http: async (request) => new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          clock.t += 20;
          reject(new Error(`aborted ${TOKEN} ${JPEG_DATA_URL}`));
        });
      }),
    });
    const timedOut = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(timedOut.ok, false);
    if (!timedOut.ok) {
      assert.equal(timedOut.status, 504);
      assert.equal(timedOut.error.code, 'AI_TIMEOUT');
      assert.equal(timedOut.error.error, CaptureMessages.aiTimeout);
      assert.equal(JSON.stringify(timedOut).includes(TOKEN), false);
      assert.equal(JSON.stringify(timedOut).includes('/9j/'), false);
    }
    assert.equal(timings[0].elapsedMs, 40);

    const redirected = harness({
      responses: [{ status: 302, body: `Location: https://evil.example/steal?token=${TOKEN}` }],
    });
    const moved = await redirected.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(moved.ok, false);
    if (!moved.ok) {
      assert.equal(moved.error.code, 'AI_UNAVAILABLE');
      assert.equal(moved.error.error, CaptureMessages.aiFailed);
      assert.equal(JSON.stringify(moved).includes('evil.example'), false);
      assert.equal(JSON.stringify(moved).includes(TOKEN), false);
    }
    assert.equal(redirected.calls.length, 1);

    const broken = harness({
      responses: [{
        status: 500,
        body: JSON.stringify({ success: false, errors: [{ code: 9999, message: `boom ${TOKEN}` }], messages: [] }),
      }],
    });
    const failed = await broken.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.status, 503);
      assert.equal(failed.error.code, 'AI_UNAVAILABLE');
      assert.equal(failed.error.error, CaptureMessages.aiRetryable);
      assert.equal(failed.error.retryable, true);
      assert.equal(JSON.stringify(failed).includes('boom'), false);
      assert.equal(JSON.stringify(failed).includes(TOKEN), false);
    }
  });
});

test('invalid photos, credentials, and a missing user do not call Cloudflare', async () => {
  await withFetchBlocked(async () => {
    const { calls, identifier } = harness();
    const heicResult = await identifier.identify({ mediaType: 'image/heic', bytes: heic });
    assert.equal(heicResult.ok, false);
    if (!heicResult.ok) assert.equal(heicResult.error.code, 'UNSUPPORTED_MEDIA');

    const huge = new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1);
    huge.set(jpeg);
    const tooBig = await identifier.identify({ mediaType: 'image/jpeg', bytes: huge });
    assert.equal(tooBig.ok, false);
    if (!tooBig.ok) {
      assert.equal(tooBig.error.code, 'PHOTO_TOO_LARGE');
      assert.equal(tooBig.status, 413);
    }

    const garbage = await identifier.identify({ mediaType: 'image/jpeg', bytes: Uint8Array.of(1, 2, 3, 4) });
    assert.equal(garbage.ok, false);
    if (!garbage.ok) assert.equal(garbage.error.code, 'PHOTO_UNREADABLE');

    const injected = harness({ apiToken: `good\r\nX-Evil: ${TOKEN}` });
    const badToken = await injected.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(badToken.ok, false);
    if (!badToken.ok) {
      assert.equal(badToken.error.code, 'AI_UNAVAILABLE');
      assert.equal(badToken.error.error, CaptureMessages.aiFailed);
    }
    assert.equal(injected.calls.length, 0);

    const badAccount = harness({ accountId: '../etc/passwd' });
    const badId = await badAccount.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(badId.ok, false);
    if (!badId.ok) assert.equal(badId.error.code, 'AI_UNAVAILABLE');
    assert.equal(badAccount.calls.length, 0);

    const anonymous = harness({ userId: '   ' });
    const noUser = await anonymous.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(noUser.ok, false);
    if (!noUser.ok) assert.equal(noUser.error.code, 'AI_UNAVAILABLE');
    assert.equal(anonymous.calls.length, 0);

    assert.equal(calls.length, 0);
  });
});

test('the workers ai client does not read the environment or log', () => {
  const source = readFileSync(new URL('../src/lib/capture/workers-ai.ts', import.meta.url), 'utf8');
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/console\./.test(source), false);
  assert.equal(source.includes('capture-secrets'), false);
  assert.equal(source.includes(TOKEN), false);
});

test('a category with invisible invented identifiers is unsure and never supplies a JAN', async () => {
  const { identifier } = harness({ responses: [textResult(JSON.stringify({
    confidence: 'sure', products: [{ name: 'Black Leather Bag', brand: 'The Row', model: 'Small Handbag', jan: '4750000000000' }],
  }))] });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { confidence: 'unsure', products: [{ name: 'Black Leather Bag', brand: null, model: null, jan: null }] });
});

test('a visible brand and product line remain searchable but an AI barcode is discarded', async () => {
  const { identifier } = harness({ responses: [textResult(JSON.stringify({
    confidence: 'sure', products: [{ name: 'Example Alpha handbag', brand: 'Example', model: 'Alpha', jan: '4900000000009' }],
  }))] });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { confidence: 'sure', products: [{ name: 'Example Alpha handbag', brand: 'Example', model: 'Alpha', jan: null }] });
});
