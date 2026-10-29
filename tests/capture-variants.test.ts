import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_MODELS, aiRequestBody, resolveAiModel, resolveSearchVariant } from '../src/lib/capture/ai-variants';
import { searchLadderSteps } from '../src/lib/capture/product-query';
import { WORKERS_AI_MODEL, createWorkersAiIdentifier, type WorkersAiHttpRequest } from '../src/lib/capture/workers-ai';
import { scorePhoto } from './eval/photo-search/rubric';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const ACCOUNT = 'a'.repeat(32);

test('the default model stays llama 3.2 and an unknown id does not change the URL', async () => {
  assert.equal(AI_MODELS[0].id, WORKERS_AI_MODEL);
  assert.equal(resolveAiModel(undefined).id, WORKERS_AI_MODEL);
  assert.equal(resolveAiModel('https://evil.example/run').id, WORKERS_AI_MODEL);
  assert.equal(resolveSearchVariant('nope').name, 'llama32');
  const calls: WorkersAiHttpRequest[] = [];
  const identifier = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'variant',
    model: '@cf/meta/llama-4-scout-17b-16e-instruct',
    now: () => 1_000,
    http: async (request) => {
      calls.push(request);
      return { status: 200, body: JSON.stringify({ success: true, result: { response: JSON.stringify({ confidence: 'unreadable', products: [] }) } }) };
    },
  });
  await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(calls[0].url.endsWith('/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct'), true);
  const body = JSON.parse(calls[0].body) as { image?: string; messages: { content: unknown }[] };
  assert.equal(body.image, undefined);
  assert.equal(Array.isArray(body.messages[1].content), true);
  const llama = aiRequestBody('image-field', '指示', '見て', 'data:image/jpeg;base64,AA==');
  assert.equal(typeof (llama.messages as { content: string }[])[1].content, 'string');
  assert.equal(typeof llama.image, 'string');
});

test('a missing brand phrase is removed and zero-hit descriptions gain a type query', async () => {
  const { createWorkersAiIdentifier: create } = await import('../src/lib/capture/workers-ai');
  const identifier = create({
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'ground',
    now: () => 2_000,
    http: async () => ({
      status: 200,
      body: JSON.stringify({ success: true, result: { response: JSON.stringify({
        confidence: 'sure',
        products: [{ name: 'ブランド名のない白いTシャツ', brand: null, model: null, productType: 'Tシャツ', color: '白', jan: null }],
      }) } }),
    }),
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].name.includes('ブランド名'), false);
  assert.equal(result.value.confidence, 'unsure');
  const handbag = searchLadderSteps({ name: '大判の革の手提げ袋', brand: null, model: null });
  assert.equal(handbag.some((step) => step.name.includes('ハンドバッグ') || step.name.includes('バッグ')), true);
  const shoe = searchLadderSteps({ name: 'vamp quarter wingtip ブラウン シューズ', brand: null, model: null });
  assert.equal(shoe.some((step) => step.name === 'ブラウン シューズ' || step.name === 'シューズ'), true);
  const perfume = searchLadderSteps({ name: 'パール山水の香り 赤 香水', brand: null, model: null });
  assert.equal(perfume.some((step) => step.name === '香水' || step.name === '赤 香水'), true);
});

test('the rubric marks a sure wrong brand and a category miss', () => {
  const wrong = scorePhoto({
    id: 'blue-jeans',
    confidence: 'sure',
    name: "Levi's 711 Skinny Jeans",
    brand: "Levi's",
    hits: 40,
    top3: ['リーバイス 711 スキニー'],
  });
  assert.equal(wrong.noWrongBrand, false);
  assert.equal(wrong.brand, null);
  const pole = scorePhoto({
    id: 'trekking-backpack',
    confidence: 'unsure',
    name: 'Trekking Pole',
    brand: null,
    hits: 40,
    top3: ['TREKKING POLE TIP'],
  });
  assert.equal(pole.category, false);
  assert.equal(pole.noWrongBrand, true);
});

test('the live pr03 fixtures exist for the regressions', () => {
  const body = JSON.parse(readFileSync(new URL('./eval/photo-search/fixtures/live-pr03.json', import.meta.url), 'utf8')) as { rows: { id: string }[] };
  for (const id of ['blue-jeans', 'trekking-backpack', 'pen-writing-example', 'prada-tooled-handbag', 'oxford-brogue', 'coty-suma-perfume', 'balenciaga-arena']) {
    assert.equal(body.rows.some((row) => row.id === id), true, id);
  }
});
