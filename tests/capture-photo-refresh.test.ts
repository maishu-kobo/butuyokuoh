import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { offersPriceRefresh } from '../src/lib/capture/photo-card-view';

const SEED = 20261023;

test('a photo group hides page price refresh, and one registration still offers it', () => {
  assert.equal(offersPriceRefresh(2), false);
  assert.equal(offersPriceRefresh(5), false);
  assert.equal(offersPriceRefresh(1), true);
  assert.equal(offersPriceRefresh(0), true);
});

test('page price refresh stays hidden for every group of two or more shops', () => {
  fc.assert(fc.property(
    fc.integer({ min: 2, max: 30 }),
    fc.integer({ min: 0, max: 1 }),
    (groupSize, single) => {
      assert.equal(offersPriceRefresh(groupSize), false);
      assert.equal(offersPriceRefresh(single), true);
    },
  ), { seed: SEED, numRuns: 40 });
});
