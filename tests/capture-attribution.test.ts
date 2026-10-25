import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { searchAttribution, amazonAffiliateLink } from '../src/lib/capture/search-attribution';
import { createFakePorts, searchWithPorts } from '../src/lib/capture/fakes';
import { captureFailure, CaptureMessages } from '../src/lib/capture/contract';

const query = { name: 'ペン', brand: null, model: null, jan: null };
const now = () => new Date('2026-10-24T00:00:00Z');

test('credits survive empty results and either or both provider failures', async () => {
  for (const scenario of ['default', 'empty', 'yahoo-down', 'rakuten-down', 'both-down'] as const) {
    const result = await searchWithPorts(query, createFakePorts(scenario, now));
    assert.deepEqual(searchAttribution(result), { yahoo: true, rakuten: true });
  }
});

test('unconfigured providers are not advertised as data sources', async () => {
  for (const site of ['yahoo', 'rakuten'] as const) {
    const ports = createFakePorts('empty', now);
    ports[site] = { async search() { return captureFailure('SEARCH_NOT_CONFIGURED', CaptureMessages.searchUnconfigured, 503); } };
    const result = await searchWithPorts(query, ports);
    assert.deepEqual(searchAttribution(result), { yahoo: site !== 'yahoo', rakuten: site !== 'rakuten' });
    ports.yahoo = ports[site]; ports.rakuten = ports[site];
    assert.deepEqual(searchAttribution(await searchWithPorts(query, ports)), { yahoo: false, rakuten: false });
  }
});

test('affiliate disclosure applies only to validated tagged Amazon search links', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom('a', 'Z', '0', '-'), { minLength: 1, maxLength: 50 }), (letters) => {
    const tag = letters.join('');
    assert.equal(amazonAffiliateLink(`https://www.amazon.co.jp/s?k=pen&tag=${tag}`), true);
    assert.equal(amazonAffiliateLink(`https://www.amazon.co.jp.evil.test/s?tag=${tag}`), false);
  }), { seed: 20261024, numRuns: 40 });
  for (const url of ['', 'javascript:alert(1)', 'https://www.amazon.co.jp/s?k=pen', 'https://www.amazon.co.jp/s?tag=', 'https://www.amazon.co.jp/s?tag=a%20b', 'http://www.amazon.co.jp/s?tag=test', 'https://user@www.amazon.co.jp/s?tag=test']) {
    assert.equal(amazonAffiliateLink(url), false, url);
  }
});
