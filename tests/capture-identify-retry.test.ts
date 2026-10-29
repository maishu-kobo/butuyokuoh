// 写真判定の一時失敗と、色違いをスラッシュで並べた商品名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusAfterIdentify, statusAfterSearch } from '../src/lib/capture/capture-flow';
import { CaptureMessages } from '../src/lib/capture/contract';
import { createFakePorts, searchWithPorts } from '../src/lib/capture/fakes';
import { createRakutenLimiter, createRakutenSearch } from '../src/lib/capture/rakuten';
import { createYahooSearch } from '../src/lib/capture/yahoo';
import {
  WORKERS_AI_MODEL,
  createWorkersAiIdentifier,
  type WorkersAiHttpRequest,
  type WorkersAiHttpResponse,
} from '../src/lib/capture/workers-ai';

const ACCOUNT = 'c'.repeat(32);
const TOKEN = 'test-cloudflare-token';
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const QUERY = { name: 'ペン', brand: null, model: null, jan: null };

const SURE = {
  confidence: 'sure',
  products: [{ name: 'Google Pixel', brand: 'Google', model: null, jan: null }],
};

function cf(result: unknown, status = 200): WorkersAiHttpResponse {
  return { status, body: JSON.stringify({ success: status < 400, result, errors: [], messages: [] }) };
}

function textResult(text: string, status = 200): WorkersAiHttpResponse {
  return cf({ response: text }, status);
}

function harness(responses: WorkersAiHttpResponse[]) {
  const calls: WorkersAiHttpRequest[] = [];
  const queued = [...responses];
  const identifier = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: TOKEN,
    userId: '7',
    now: () => 1_000,
    http: async (request) => {
      calls.push(request);
      const next = queued.shift();
      if (!next) throw new Error('no queued response');
      return next;
    },
  });
  return { calls, identifier };
}

test('a fast upstream failure is retried once and can still become a product', async () => {
  const { calls, identifier } = harness([
    { status: 500, body: JSON.stringify({ success: false, errors: [{ code: 500, message: 'cold' }], messages: [] }) },
    textResult(JSON.stringify(SURE)),
  ]);
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].url.includes(WORKERS_AI_MODEL), true);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].name, 'Google Pixel');
});

test('an empty product list is a retryable parse failure, not an unreadable photo', async () => {
  const empty = textResult(JSON.stringify({ confidence: 'sure', products: [] }));
  const { calls, identifier } = harness([empty, empty]);
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(calls.length, 2);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'AI_INVALID_RESPONSE');
  assert.equal(result.error.retryable, true);
  assert.equal(result.error.error, CaptureMessages.aiRetryable);
  assert.equal(result.error.error.includes('読み取れません'), false);
});

test('explicit unreadable is not retried when products is missing or not an array', async () => {
  for (const first of [
    { confidence: 'unreadable' },
    { confidence: 'unreadable', products: null },
    { confidence: 'unreadable', products: 'none' },
  ]) {
    const { calls, identifier } = harness([
      textResult(JSON.stringify(first)),
      textResult(JSON.stringify(SURE)),
    ]);
    const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(calls.length, 1, JSON.stringify(first));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { confidence: 'unreadable', products: [] });
  }
});

test('a thrown search after a sure identification retries search, not another identify', async () => {
  const flow = await import('../src/lib/capture/capture-flow');
  const retry = (flow as { thrownCaptureRetry?: (identified: boolean) => { kind: string; message: string } }).thrownCaptureRetry;
  assert.equal(typeof retry, 'function');
  assert.deepEqual(retry?.(true), { kind: 'search', message: CaptureMessages.searchFailed });
  assert.deepEqual(retry?.(false), { kind: 'identify', message: CaptureMessages.aiRetryable });
});

test('the model saying unreadable is not retried and stays unreadable', async () => {
  const { calls, identifier } = harness([
    textResult(JSON.stringify({ confidence: 'unreadable', products: [] })),
    textResult(JSON.stringify(SURE)),
  ]);
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { confidence: 'unreadable', products: [] });
});

test('a slash list of color variants becomes one generic name and is not sure', async () => {
  const dumped = 'Google Pixel 8 Pro Obsidian/Hazel/Bay/Porcelain (Greyish Blue)';
  const { calls, identifier } = harness([
    textResult(JSON.stringify({
      confidence: 'sure',
      products: [{ name: dumped, brand: 'Google', model: '8 Pro', jan: null }],
    })),
  ]);
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.confidence, 'unsure');
  assert.equal(result.value.products.length, 1);
  const name = result.value.products[0].name;
  assert.equal(name.includes('/'), false);
  assert.equal(name.includes('Obsidian'), false);
  assert.equal(name.includes('Greyish'), false);
  assert.equal(name.includes('8'), false);
  assert.equal(name.includes('Google'), true);
  assert.equal(name.includes('Pixel'), true);
  assert.equal(result.value.products[0].model, null);
  const instruction = JSON.parse(calls[0].body).messages[0].content as string;
  assert.equal(instruction.includes('スラッシュ'), true);
  assert.equal(instruction.includes('世代'), true);
});

test('a slash that is part of the name stays, and a two-color tail does not', async () => {
  const cable = harness([
    textResult(JSON.stringify({
      confidence: 'sure',
      products: [{ name: 'USB A/C ケーブル', brand: null, model: null, jan: null }],
    })),
  ]);
  const kept = await cable.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.value.confidence, 'unsure');
  assert.equal(kept.value.products[0].name, 'USB A/C ケーブル');

  const colors = harness([
    textResult(JSON.stringify({
      confidence: 'sure',
      products: [{ name: 'Pixel Black/White', brand: null, model: null, jan: null }],
    })),
  ]);
  const trimmed = await colors.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(trimmed.ok, true);
  if (!trimmed.ok) return;
  assert.equal(trimmed.value.confidence, 'unsure');
  assert.equal(trimmed.value.products[0].name, 'Pixel Black');
  assert.equal(trimmed.value.products[0].name.includes('/'), false);
});

test('a name without a variant list keeps its generation', async () => {
  const { identifier } = harness([
    textResult(JSON.stringify({
      confidence: 'sure',
      products: [{ name: 'Google Pixel 10 Pro Fold', brand: 'Google', model: null, jan: null }],
    })),
  ]);
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.confidence, 'sure');
  assert.equal(result.value.products[0].name, 'Google Pixel 10 Pro Fold');
  assert.equal(result.value.products[0].model, 'Pixel 10 Pro Fold');
});

test('missing shop keys are not a retryable search failure, and one configured shop still returns candidates', async () => {
  const yahoo = createYahooSearch({
    appId: null,
    fetch: async () => {
      throw new Error('yahoo was called');
    },
  });
  const rakuten = createRakutenSearch({
    credentials: null,
    limiter: createRakutenLimiter(),
    http: async () => {
      throw new Error('rakuten was called');
    },
  });
  const missing = await searchWithPorts(QUERY, { identifier: createFakePorts().identifier, yahoo, rakuten }, null);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.code, 'SEARCH_NOT_CONFIGURED');
  assert.equal(missing.error.error, CaptureMessages.searchUnconfigured);
  assert.equal(missing.status, 503);
  assert.equal(missing.error.error.includes('もう一度'), false);

  const ports = createFakePorts('default', () => new Date('2026-10-22T00:00:00.000Z'));
  ports.rakuten = rakuten;
  const partial = await searchWithPorts(QUERY, ports, null);
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  assert.deepEqual(partial.value.candidates.map((item) => item.site), ['yahoo']);
  assert.equal(partial.value.failures[0].code, 'SEARCH_NOT_CONFIGURED');
  assert.equal(partial.value.failures.length, 1);
});

test('call failures and an unreadable photo use different messages', () => {
  const unreadable = statusAfterIdentify({ confidence: 'unreadable', products: [] }, true);
  assert.deepEqual(unreadable, { message: 'この写真からは商品が読み取れません。もう一度撮ってください', retryable: false });
  const parsed = statusAfterIdentify({
    code: 'AI_INVALID_RESPONSE',
    error: CaptureMessages.aiRetryable,
    retryable: true,
    fallback: 'manual-entry',
  }, false);
  assert.equal(parsed?.retryable, true);
  assert.equal(parsed?.message.includes('読み取れません'), false);
  const thrown = statusAfterIdentify(null, false);
  assert.equal(thrown?.message.includes('読み取れません'), false);
  assert.equal(thrown?.retryable, true);
  const blocked = statusAfterSearch({
    code: 'SEARCH_NOT_CONFIGURED',
    error: CaptureMessages.searchUnconfigured,
  }, false, 'Google Pixel');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.message, CaptureMessages.searchUnconfigured);
  assert.equal(blocked.manual.enter, true);
  const failed = statusAfterSearch({
    code: 'SEARCH_FAILED',
    error: CaptureMessages.searchFailed,
  }, false, 'ペン');
  assert.equal(failed.blocked, false);
  assert.equal(failed.message, CaptureMessages.searchFailed);
});
