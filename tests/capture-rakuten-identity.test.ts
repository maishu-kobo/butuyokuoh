import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import { createRakutenSearch } from '../src/lib/capture/rakuten';
import { acceptCandidate } from '../src/lib/capture/contract';
import { saveSearchCandidates } from '../src/lib/capture/live-search';
import { registerCapturedCandidates } from '../src/lib/capture/register';
import { refreshDueRakutenPrices } from '../src/lib/capture/rakuten-price';

const NOW = Date.UTC(2026, 9, 25);
const credentials = { applicationId: 'test-app', accessKey: 'test-key' };
const limiter = { tryAcquire: () => ({ ok: true as const }) };
const query = { name: 'ペン', jan: null, brand: null, model: null };
const response = (itemCode: string, price: number) => ({ status: 200, body: JSON.stringify({ items: [{ itemCode, itemPrice: price, itemName: 'ペン', shopName: '店', itemUrl: 'https://item.rakuten.co.jp/shop/pen/' }] }) });

test('real search codes survive normalization, persistence, registration and price refresh; editing URL clears identity', async () => {
  const member = await createMember('code-roundtrip');
  const database = await db();
  const search = createRakutenSearch({ credentials, limiter, now: () => new Date(NOW), http: async () => response('shop:Pen_ABC-1', 100) });
  const result = await search.search(query);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const candidate = acceptCandidate(result.value[0]);
  assert.ok(candidate);
  const saved = saveSearchCandidates(database, member.id, query, { candidates: [candidate], failures: [], amazonUrl: '' }, NOW);
  assert.ok(saved);
  const registration = registerCapturedCandidates(database, member.id, saved.storedIds, NOW);
  assert.equal(registration.ok, true);
  if (!registration.ok) return;
  const id = registration.itemIds[0];
  const stored = () => database.prepare('SELECT url, source_item_code, current_price, price_fetched_at FROM items WHERE id = ?').get(id) as { url: string; source_item_code: string | null; current_price: number; price_fetched_at: string | null };
  assert.equal(stored().source_item_code, 'rakuten:shop:Pen_ABC-1');
  const requested: string[] = [];
  const options = { credentials, limiter, now: () => new Date(NOW + 86_400_000), http: async (request: {url: string}) => {
    requested.push(new URL(request.url).searchParams.get('itemCode')!);
    return response('shop:Pen_ABC-1', 110);
  } };
  await refreshDueRakutenPrices(database, options);
  assert.deepEqual(requested, ['shop:Pen_ABC-1']);
  assert.equal(stored().current_price, 110);
  const unchanged = await call('../src/app/api/items/[id]/route.ts', 'PATCH', `/api/items/${id}`, { url: stored().url, notes: 'same product' }, { id: String(id) });
  assert.equal(unchanged.status, 200);
  assert.equal(stored().source_item_code, 'rakuten:shop:Pen_ABC-1');
  const changed = await call('../src/app/api/items/[id]/route.ts', 'PATCH', `/api/items/${id}`, { url: 'https://item.rakuten.co.jp/shop/new/', current_price: 9000 }, { id: String(id) });
  assert.equal(changed.status, 200);
  assert.equal(stored().source_item_code, null);
  assert.equal(stored().price_fetched_at, null);
  await refreshDueRakutenPrices(database, { ...options, now: () => new Date(NOW + 2 * 86_400_000) });
  assert.equal(requested.length, 1);
  assert.equal(stored().current_price, 9000);
});

test('a URL edit during a price request prevents stale prices and history from being saved', async () => {
  const member = await createMember('code-race');
  const database = await db();
  const id = Number(database.prepare("INSERT INTO items (user_id,name,url,current_price,source_item_code) VALUES (?, 'old', 'https://item.rakuten.co.jp/shop/old/',100,'rakuten:shop:old')").run(member.id).lastInsertRowid);
  await refreshDueRakutenPrices(database, { credentials, limiter, now: () => new Date(NOW), http: async () => {
    const edited = await call('../src/app/api/items/[id]/route.ts', 'PATCH', `/api/items/${id}`, { url: 'https://item.rakuten.co.jp/shop/new/', current_price: 9000 }, { id: String(id) });
    assert.equal(edited.status, 200);
    return response('shop:old', 110);
  } });
  assert.equal((database.prepare('SELECT current_price FROM items WHERE id=?').get(id) as {current_price:number}).current_price, 9000);
  assert.deepEqual(database.prepare('SELECT price FROM price_history WHERE item_id=?').all(id), [{ price: 9000 }]);
});
