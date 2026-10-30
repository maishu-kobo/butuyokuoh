import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWithPorts } from '../src/lib/capture/fakes';
import { acceptCandidate, sortCandidates, type CaptureCandidate, type SearchQuery } from '../src/lib/capture/contract';
import { readStoreRank, rememberStoreOrder } from '../src/lib/capture/store-rank';

const NOW = '2026-10-29T00:00:00.000Z';

function candidate(overrides: Partial<CaptureCandidate> & Pick<CaptureCandidate, 'id' | 'title' | 'price'>): CaptureCandidate {
  const site = overrides.site ?? 'yahoo';
  return {
    site,
    url: site === 'yahoo'
      ? 'https://store.shopping.yahoo.co.jp/example/item'
      : 'https://item.rakuten.co.jp/example/item',
    fetchedAt: NOW,
    shopName: '店',
    ...overrides,
  };
}

const HEADPHONES: SearchQuery = { name: 'Bose ヘッドホン', brand: 'Bose', model: null, jan: null };

test('store relevance order beats a cheaper later hit, and a second search keeps it', async () => {
  const first = candidate({ id: 'yahoo:first', title: 'Bose ヘッドホン 黒', price: 32000 });
  const later = candidate({ id: 'yahoo:later', title: 'Bose ヘッドホン 白', price: 4000 });
  const ports = {
    identifier: { async identify() { throw new Error('unused'); } },
    yahoo: { async search() { return { ok: true as const, value: [first, later] }; } },
    rakuten: { async search() { return { ok: true as const, value: [] as CaptureCandidate[] }; } },
  };
  const result = await searchWithPorts(HEADPHONES, ports, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.candidates.map((item) => item.id), ['yahoo:first', 'yahoo:later']);
  assert.equal(JSON.stringify(result.value.candidates[0]).includes('storeRank'), false);
  assert.equal(Object.keys(result.value.candidates[0]).includes('storeRank'), false);
  const again = await searchWithPorts(HEADPHONES, {
    ...ports,
    yahoo: { async search() { return { ok: true as const, value: result.value.candidates.filter((item) => item.site === 'yahoo') }; } },
  }, null);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.deepEqual(again.value.candidates.map((item) => item.id), ['yahoo:first', 'yahoo:later']);
});

test('unset store order still sorts the cheaper equal product first', () => {
  const query: SearchQuery = { name: 'Bose ヘッドホン', brand: null, model: null, jan: null };
  const sorted = sortCandidates([
    candidate({ id: 'yahoo:dear', title: 'Bose ヘッドホン 黒', price: 32000 }),
    candidate({ id: 'yahoo:cheap', title: 'Bose ヘッドホン 白', price: 4000 }),
  ], query);
  assert.deepEqual(sorted.map((item) => item.id), ['yahoo:cheap', 'yahoo:dear']);
});

test('a headphone guess ranks the headphone ahead of earbuds, ear pads, and accessory kits', () => {
  const sorted = sortCandidates([
    candidate({ id: 'yahoo:buds', title: 'Bose QuietComfort Earbuds イヤホン', price: 3000 }),
    candidate({ id: 'yahoo:pad', title: 'Bose イヤーパッド 交換', price: 1500 }),
    candidate({ id: 'yahoo:kit', title: 'Bose ear cushion kit', price: 1800 }),
    candidate({ id: 'yahoo:case', title: 'Bose ヘッドホン キャリングケース', price: 2000 }),
    candidate({ id: 'yahoo:hp', title: 'Bose QuietComfort ヘッドホン', price: 28000 }),
  ], HEADPHONES);
  assert.equal(sorted[0].id, 'yahoo:hp');
  const ids = sorted.map((item) => item.id);
  assert.equal(ids.indexOf('yahoo:hp') < ids.indexOf('yahoo:buds'), true);
  assert.equal(ids.indexOf('yahoo:hp') < ids.indexOf('yahoo:pad'), true);
  assert.equal(ids.indexOf('yahoo:hp') < ids.indexOf('yahoo:kit'), true);
  assert.equal(ids.indexOf('yahoo:hp') < ids.indexOf('yahoo:case'), true);
});

test('an earbud guess ranks earbuds ahead of cheaper over-ear headphones', () => {
  const query: SearchQuery = { name: 'Bose イヤホン', brand: 'Bose', model: null, jan: null };
  const sorted = sortCandidates([
    candidate({ id: 'yahoo:hp', title: 'Bose ヘッドホン', price: 1000 }),
    candidate({ id: 'yahoo:buds', title: 'Bose イヤホン', price: 18000 }),
  ], query);
  assert.deepEqual(sorted.map((item) => item.id), ['yahoo:buds', 'yahoo:hp']);
});

test('a query that asks for ear pads does not treat those pads as the wrong form', () => {
  const query: SearchQuery = { name: 'Bose イヤーパッド', brand: 'Bose', model: null, jan: null };
  const sorted = sortCandidates([
    candidate({ id: 'yahoo:hp', title: 'Bose ヘッドホン', price: 1000 }),
    candidate({ id: 'yahoo:pad', title: 'Bose イヤーパッド', price: 4000 }),
  ], query);
  assert.equal(sorted[0].id, 'yahoo:pad');
});

test('accepted copies keep a store rank that was already recorded', () => {
  const original = candidate({ id: 'yahoo:first', title: 'Bose ヘッドホン', price: 9000 });
  rememberStoreOrder([original]);
  const copy = acceptCandidate(original);
  assert.equal(copy != null, true);
  if (!copy) return;
  assert.equal(readStoreRank(copy), 0);
  assert.equal(Object.keys(copy).includes('storeRank'), false);
});
