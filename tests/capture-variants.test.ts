import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_MODELS, aiRequestBody, resolveAiModel, resolveSearchVariant } from '../src/lib/capture/ai-variants';
import { searchLadderSteps, storeSearchKeyword } from '../src/lib/capture/product-query';
import { searchWithLadder } from '../src/lib/capture/search-ladder';
import { ensembleGuess } from '../src/lib/capture/ensemble';
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
  const llama = aiRequestBody(AI_MODELS[0], '指示', '見て', 'data:image/jpeg;base64,AA==');
  assert.equal(typeof (llama.messages as { content: string }[])[1].content, 'string');
  assert.equal(typeof llama.image, 'string');
  assert.equal(llama.max_tokens, 400);
  const gemma = aiRequestBody(resolveAiModel('gemma4'), '指示', '見て', 'data:image/jpeg;base64,AA==');
  assert.equal(gemma.reasoning_effort, 'none');
  assert.equal((gemma.chat_template_kwargs as { enable_thinking: boolean }).enable_thinking, false);
  assert.equal(gemma.max_completion_tokens, 1024);
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

test('gemma choices are read when response is null, and example falls back to the pen type', async () => {
  const identifier = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: 'test-cloudflare-token',
    userId: 'gemma',
    model: 'gemma4',
    now: () => 3_000,
    http: async () => ({
      status: 200,
      body: JSON.stringify({
        success: true,
        result: {
          response: null,
          choices: [{ message: { content: JSON.stringify({ confidence: 'unsure', products: [{ name: 'マグカップ', brand: null, model: null, jan: null }] }) } }],
        },
      }),
    }),
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.products[0].name.includes('マグ'), true);
  const steps = searchLadderSteps({ name: 'example ブルー ペン', brand: null, model: null });
  assert.equal(steps[0].name.includes('example'), false);
  assert.equal(steps.some((step) => step.name.includes('ペン')), true);
  assert.equal(storeSearchKeyword({ name: 'example ブルー ペン', brand: null, model: null }, { maxChars: 128, maxBytes: 128 }).includes('example'), false);
});

test('a shop error still continues to the category query', async () => {
  const names: string[] = [];
  const shoe = {
    id: 'yahoo:shoe',
    site: 'yahoo' as const,
    title: '茶色のシューズ',
    price: 3000,
    url: 'https://store.shopping.yahoo.co.jp/example/shoe',
    fetchedAt: '2026-10-29T00:00:00.000Z',
    shopName: '店',
  };
  let yahooCalls = 0;
  const result = await searchWithLadder(
    { name: 'vamp quarter wingtip ブラウン シューズ', brand: null, model: null },
    {
      identifier: { async identify() { throw new Error('unused'); } },
      yahoo: { async search(query) {
        yahooCalls += 1;
        names.push(query.name);
        if (yahooCalls === 1) return { ok: false as const, error: { code: 'SEARCH_FAILED' as const, error: 'empty' }, status: 502 };
        return { ok: true as const, value: [shoe] };
      } },
      rakuten: { async search() { return { ok: false as const, error: { code: 'SEARCH_FAILED' as const, error: 'empty' }, status: 502 }; } },
    },
    null,
  );
  assert.equal(result.ok, true);
  assert.equal(names.some((name) => name.includes('シューズ') && !name.includes('wingtip')), true);
});

test('ensemble keeps a series only when both models saw the same brand', () => {
  const kept = ensembleGuess(
    { confidence: 'sure', product: { name: 'Dyson 掃除機', brand: 'Dyson', model: null, jan: null } },
    { confidence: 'sure', product: { name: 'Dyson V11 Absolute Pro 掃除機', brand: 'Dyson', model: 'V11 Absolute Pro', jan: null } },
  );
  assert.equal(kept.product?.model, 'V11 Absolute Pro');
  assert.equal(kept.product?.name.includes('Dyson'), true);
  const dropped = ensembleGuess(
    { confidence: 'unsure', product: { name: '黒いサンダル', brand: null, model: null, jan: null } },
    { confidence: 'sure', product: { name: 'Birkenstock ブラック サンダル', brand: 'Birkenstock', model: null, jan: null } },
  );
  assert.equal(dropped.confidence, 'unsure');
  assert.equal(dropped.product?.brand, null);
  assert.equal(dropped.product?.name.includes('Birkenstock'), false);
  assert.equal(dropped.product?.name.includes('サンダル'), true);
});

test('a shoes guess does not score a bag in the top 3 as the right category', () => {
  const bags = scorePhoto({
    id: 'balenciaga-arena',
    confidence: 'unsure',
    name: '白いスニーカー',
    brand: null,
    hits: 10,
    top3: ['バレンシアガ ハンドバッグ'],
  });
  assert.equal(bags.category, false);
});



test('broad fallback candidates cannot outrank results from the original search', async () => {
  const candidate = (id: string, site: 'yahoo' | 'rakuten', title: string, price: number) => ({ id, site, title, price, url: site === 'yahoo' ? 'https://store.shopping.yahoo.co.jp/example/item' : 'https://item.rakuten.co.jp/example/item', fetchedAt: '2026-10-29T00:00:00.000Z', shopName: '店' });
  const exact = candidate('yahoo:exact', 'yahoo', 'Dyson V10 掃除機', 40000);
  const broad = candidate('rakuten:broad', 'rakuten', 'Generic 掃除機', 1000);
  const result = await searchWithLadder({ name: 'Dyson V10 掃除機', brand: 'Dyson', model: 'V10' }, {
    identifier: { async identify() { throw new Error('unused'); } },
    yahoo: { async search() { return { ok: true, value: [exact] }; } },
    rakuten: { async search(query) { return { ok: true, value: query.name.includes('V10') ? [] : [broad] }; } },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.candidates.map((item) => item.id), [exact.id, broad.id]);
});
