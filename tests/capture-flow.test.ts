import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RETAKE_MESSAGE,
  SLOW_MS,
  candidateCountStatus,
  flowIsSlow,
  orderCandidates,
  productsToShow,
} from '../src/lib/capture/capture-flow';
import type { ProductGuess } from '../src/lib/capture/contract';

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
