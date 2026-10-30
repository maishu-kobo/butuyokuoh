import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeCandidates } from '../src/lib/capture/candidate-dedupe';
import { type CaptureCandidate, type CapturePorts } from '../src/lib/capture/contract';
import { searchWithPorts } from '../src/lib/capture/fakes';
import { searchWithLadder } from '../src/lib/capture/search-ladder';

const TITLE = '新品未使用 スマートフォン 本体 Google Pixel 7 Pro Pixel 7 Pro Google SIMフリー SIMフリー 赤ロム保証 128GB グレー 128GB';
const FETCHED = '2026-10-30T00:00:00.000Z';

function yahoo(path: string, id: string, overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id,
    site: 'yahoo',
    title: TITLE,
    price: 91_800,
    url: `https://store.shopping.yahoo.co.jp/degifarm/${path}`,
    fetchedAt: FETCHED,
    shopName: 'DegiFarm',
    ...overrides,
  };
}

function ports(candidates: CaptureCandidate[]): CapturePorts {
  return {
    identifier: { async identify() { throw new Error('unused'); } },
    yahoo: { async search() { return { ok: true, value: candidates.filter((item) => item.site === 'yahoo') }; } },
    rakuten: { async search() { return { ok: true, value: candidates.filter((item) => item.site === 'rakuten') }; } },
  };
}

const query = { name: 'Google Pixel 7 Pro グレー スマートフォン', brand: 'Google', model: 'Pixel 7 Pro', jan: null };

test('the same DegiFarm listing on two Yahoo item URLs is one candidate', async () => {
  const first = yahoo('99x1496.html', 'yahoo:99x1496');
  const second = yahoo('99x1497.html', 'yahoo:99x1497');
  const other = yahoo('other.html', 'yahoo:other', { title: 'Google Pixel 7 128GB ブラック', price: 80_000 });
  const result = await searchWithPorts(query, ports([first, second, other]), null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates.length, 2);
  assert.equal(result.value.candidates.some((item) => item.title === other.title), true);
  assert.equal(result.value.candidates.filter((item) => item.shopName === 'DegiFarm' && item.price === 91_800).length, 1);
  assert.deepEqual(dedupeCandidates([second, first]).map((item) => item.id), [second.id]);
});

test('the same product page with a tracking query is one candidate, and a different price stays', async () => {
  const page = yahoo('99x1496.html', 'yahoo:page');
  const tracked = yahoo('99x1496.html?sc_i=shopping-pc-web', 'yahoo:tracked', { title: `${TITLE}  ` });
  const cheaper = yahoo('99x1496.html', 'yahoo:cheaper', { price: 90_000 });
  const result = await searchWithPorts(query, ports([page, tracked, cheaper]), null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.candidates.map((item) => item.id), [cheaper.id]);
});

test('the same title at another shop, and a spaced title of the same listing, follow the listing key', async () => {
  const spaced = yahoo('99x1496.html', 'yahoo:spaced', { title: TITLE.replace(/ /g, '  '), shopName: 'ＤｅｇｉＦａｒｍ' });
  const exact = yahoo('99x1497.html', 'yahoo:exact');
  const otherShop = yahoo('99x1498.html', 'yahoo:other-shop', { shopName: '別店', url: 'https://store.shopping.yahoo.co.jp/other/99x1498.html' });
  const kept = dedupeCandidates([exact, spaced, otherShop]);
  assert.deepEqual(kept.map((item) => item.id), [exact.id, otherShop.id]);
});

test('a Rakuten affiliate wrapper and its product URL are one candidate', async () => {
  const product = 'https://item.rakuten.co.jp/example-shop/pen';
  const affiliate = `https://hb.afl.rakuten.co.jp/hgc/test-link/?pc=${encodeURIComponent(product)}`;
  const direct: CaptureCandidate = {
    id: 'rakuten:pen',
    site: 'rakuten',
    title: 'ペン',
    price: 1200,
    url: product,
    fetchedAt: FETCHED,
    shopName: '店',
  };
  const wrapped: CaptureCandidate = { ...direct, id: 'rakuten:wrapped', url: affiliate };
  const result = await searchWithPorts(query, ports([wrapped, direct]), null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.candidates.map((item) => item.id), [direct.id]);
});

test('same URL and same listing key do not transitively replace a different product', () => {
  // Cheapest overall shares listing key with a mid row that shares URL with an expensive phone.
  // Transitive union would drop the distinct URL; non-transitive keeps both after URL then listing.
  const expensiveFirst = yahoo('phone.html', 'yahoo:cheap-url', {
    title: 'Google Pixel 7 Pro 128GB グレー',
    price: 70_000,
  });
  const bridge = yahoo('phone.html', 'yahoo:bridge', {
    title: '別タイトルの掲載',
    price: 80_000,
  });
  const distinctListing = yahoo('distinct.html', 'yahoo:distinct', {
    title: '別タイトルの掲載',
    price: 80_000,
    url: 'https://store.shopping.yahoo.co.jp/degifarm/distinct.html',
  });
  const nonTransitive = dedupeCandidates([expensiveFirst, bridge, distinctListing]);
  assert.deepEqual(nonTransitive.map((item) => item.id), ['yahoo:cheap-url', 'yahoo:distinct']);
});

test('a later query variant does not bring the same listing back', async () => {
  let calls = 0;
  const result = await searchWithLadder(
    { name: 'Google Pixel 7 Pro グレー スマートフォン', brand: null, model: null },
    {
      identifier: { async identify() { throw new Error('unused'); } },
      yahoo: {
        async search() {
          calls += 1;
          return {
            ok: true,
            value: [calls === 1 ? yahoo('99x1496.html', 'yahoo:first') : yahoo('99x1497.html', 'yahoo:later')],
          };
        },
      },
      rakuten: { async search() { return { ok: true, value: [] }; } },
    },
  );
  assert.equal(calls > 1, true);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.candidates.map((item) => item.id), ['yahoo:first']);
});
