import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortCandidates, type CaptureCandidate, type SearchQuery } from '../src/lib/capture/contract';
import { createYahooRateGate, createYahooSearch, type YahooFetch, type YahooRequest } from '../src/lib/capture/yahoo';
import { createRakutenLimiter, createRakutenSearch, type RakutenHttp, type RakutenHttpRequest } from '../src/lib/capture/rakuten';

const APP_ID = 'test-app-id';
const NOW = Date.parse('2026-10-23T00:26:39.608Z');
const PHONE = 'Google Pixel 9 128GB グレー';
const PHONE_QUERY: SearchQuery = { name: 'Google Pixel グレー', brand: null, model: null, jan: null };
const CASE_QUERY: SearchQuery = { name: 'Google Pixel ケース', brand: null, model: null, jan: null };
const YAHOO_EXCLUSION = 'Google Pixel グレー -ケース -カバー -フィルム -充電器 -ケーブル -ストラップ';
const RAKUTEN_EXCLUSION = 'ケース カバー フィルム 充電器 ケーブル ストラップ';

// 候補がケースばかりだった画面の商品名。
const SCREENSHOT_CASES = [
  'Google Pixel9a ケース 手帳型 おしゃれ Pixel8a Pixel7a カバー シンプル 黒 ブラック 赤 レッド グレー ピンク ブルー グリーンスマホケース 送料無料',
  'Google Pixel 11 Pro ケース ソフトバンパー クリアケース | グーグル ピクセル 11 プロ カバー TPU 透明 耐衝撃 スマホケース',
  'Google Pixel 10a ケース Pixel 9a ケース Pixel 9 Pixel 8a Pro Pixel 7a シリコン ケース カバー スマホケース マット ソフトケース ストラップ 保護ケース',
  'CASUAL-SLOT Google Pixel 11 Pro XL 10a 10 9a 9 Pro XL 8a 8 7a 7 Pro Pixel 6a 6 Pro 4 XL ケース カバー スマホケース カード収納 背面収納 カード シンプル',
];

function yahooHit(title: string, index: number, price: number) {
  return {
    name: title,
    url: `https://store.shopping.yahoo.co.jp/example/item-${index}`,
    code: `item_${index}`,
    price,
    seller: { name: index === 0 ? 'ACE' : 'テストショップ' },
  };
}

function yahooHarness(hits: Record<string, unknown>[]) {
  const calls: { url: string; init: YahooRequest }[] = [];
  const fetch: YahooFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ hits }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const search = createYahooSearch({
    appId: APP_ID,
    userId: 'user-1',
    gate: createYahooRateGate(),
    now: () => NOW,
    fetch,
    schedule: () => () => {},
  });
  return { calls, search };
}

function rakutenItem(title: string, index: number, price: number) {
  return {
    itemName: title,
    itemPrice: price,
    itemUrl: `https://item.rakuten.co.jp/example/item-${index}`,
    itemCode: `example:item-${index}`,
    shopName: 'テスト楽天店',
  };
}

function rakutenHarness(items: Record<string, unknown>[]) {
  const calls: RakutenHttpRequest[] = [];
  const http: RakutenHttp = async (request) => {
    calls.push(request);
    return { status: 200, body: JSON.stringify({ items }) };
  };
  const search = createRakutenSearch({
    credentials: { applicationId: APP_ID, accessKey: 'test-access-key' },
    http,
    limiter: createRakutenLimiter(),
    userId: 'user-1',
    now: () => new Date(NOW),
  });
  return { calls, search };
}

function candidate(partial: Pick<CaptureCandidate, 'id' | 'title' | 'price'> & Partial<CaptureCandidate>): CaptureCandidate {
  return {
    site: 'yahoo',
    url: 'https://store.shopping.yahoo.co.jp/example/item',
    fetchedAt: '2026-10-23T00:26:39.608Z',
    shopName: 'テストショップ',
    ...partial,
  };
}

test('a phone name asks Yahoo and Rakuten to drop accessory words and keeps the phone', async () => {
  const hits = [
    ...SCREENSHOT_CASES.map((title, index) => yahooHit(title, index, 699 + index)),
    yahooHit(PHONE, 9, 89800),
  ];
  const yahoo = yahooHarness(hits);
  const found = await yahoo.search.search(PHONE_QUERY);
  assert.equal(yahoo.calls.length, 1);
  assert.equal(new URL(yahoo.calls[0].url).searchParams.get('query'), YAHOO_EXCLUSION);
  assert.equal(new URL(yahoo.calls[0].url).searchParams.get('results'), '10');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(found.value.map((item) => item.title), [PHONE]);

  const rakuten = rakutenHarness([
    ...SCREENSHOT_CASES.map((title, index) => rakutenItem(title, index, 699 + index)),
    rakutenItem(PHONE, 9, 89800),
  ]);
  const rakutenFound = await rakuten.search.search(PHONE_QUERY);
  assert.equal(rakuten.calls.length, 1);
  const rakutenUrl = new URL(rakuten.calls[0].url);
  assert.equal(rakutenUrl.searchParams.get('keyword'), 'Google Pixel グレー');
  assert.equal(rakutenUrl.searchParams.get('NGKeyword'), RAKUTEN_EXCLUSION);
  assert.equal(rakutenFound.ok, true);
  if (!rakutenFound.ok) return;
  assert.deepEqual(rakutenFound.value.map((item) => item.title), [PHONE]);
});

test('accessory-only results stay, and an accessory search does not exclude those words', async () => {
  const cases = SCREENSHOT_CASES.map((title, index) => yahooHit(title, index, 699 + index));
  const yahoo = yahooHarness(cases);
  const found = await yahoo.search.search(PHONE_QUERY);
  assert.equal(yahoo.calls.length, 1);
  assert.equal(found.ok, true);
  if (!found.ok) return;
  assert.deepEqual(found.value.map((item) => item.title), SCREENSHOT_CASES);

  const accessory = yahooHarness(cases);
  const kept = await accessory.search.search(CASE_QUERY);
  assert.equal(new URL(accessory.calls[0].url).searchParams.get('query'), 'Google Pixel ケース');
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.deepEqual(kept.value.map((item) => item.title), SCREENSHOT_CASES);

  const rakuten = rakutenHarness(SCREENSHOT_CASES.map((title, index) => rakutenItem(title, index, 980)));
  const rakutenKept = await rakuten.search.search(CASE_QUERY);
  assert.equal(new URL(rakuten.calls[0].url).searchParams.get('keyword'), 'Google Pixel ケース');
  assert.equal(new URL(rakuten.calls[0].url).searchParams.has('NGKeyword'), false);
  assert.equal(rakutenKept.ok, true);
  if (!rakutenKept.ok) return;
  assert.deepEqual(rakutenKept.value.map((item) => item.title), SCREENSHOT_CASES);
});

test('a JAN search does not add accessory exclusions', async () => {
  const query: SearchQuery = { name: PHONE, brand: null, model: null, jan: '4900000000009' };
  const yahoo = yahooHarness([yahooHit(PHONE, 1, 89800)]);
  await yahoo.search.search(query);
  const yahooUrl = new URL(yahoo.calls[0].url);
  assert.equal(yahooUrl.searchParams.get('jan_code'), '4900000000009');
  assert.equal(yahooUrl.searchParams.has('query'), false);

  const rakuten = rakutenHarness([rakutenItem(PHONE, 1, 89800)]);
  await rakuten.search.search(query);
  const rakutenUrl = new URL(rakuten.calls[0].url);
  assert.equal(rakutenUrl.searchParams.get('keyword'), '4900000000009');
  assert.equal(rakutenUrl.searchParams.has('NGKeyword'), false);
});

test('a long name keeps the Yahoo exclusion inside 400 characters', async () => {
  const yahoo = yahooHarness([yahooHit(PHONE, 1, 89800)]);
  await yahoo.search.search({ name: 'あ'.repeat(400), brand: null, model: null, jan: null });
  const query = new URL(yahoo.calls[0].url).searchParams.get('query') ?? '';
  assert.equal(query.length <= 400, true);
  assert.equal(query.endsWith(' -ストラップ'), true);
  assert.equal(query.includes('あ'), true);
});

test('recommended order puts the phone ahead of a cheaper case, including a 5G対応 listing', () => {
  const query = PHONE_QUERY;
  const sorted = sortCandidates([
    candidate({ id: 'yahoo:case', title: SCREENSHOT_CASES[0], price: 699 }),
    candidate({ id: 'yahoo:phone', title: PHONE, price: 89800 }),
    candidate({ id: 'yahoo:compatible', title: 'Google Pixel 9 128GB グレー 5G対応', price: 84800 }),
  ], query);
  assert.deepEqual(sorted.map((item) => item.id), ['yahoo:phone', 'yahoo:compatible', 'yahoo:case']);
  assert.deepEqual(sortCandidates(sorted, query).map((item) => item.id), sorted.map((item) => item.id));

  const wantedCase = sortCandidates([
    candidate({ id: 'yahoo:phone', title: PHONE, price: 89800 }),
    candidate({ id: 'yahoo:case', title: SCREENSHOT_CASES[1], price: 980 }),
  ], CASE_QUERY);
  assert.deepEqual(wantedCase.map((item) => item.id), ['yahoo:case', 'yahoo:phone']);
});
