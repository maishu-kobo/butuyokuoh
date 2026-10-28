import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { storeSearchKeyword } from '../src/lib/capture/product-query';
import { createWorkersAiIdentifier, type WorkersAiHttpResponse } from '../src/lib/capture/workers-ai';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);

interface LiveRow {
  id: string;
  modelCalls?: { response?: string | null }[];
}

function load(name: string): LiveRow[] {
  const body = JSON.parse(readFileSync(new URL(`./eval/photo-search/fixtures/${name}`, import.meta.url), 'utf8')) as { rows: LiveRow[] };
  return body.rows;
}

function cf(text: string): WorkersAiHttpResponse {
  return { status: 200, body: JSON.stringify({ success: true, result: { response: text }, errors: [], messages: [] }) };
}

async function replay(raw: string) {
  const identifier = createWorkersAiIdentifier({
    accountId: 'd'.repeat(32),
    apiToken: 'replay-token',
    userId: 'replay',
    now: () => 1_000,
    http: async () => cf(raw),
  });
  return identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
}

test('live prompt copies of the shoe example are not turned into a search', async () => {
  const leaks = ['levis-jeans', 'lv-handbag', 'regal-dress-shoes', 'balenciaga-shoes'];
  const rows = load('live-pr.json');
  for (const id of leaks) {
    const row = rows.find((item) => item.id === id);
    assert.ok(row?.modelCalls?.[0]?.response, id);
    const result = await replay(row.modelCalls[0].response as string);
    assert.equal(result.ok, true, id);
    if (!result.ok) continue;
    assert.equal(result.value.confidence, 'unreadable', id);
    assert.equal(JSON.stringify(result.value).includes('バレンシアガ'), false, id);
  }
});

test('the live Dyson reply keeps the series in the name and stays searchable', async () => {
  const row = load('live-pr.json').find((item) => item.id === 'dyson-vacuum');
  assert.ok(row?.modelCalls?.[0]?.response);
  const result = await replay(row.modelCalls[0].response as string);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.confidence, 'sure');
  const product = result.value.products[0];
  assert.equal(product.model, 'V11 Absolute Pro');
  assert.equal(product.name.includes('Dyson'), true);
  assert.equal(product.name.includes('V11'), true);
  const keyword = storeSearchKeyword(product, { maxChars: 128, maxBytes: 128 });
  assert.equal(keyword.includes('V11'), true);
  assert.equal(Buffer.byteLength(keyword, 'utf8') <= 128, true);
});

test('the live backpack reply does not repeat the brand or send a bare hyphen', async () => {
  const row = load('live-pr.json').find((item) => item.id === 'northface-backpack');
  assert.ok(row?.modelCalls?.[0]?.response);
  const result = await replay(row.modelCalls[0].response as string);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const product = result.value.products[0];
  const keyword = storeSearchKeyword(product, { maxChars: 128, maxBytes: 128 });
  assert.equal(keyword.includes(' - '), false);
  assert.equal(keyword.split('The North Face').length, 2);
  assert.equal(Buffer.byteLength(keyword, 'utf8') <= 128, true);
});

test('the live rune-tote sentence is shortened to a color and a bag type', async () => {
  const row = load('live-pr.json').find((item) => item.id === 'muji-tote');
  assert.ok(row?.modelCalls?.[0]?.response);
  const result = await replay(row.modelCalls[0].response as string);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const keyword = storeSearchKeyword(result.value.products[0], { maxChars: 128, maxBytes: 128 });
  assert.equal(keyword.includes('文字'), false);
  assert.equal(keyword.includes('バッグ') || keyword.includes('トート'), true);
  assert.equal(Buffer.byteLength(keyword, 'utf8') <= 128, true);
});
