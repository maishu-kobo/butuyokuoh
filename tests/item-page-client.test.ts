import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ItemPageClient, itemPageKey, type ItemPage } from '../src/lib/item-page-client';
import type { HomeListQuery } from '../src/lib/home-wishlist';
import type { Item } from '../src/types';

const query: HomeListQuery = { selectedCategory: null, selectedPriority: null, selectedGroup: null, searchQuery: '', sortBy: 'priority' };
function page(ids: number[], overrides: Partial<ItemPage> = {}): ItemPage {
  return { items: ids.map(id => ({ id } as Item)), revision: 'revision-a', totalCount: 500, matchedCount: 500,
    rowCount: 500, totalAmount: 50000, lowestPriceInGroup: null, matchedIds: Array.from({ length: 500 }, (_, i) => i + 1),
    allIds: Array.from({ length: 500 }, (_, i) => i + 1), nextCursor: 'second', ...overrides };
}
function requests() {
  const pending: { url: URL; signal: AbortSignal; resolve: (response: Response) => void; reject: (reason: Error) => void }[] = [];
  const client = new ItemPageClient((url, signal) => new Promise<Response>((resolve, reject) => {
    pending.push({ url: new URL(url, 'http://test.invalid'), signal, resolve, reject });
  }));
  return { client, pending };
}

test('changed filters and accounts reject late responses even if transport ignores abort', async () => {
  const { client, pending } = requests();
  const first = client.open(query, 1);
  const filtered = { ...query, searchQuery: '最後の商品', sortBy: 'price_desc' as const, selectedCategory: 4, selectedPriority: 2, selectedGroup: 7 };
  const second = client.open(filtered, 2);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(client.getSnapshot().page, null);
  assert.equal(pending[1].url.searchParams.get('q'), '最後の商品');
  assert.equal(pending[1].url.searchParams.get('sort'), 'price_desc');
  assert.equal(pending[1].url.searchParams.get('category'), '4');
  assert.equal(pending[1].url.searchParams.get('priority'), '2');
  assert.equal(pending[1].url.searchParams.get('group'), '7');
  assert.equal(pending[1].url.searchParams.has('cursor'), false);
  pending[1].resolve(Response.json(page([500], { revision: 'filtered', matchedCount: 1, matchedIds: [500], nextCursor: null })));
  await second;
  pending[0].resolve(Response.json(page([1])));
  await first;
  assert.equal(client.getSnapshot().key, itemPageKey(filtered, 2));
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [500]);
  assert.equal(client.getSnapshot().loading, false);
});

test('duplicate more clicks issue one request; failed append retains rows and retries the same cursor', async () => {
  const { client, pending } = requests();
  const first = client.open(query, 1);
  pending[0].resolve(Response.json(page([1, 2]))); await first;
  const more = client.more();
  await client.more();
  assert.equal(pending.length, 2);
  assert.equal(client.getSnapshot().moreLoading, true);
  assert.equal(pending[1].url.searchParams.get('cursor'), 'second');
  pending[1].reject(new Error('offline')); await more;
  assert.equal(client.getSnapshot().moreError, true);
  assert.equal(client.getSnapshot().error, false);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2]);
  const retry = client.more();
  assert.equal(pending[2].url.searchParams.get('cursor'), 'second');
  pending[2].resolve(Response.json(page([3, 4], { nextCursor: null }))); await retry;
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2, 3, 4]);
  assert.equal(client.getSnapshot().page?.matchedIds.length, 500);
  assert.equal(client.getSnapshot().moreError, false);
  await client.more();
  assert.equal(pending.length, 3);
});

test('a stale cursor reloads the first page and explains the restart without mixing snapshots', async () => {
  const { client, pending } = requests();
  const first = client.open(query, 1);
  pending[0].resolve(Response.json(page([1]))); await first;
  const more = client.more();
  pending[1].resolve(Response.json({ code: 'LIST_CHANGED' }, { status: 409 }));
  // Flush the response continuation; reload is started synchronously before it awaits transport.
  await Promise.resolve();
  assert.equal(pending.length, 3);
  assert.equal(pending[2].url.searchParams.has('cursor'), false);
  assert.equal(client.getSnapshot().page, null);
  pending[2].resolve(Response.json(page([9], { revision: 'revision-b', nextCursor: null }))); await more;
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [9]);
  assert.match(client.getSnapshot().notice, /先頭から読み込み直しました/);
});

test('malformed initial pages can retry; duplicate IDs and revision changes never corrupt an append', async () => {
  const { client, pending } = requests();
  const first = client.open(query, 1);
  pending[0].resolve(Response.json({ items: [] })); await first;
  assert.equal(client.getSnapshot().error, true);
  assert.equal(client.getSnapshot().page, null);
  const retry = client.reload();
  pending[1].resolve(Response.json(page([1, 2]))); await retry;
  for (const invalid of [page([2, 3]), page([3], { revision: 'changed' })]) {
    const more = client.more();
    pending.at(-1)!.resolve(Response.json(invalid)); await more;
    assert.equal(client.getSnapshot().moreError, true);
    assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2]);
  }
});

test('cancelled requests and late failures cannot overwrite a successful replacement', async () => {
  const { client, pending } = requests();
  const cancelled = client.open(query, 1);
  client.cancel();
  assert.equal(pending[0].signal.aborted, true);
  const replacement = client.open({ ...query, searchQuery: 'none' }, 1);
  pending[1].resolve(Response.json(page([], { matchedCount: 0, matchedIds: [], nextCursor: null }))); await replacement;
  pending[0].reject(new Error('late failure')); await cancelled;
  assert.equal(client.getSnapshot().error, false);
  assert.equal(client.getSnapshot().loading, false);
  assert.deepEqual(client.getSnapshot().page?.items, []);
  assert.equal(client.getSnapshot().page?.totalCount, 500);
});


test('refresh keeps existing rows mounted until replacement, while a changed query clears them', async () => {
  const { client, pending } = requests();
  const first = client.open(query, 1);
  pending[0].resolve(Response.json(page([1, 2, 3]))); await first;
  const reload = client.reload();
  assert.equal(client.getSnapshot().loading, true);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2, 3]);
  await client.more();
  assert.equal(pending.length, 2);
  pending[1].resolve(Response.json(page([1, 3], { revision: 'after-delete' }))); await reload;
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 3]);
  const changed = client.open({ ...query, searchQuery: 'new' }, 1);
  assert.equal(client.getSnapshot().page, null);
  pending[2].resolve(Response.json(page([7], { revision: 'query-changed', nextCursor: null }))); await changed;
});
