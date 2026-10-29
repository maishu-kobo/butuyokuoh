import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSearchVariant } from '../src/lib/capture/ai-variants';
import { guardSureBrand } from '../src/lib/capture/brand-guard';
import { applyCandidatePick, geminiRerankRequest, rerankCandidates } from '../src/lib/capture/candidate-rerank';
import { geminiCallsForPhoto, sumGeminiCalls } from './eval/photo-search/gemini-retry';
import { WORKERS_AI_MODEL } from '../src/lib/capture/workers-ai';

const photo = { mediaType: 'image/jpeg', bytes: Uint8Array.of(0xff, 0xd8, 0xff) };

test('a league mark on the wrong category is dropped, and an unread model number is not', () => {
  const watch = guardSureBrand({
    confidence: 'sure',
    product: { name: 'アナログ', brand: 'MLB', model: null, jan: null },
    evidence: { textProvided: false, visibleText: '', productType: '腕時計', color: 'シルバー' },
  });
  assert.equal(watch.guarded, true);
  assert.equal(watch.confidence, 'unsure');
  assert.equal(watch.product.brand, null);
  assert.equal(watch.product.model, null);
  assert.equal(watch.product.name.includes('MLB'), false);
  assert.equal(watch.product.name.includes('腕時計'), true);
  assert.equal(watch.product.name.includes('アナログ'), true);
  assert.equal(watch.product.name.includes('シルバー'), true);

  const laptop = guardSureBrand({
    confidence: 'sure',
    product: { name: 'HP Pavilion Gaming 15', brand: 'HP', model: 'Pavilion Gaming 15', jan: null },
    evidence: { textProvided: false, visibleText: '', productType: 'ノートパソコン', color: '黒' },
  });
  assert.equal(laptop.guarded, true);
  assert.equal(laptop.confidence, 'sure');
  assert.equal(laptop.product.brand, 'HP');
  assert.equal(laptop.product.model, null);
  assert.equal(laptop.product.name.includes('HP'), true);
  assert.equal(laptop.product.name.includes('Pavilion'), false);
  assert.equal(laptop.product.name.includes('15'), false);
  assert.equal(laptop.product.name.includes('ノートパソコン'), true);

  const lipstick = guardSureBrand({
    confidence: 'sure',
    product: { name: 'MAC リップスティック', brand: 'MAC', model: null, jan: null },
    evidence: { textProvided: false, visibleText: '', productType: '口紅', color: null },
  });
  assert.equal(lipstick.guarded, false);
  assert.equal(lipstick.product.brand, 'MAC');
  assert.equal(lipstick.product.name, 'MAC リップスティック');

  const cortez = guardSureBrand({
    confidence: 'sure',
    product: { name: 'ナイキ コルテッツ', brand: 'ナイキ', model: 'コルテッツ', jan: null },
    evidence: { textProvided: false, visibleText: '', productType: 'スニーカー', color: 'ホワイト' },
  });
  assert.equal(cortez.guarded, false);
  assert.equal(cortez.product.brand, 'ナイキ');
  assert.equal(cortez.product.model, 'コルテッツ');
});

test('readable text keeps a sure brand, and a category clash still drops it', () => {
  const kept = guardSureBrand({
    confidence: 'sure',
    product: { name: 'Dyson V11 掃除機', brand: 'Dyson', model: 'V11', jan: null },
    evidence: { textProvided: true, visibleText: 'Dyson V11', productType: '掃除機', color: null },
  });
  assert.equal(kept.guarded, false);
  assert.equal(kept.product.brand, 'Dyson');
  assert.equal(kept.product.model, 'V11');
  assert.equal(kept.confidence, 'sure');

  const clash = guardSureBrand({
    confidence: 'sure',
    product: { name: 'キャップ', brand: 'Nike', model: null, jan: null },
    evidence: { textProvided: true, visibleText: 'Nike', productType: '腕時計', color: 'シルバー' },
  });
  assert.equal(clash.guarded, true);
  assert.equal(clash.product.brand, null);
  assert.equal(clash.product.name.includes('Nike'), false);
  assert.equal(clash.product.name.includes('腕時計'), true);

  const unsure = guardSureBrand({
    confidence: 'unsure',
    product: { name: '白いスニーカー', brand: null, model: null, jan: null },
    evidence: { textProvided: false, visibleText: '', productType: 'スニーカー', color: '白' },
  });
  assert.equal(unsure.guarded, false);
  assert.equal(unsure.product.name, '白いスニーカー');
});

test('gemini reranks the top candidates once and keeps order when it fails', async () => {
  const items = [
    { title: '白いスニーカー', imageUrl: null },
    { title: '革靴', imageUrl: null },
    { title: 'Arena スニーカー', imageUrl: 'https://thumbnail.image.rakuten.co.jp/example/a.jpg' },
  ];
  assert.deepEqual(applyCandidatePick(items, 3).map((item) => item.title), ['Arena スニーカー', '白いスニーカー', '革靴']);
  assert.deepEqual(applyCandidatePick(items, 'none').map((item) => item.title), items.map((item) => item.title));
  let calls = 0;
  const picked = await rerankCandidates({
    photo,
    candidates: items,
    apiKey: 'AQ.exampleGeminiKeyValue',
    complete: async (request) => {
      calls += 1;
      const body = JSON.parse(request.body) as { generationConfig: { thinkingConfig: { thinkingLevel?: string; thinkingBudget?: number } } };
      assert.equal(request.url.includes('gemini-3.5-flash-lite'), true);
      assert.equal(request.url.includes('AQ.exampleGeminiKeyValue'), false);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
      assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, undefined);
      return { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"pick":"3"}' }] } }] }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(picked.candidates[0].title, 'Arena スニーカー');
  const failed = await rerankCandidates({
    photo,
    candidates: items,
    apiKey: 'AQ.exampleGeminiKeyValue',
    complete: async () => { throw new Error('down'); },
  });
  assert.deepEqual(failed.candidates.map((item) => item.title), items.map((item) => item.title));
  assert.equal(failed.called, true);
  const request = geminiRerankRequest({ mediaType: 'image/jpeg', base64: 'AA==' }, [{ title: '靴' }], 'AQ.exampleGeminiKeyValue');
  assert.equal(request?.body.includes('MLB'), false);
  assert.equal(request?.body.includes('HP'), false);
});

test('the new variants are opt-in and the fallback variant stays as it was', () => {
  assert.equal(resolveSearchVariant(undefined).model.id, WORKERS_AI_MODEL);
  const fallback = resolveSearchVariant('llama4-gemini-fallback');
  assert.equal(fallback.brandGuard, undefined);
  assert.equal(fallback.rerank, undefined);
  assert.equal(fallback.provider, 'fallback');
  const guard = resolveSearchVariant('llama4-brand-guard');
  assert.equal(guard.brandGuard, true);
  assert.equal(guard.rerank, undefined);
  assert.equal(guard.provider, 'workers');
  const grounded = resolveSearchVariant('llama4-gemini-grounded');
  assert.equal(grounded.brandGuard, true);
  assert.equal(grounded.rerank, true);
  assert.equal(grounded.provider, 'fallback');
  assert.equal(grounded.secondModel?.id, 'gemini-3.5-flash-lite');
  const route = readFileSync(new URL('../src/app/api/capture/identify/route.ts', import.meta.url), 'utf8');
  const harness = readFileSync(new URL('./eval/photo-search/live-harness.ts', import.meta.url), 'utf8');
  assert.equal(/process\.env/.test(route), false);
  assert.equal(route.includes('identifyGroundedVariant'), true);
  assert.equal(harness.includes('rerankCandidates'), true);
  assert.equal(harness.includes('geminiCalls'), true);
  assert.equal(harness.includes("CAPTURE_AI_RERANK === '1'"), true);
  assert.equal(harness.includes('geminiCallsForPhoto'), true);
  assert.equal(harness.includes('sumGeminiCalls'), true);
  const guardSource = readFileSync(new URL('../src/lib/capture/brand-guard.ts', import.meta.url), 'utf8');
  assert.equal(guardSource.includes('alb-wristwatch'), false);
  assert.equal(guardSource.includes('broken-laptop'), false);
  assert.equal(geminiCallsForPhoto(26, 23), 3);
  assert.equal(sumGeminiCalls([{ geminiCalls: 1 }, { geminiCalls: 1 }, { geminiCalls: 2 }]), 4);
  assert.equal(sumGeminiCalls([{ geminiCalls: 1 }, { geminiCalls: 2 }, { geminiCalls: 4 }]) === 7, true);
});
