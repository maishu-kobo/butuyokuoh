import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canonicalRakutenAffiliateUrl, rakutenProductIdentity } from '../src/lib/capture/rakuten-link';
import { createRakutenLimiter, createRakutenSearch } from '../src/lib/capture/rakuten';

function wrapped(pc: string, mobile: string): string {
  const url = new URL('https://hb.afl.rakuten.co.jp/hgc/test-link/');
  url.searchParams.set('pc', pc);
  url.searchParams.set('m', mobile);
  url.searchParams.set('rafcid', 'test-campaign');
  return url.toString();
}

const product = 'https://item.rakuten.co.jp/example-shop/black-leather-bag/';

test('API mobile numeric IDs use the validated PC destination, never a fabricated product slug', () => {
  const slug = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'), { minLength: 1, maxLength: 40 }).map(chars => chars.join(''));
  fc.assert(fc.property(slug, slug, fc.integer({ min: 1, max: 99999999 }), fc.boolean(), (shop, code, id, secure) => {
    const pc = `https://item.rakuten.co.jp/${shop}/${code}/`;
    const source = wrapped(pc, `${secure ? 'https' : 'http'}://m.rakuten.co.jp/${shop}/i/${id}/?discard=1`);
    const result = canonicalRakutenAffiliateUrl(source);
    assert.ok(result);
    const url = new URL(result);
    assert.equal(url.searchParams.get('pc'), pc);
    assert.equal(url.searchParams.get('m'), pc);
    assert.equal(url.searchParams.get('rafcid'), 'test-campaign');
    assert.equal(rakutenProductIdentity(result), pc);
    assert.equal(canonicalRakutenAffiliateUrl(result), result);
  }), { seed: 243, numRuns: 200 });
});

test('malformed, foreign-shop and ambiguous mobile destinations remain rejected', () => {
  for (const mobile of [
    'http://m.rakuten.co.jp/other-shop/i/123/',
    'http://m.rakuten.co.jp/example-shop/i/not-a-number/',
    'http://m.rakuten.co.jp/example-shop/i/123/extra',
    'http://m.rakuten.co.jp.evil.example/example-shop/i/123/',
    'http://user:pass@m.rakuten.co.jp/example-shop/i/123/',
    'http://m.rakuten.co.jp:8080/example-shop/i/123/',
    'http://m.rakuten.co.jp/example-shop/i/12%2F3/',
    'javascript:alert(1)',
  ]) assert.equal(canonicalRakutenAffiliateUrl(wrapped(product, mobile)), null, mobile);
  const duplicate = new URL(wrapped(product, 'http://m.rakuten.co.jp/example-shop/i/123/'));
  duplicate.searchParams.append('pc', 'https://item.rakuten.co.jp/example-shop/another/');
  assert.equal(canonicalRakutenAffiliateUrl(duplicate.toString()), null);
  const mixed = new URL(wrapped(product, 'http://m.rakuten.co.jp/example-shop/i/123/'));
  mixed.searchParams.append('m', 'https://evil.example/');
  assert.equal(canonicalRakutenAffiliateUrl(mixed.toString()), null);
});

test('the live API Items shape retains valid candidates, prices and source codes', async () => {
  const search = createRakutenSearch({
    credentials: { applicationId: 'fixture-app', accessKey: 'fixture-key' },
    limiter: createRakutenLimiter(), userId: 'fixture-user', now: () => new Date('2026-10-25T00:00:00Z'),
    referer: 'https://example.test',
    http: async () => ({ status: 200, body: JSON.stringify({ count: 30, Items: Array.from({ length: 30 }, (_, i) => ({
      itemName: `バッグ ${i}`, shopName: 'テスト店舗', itemCode: `example-shop:bag-${i}`,
      itemPrice: 1000 + i, itemUrl: wrapped(product, `http://m.rakuten.co.jp/example-shop/i/${100000 + i}/`),
    })) }) }),
  });
  const result = await search.search({ name: 'Black Leather Bag', brand: null, model: null, jan: null });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 30);
  result.value.forEach((item, i) => {
    assert.equal(item.price, 1000 + i);
    assert.equal(item.sourceItemCode, `example-shop:bag-${i}`);
    assert.equal(new URL(item.url).searchParams.get('m'), product);
  });
});
