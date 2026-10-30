import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guardIdentifyResult } from '../src/lib/capture/brand-guard';
import { searchLadderSteps, storeSearchKeyword } from '../src/lib/capture/product-query';
import { createWorkersAiIdentifier } from '../src/lib/capture/workers-ai';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pixel-10-pro-fold.json', import.meta.url), 'utf8')) as {
  confidence: string;
  products: { name: string; model: string; visibleText: string }[];
};

test('a sure Pixel generation with no printed number keeps the line and the phone type', async () => {
  assert.equal(fixture.products[0].name, 'Google Pixel 8 Pro');
  assert.equal(fixture.products[0].visibleText, '');
  const identifier = createWorkersAiIdentifier({
    accountId: 'a'.repeat(32),
    apiToken: 'test-cloudflare-token',
    userId: 'pixel-fold',
    model: '@cf/meta/llama-4-scout-17b-16e-instruct',
    now: () => 1_000,
    http: async () => ({
      status: 200,
      body: JSON.stringify({ success: true, result: { response: JSON.stringify(fixture) } }),
    }),
  });
  const raw = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  const guarded = guardIdentifyResult(raw);
  assert.equal(guarded.ok, true);
  if (!guarded.ok) return;
  const product = guarded.value.products[0];
  assert.equal(product.brand, 'Google');
  assert.equal(product.model, null);
  assert.equal(product.name.includes('Pixel'), true);
  assert.equal(product.name.includes('8'), false);
  assert.equal(product.name.includes('Pro'), false);
  assert.equal(product.name.includes('スマートフォン'), true);
  assert.equal(product.name.includes('本体'), true);
  assert.equal(product.name === 'Google', false);
  const keywords = searchLadderSteps(product).map((step) => storeSearchKeyword(step, { maxChars: 128, maxBytes: 128 }));
  assert.equal(keywords.some((keyword) => keyword === 'Google'), false);
  assert.equal(keywords[0], 'Google Pixel Fold');
  assert.equal(product.series, 'Pixel');
  assert.equal(product.formFactor, 'foldable');
});
