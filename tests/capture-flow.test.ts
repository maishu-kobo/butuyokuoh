import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETAKE_MESSAGE,
  SLOW_MS,
  candidateCountStatus,
  fallbackFromIdentify,
  fallbackFromSearch,
  flowIsSlow,
  orderCandidates,
  productsToShow,
} from '../src/lib/capture/capture-flow';
import { CaptureMessages, type ProductGuess } from '../src/lib/capture/contract';
import { AI_LIMIT_MESSAGE } from '../src/lib/capture/workers-ai';

function product(name: string): ProductGuess {
  return { name, brand: null, model: null, jan: null };
}

test('a sure photo shows one name, an unsure photo shows three, and an unreadable photo shows none', () => {
  const products = ['ペン', 'ノート', '消しゴム', '定規'].map(product);
  assert.deepEqual(productsToShow('sure', products).map((item) => item.name), ['ペン']);
  assert.deepEqual(productsToShow('unsure', products).map((item) => item.name), ['ペン', 'ノート', '消しゴム']);
  assert.deepEqual(productsToShow('unreadable', products), []);
  assert.equal(RETAKE_MESSAGE.includes('sure'), false);
  assert.equal(/\d+\s*%/.test(RETAKE_MESSAGE), false);
  assert.equal(candidateCountStatus(2), '候補が2件あります');
});

test('price order is cheapest first and the recommended order stays as given', () => {
  const items = [
    { id: 'dear', price: 900 },
    { id: 'cheap', price: 100 },
    { id: 'b', price: 100 },
  ];
  assert.deepEqual(orderCandidates(items, 'recommended').map((item) => item.id), ['dear', 'cheap', 'b']);
  assert.deepEqual(orderCandidates(items, 'price').map((item) => item.id), ['b', 'cheap', 'dear']);
});

test('the capture flow is slow at 15 seconds and not one millisecond earlier', () => {
  assert.equal(SLOW_MS, 15_000);
  assert.equal(flowIsSlow(1_000, 16_000 - 1), false);
  assert.equal(flowIsSlow(1_000, 16_000), true);
});

test('zero candidates, an unreadable photo, the daily limit, and a failed shop open manual entry with the estimated name', () => {
  assert.deepEqual(
    fallbackFromSearch({ candidates: [], amazonUrl: 'https://www.amazon.co.jp/s?k=pen' }, true, '  テスト用ゲルボールペン 0.5  '),
    { enter: true, name: 'テスト用ゲルボールペン 0.5' },
  );
  assert.deepEqual(
    fallbackFromIdentify({
      confidence: 'unreadable',
      products: [{ name: ' 見えにくいペン ', brand: null, model: null, jan: null }],
    }, true),
    { enter: true, name: '見えにくいペン' },
  );
  assert.deepEqual(
    fallbackFromIdentify({
      code: 'AI_LIMIT',
      error: AI_LIMIT_MESSAGE,
      fallback: 'manual-entry',
      products: [{ name: '上限のペン', brand: null, model: null, jan: null }],
    }, false),
    { enter: true, name: '上限のペン' },
  );
  assert.deepEqual(
    fallbackFromIdentify({ code: 'AI_LIMIT', error: AI_LIMIT_MESSAGE, fallback: 'manual-entry' }, false),
    { enter: true, name: '' },
  );
  assert.deepEqual(
    fallbackFromSearch({ code: 'SEARCH_FAILED', error: CaptureMessages.searchFailed }, false, 'テスト用ゲルボールペン 0.5'),
    { enter: true, name: 'テスト用ゲルボールペン 0.5' },
  );
  assert.deepEqual(
    fallbackFromIdentify({ confidence: 'sure', products: [product('ペン')] }, true),
    { enter: false },
  );
  assert.deepEqual(
    fallbackFromIdentify({
      confidence: 'unsure',
      products: [product('ペン'), product('ノート')],
    }, true),
    { enter: false },
  );
  assert.deepEqual(
    fallbackFromSearch({ candidates: [{ id: 'yahoo:pen' }] }, true, 'ペン'),
    { enter: false },
  );
});
