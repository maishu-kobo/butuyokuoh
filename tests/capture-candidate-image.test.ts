import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptCandidate, type CaptureCandidate } from '../src/lib/capture/contract';
import { createYahooRateGate, createYahooSearch, type YahooFetch } from '../src/lib/capture/yahoo';
import { createRakutenLimiter, createRakutenSearch, type RakutenHttp } from '../src/lib/capture/rakuten';
import nextConfig from '../next.config';

const FETCHED_AT = '2026-10-23T00:26:39.608Z';
const YAHOO_IMAGE = 'https://item-shopping.c.yimg.jp/i/g/example_pixel';
const YAHOO_SMALL = 'https://item-shopping.c.yimg.jp/i/c/example_pixel';
const RAKUTEN_IMAGE = 'https://thumbnail.image.rakuten.co.jp/@0_mall/example/cabinet/pixel.jpg?_ex=128x128';
const TSHOP_IMAGE = 'https://tshop.r10s.jp/example/cabinet/pixel.jpg?_ex=128x128';

function yahooCandidate(imageUrl?: string): CaptureCandidate {
  return {
    id: 'yahoo:pixel',
    site: 'yahoo',
    title: 'Google Pixel 9 128GB グレー',
    price: 89800,
    url: 'https://store.shopping.yahoo.co.jp/example/pixel',
    fetchedAt: FETCHED_AT,
    shopName: 'テストショップ',
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function rakutenCandidate(imageUrl?: string): CaptureCandidate {
  return {
    id: 'rakuten:pixel',
    site: 'rakuten',
    title: 'Google Pixel 9 128GB グレー',
    price: 89800,
    url: 'https://item.rakuten.co.jp/example/pixel',
    fetchedAt: FETCHED_AT,
    shopName: 'テスト楽天店',
    ...(imageUrl ? { imageUrl } : {}),
  };
}

test('candidate images stay only when they are https on a provider image host', () => {
  const yahoo = acceptCandidate(yahooCandidate(YAHOO_IMAGE));
  assert.equal(yahoo?.imageUrl, YAHOO_IMAGE);
  const small = acceptCandidate(yahooCandidate(YAHOO_SMALL));
  assert.equal(small?.imageUrl, YAHOO_SMALL);
  const rakuten = acceptCandidate(rakutenCandidate(RAKUTEN_IMAGE));
  assert.equal(rakuten?.imageUrl, RAKUTEN_IMAGE);
  const tshop = acceptCandidate(rakutenCandidate(TSHOP_IMAGE));
  assert.equal(tshop?.imageUrl, TSHOP_IMAGE);

  const rejected = [
    'http://item-shopping.c.yimg.jp/i/g/example_pixel',
    'https://user:pass@item-shopping.c.yimg.jp/i/g/example_pixel',
    'https://item-shopping.c.yimg.jp:8443/i/g/example_pixel',
    'https://item-shopping.c.yimg.jp/i/g/example_pixel\n@evil.example/x',
    'https://item-shopping.c.yimg.jp\\@evil.example/x',
    'https://evil.example/pixel.jpg',
    'https://item-shopping.c.yimg.jp.evil.example/i/g/pixel',
    'javascript:alert(1)',
    'https://store.shopping.yahoo.co.jp/example/pixel.jpg',
    'http://thumbnail.image.rakuten.co.jp/pixel.jpg',
    'https://item.rakuten.co.jp/example/pixel.jpg',
  ];
  for (const imageUrl of rejected) {
    const site = imageUrl.includes('rakuten.co.jp') && !imageUrl.includes('item-shopping') ? rakutenCandidate(imageUrl) : yahooCandidate(imageUrl);
    const accepted = acceptCandidate(site);
    assert.equal(accepted === null, false, imageUrl);
    assert.equal(accepted?.imageUrl, undefined, imageUrl);
    assert.equal(JSON.stringify(accepted).includes('evil.example'), false, imageUrl);
    assert.equal(JSON.stringify(accepted).includes('javascript:'), false, imageUrl);
  }

  const hashed = acceptCandidate(yahooCandidate(`${YAHOO_IMAGE}#fragment`));
  assert.equal(hashed?.imageUrl, YAHOO_IMAGE);
});

test('Yahoo keeps image.medium, then image.small, and Rakuten keeps mediumImageUrls', async () => {
  const calls: string[] = [];
  const fetch: YahooFetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      hits: [{
        name: 'Google Pixel 9 128GB グレー',
        url: 'https://store.shopping.yahoo.co.jp/example/pixel',
        code: 'example_pixel',
        price: 89800,
        seller: { name: 'テストショップ' },
        image: { medium: YAHOO_IMAGE, small: 'https://evil.example/small.jpg' },
      }, {
        name: '予備の本体',
        url: 'https://store.shopping.yahoo.co.jp/example/other',
        code: 'example_other',
        price: 1000,
        seller: { name: 'テストショップ' },
        image: { medium: 'http://item-shopping.c.yimg.jp/i/g/other', small: YAHOO_SMALL },
      }],
    }), { status: 200 });
  };
  const yahoo = createYahooSearch({
    appId: 'test-app-id',
    gate: createYahooRateGate(),
    now: () => Date.parse(FETCHED_AT),
    fetch,
    schedule: () => () => {},
  });
  const found = await yahoo.search({ name: 'Google Pixel グレー', brand: null, model: null, jan: null });
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.equal(found.value[0].imageUrl, YAHOO_IMAGE);
  assert.equal(found.value[1].imageUrl, YAHOO_SMALL);
  assert.equal(JSON.stringify(found.value).includes('evil.example'), false);
  assert.equal(JSON.stringify(found.value).includes('http://'), false);

  const http: RakutenHttp = async () => ({
    status: 200,
    body: JSON.stringify({
      items: [
        {
          itemName: 'Google Pixel 9 128GB グレー',
          itemPrice: 89800,
          itemUrl: 'https://item.rakuten.co.jp/example/pixel',
          itemCode: 'example:pixel',
          shopName: 'テスト楽天店',
          mediumImageUrls: [{ imageUrl: RAKUTEN_IMAGE }, 'https://evil.example/other.jpg'],
        },
        {
          itemName: '予備の本体',
          itemPrice: 1000,
          itemUrl: 'https://item.rakuten.co.jp/example/other',
          itemCode: 'example:other',
          shopName: 'テスト楽天店',
          mediumImageUrls: [TSHOP_IMAGE],
        },
      ],
    }),
  });
  const rakuten = createRakutenSearch({
    credentials: { applicationId: 'test-app-id', accessKey: 'test-access-key' },
    http,
    limiter: createRakutenLimiter(),
    now: () => new Date(FETCHED_AT),
  });
  const rakutenFound = await rakuten.search({ name: 'Google Pixel グレー', brand: null, model: null, jan: null });
  assert.equal(rakutenFound.ok, true);
  if (!rakutenFound.ok) return;
  assert.equal(rakutenFound.value[0].imageUrl, RAKUTEN_IMAGE);
  assert.equal(rakutenFound.value[1].imageUrl, TSHOP_IMAGE);
  assert.equal(JSON.stringify(rakutenFound.value).includes('evil.example'), false);
});

test('next/image remotePatterns allow only the provider image hosts over https', () => {
  const patterns = nextConfig.images?.remotePatterns ?? [];
  const rendered = patterns.map((pattern) => {
    const protocol = 'protocol' in pattern ? pattern.protocol : '';
    const hostname = 'hostname' in pattern ? pattern.hostname : '';
    const pathname = 'pathname' in pattern ? pattern.pathname : '';
    return `${protocol}://${hostname}${pathname}`;
  });
  assert.deepEqual(rendered.sort(), [
    'https://item-shopping.c.yimg.jp/**',
    'https://thumbnail.image.rakuten.co.jp/**',
    'https://tshop.r10s.jp/**',
  ].sort());
  assert.equal(rendered.some((pattern) => pattern.startsWith('http://')), false);
  assert.equal(rendered.some((pattern) => pattern.includes('**') && !pattern.endsWith('/**')), false);
});

test('a candidate row formats the fetch time in Japan and renders an allowlisted thumbnail', async () => {
  const view = await import('../src/lib/capture/candidate-view');
  assert.equal(view.formatCandidateFetchedAt(FETCHED_AT), '2026/10/23 09:26');
  assert.equal(view.formatCandidateFetchedAt(FETCHED_AT).includes('T'), false);
  assert.equal(view.formatCandidateFetchedAt('not-a-date'), '');

  const thumb = view.candidateThumbnail(yahooCandidate(YAHOO_IMAGE));
  assert.deepEqual(thumb, { src: YAHOO_IMAGE, alt: 'Google Pixel 9 128GB グレー' });
  assert.equal(view.candidateThumbnail(yahooCandidate('https://evil.example/pixel.jpg')), null);
  assert.equal(view.candidateThumbnail(yahooCandidate('http://item-shopping.c.yimg.jp/i/g/example_pixel')), null);
  assert.equal(view.candidateThumbnail(rakutenCandidate(RAKUTEN_IMAGE))?.src, RAKUTEN_IMAGE);

  const doc = readFileSync(new URL('../docs/capture.md', import.meta.url), 'utf8');
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.equal(doc.includes('item-shopping.c.yimg.jp'), true);
  assert.equal(doc.includes('thumbnail.image.rakuten.co.jp'), true);
  assert.equal(doc.includes('tshop.r10s.jp'), true);
  assert.equal(doc.includes('日本時間'), true);
  assert.equal(changelog.includes('付属品'), true);
});
