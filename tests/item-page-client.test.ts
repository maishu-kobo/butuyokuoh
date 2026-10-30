import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ItemPageClient, itemPageKey, selectedItemPageIds, type ItemPage } from '../src/lib/item-page-client';
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

test('a stale cursor refreshes the visible window without mixing snapshots', async () => {
  const { client, pending } = requests();
  const first = client.open(query, 1);
  pending[0].resolve(Response.json(page([1]))); await first;
  const more = client.more();
  pending[1].resolve(Response.json({ code: 'LIST_CHANGED' }, { status: 409 }));
  // Flush the response continuation; reload is started synchronously before it awaits transport.
  await Promise.resolve();
  assert.equal(pending.length, 3);
  assert.equal(pending[2].url.searchParams.has('cursor'), false);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1]);
  pending[2].resolve(Response.json(page([9], { revision: 'revision-b', nextCursor: null }))); await more;
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [9]);
  assert.match(client.getSnapshot().notice, /読み込み済みの範囲を更新/);
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


test('refresh and same-account queries keep existing rows mounted until replacement', async () => {
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
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 3]);
  pending[2].resolve(Response.json(page([7], { revision: 'query-changed', nextCursor: null }))); await changed;
});

test('same-account query changes retain the visible rows and counts until the new result arrives', async () => {
  const { client, pending } = requests();
  const initial = client.open(query, 1);
  pending[0].resolve(Response.json(page([1, 2]))); await initial;
  const changed = client.open({ ...query, searchQuery: 'new' }, 1);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2]);
  assert.equal(client.getSnapshot().page?.totalCount, 500);
  assert.equal(client.getSnapshot().loading, true);
  pending[1].resolve(Response.json(page([9], { nextCursor: null }))); await changed;
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [9]);
  const account = client.open(query, 2);
  assert.equal(client.getSnapshot().page, null);
  pending[2].resolve(Response.json(page([20]))); await account;
});

test('reload atomically restores every previously loaded page after an edit', async () => {
  const { client, pending } = requests();
  const initial = client.open(query, 1);
  pending[0].resolve(Response.json(page([1]))); await initial;
  const second = client.more();
  pending[1].resolve(Response.json(page([2], { nextCursor: 'third' }))); await second;
  const third = client.more();
  pending[2].resolve(Response.json(page([3], { nextCursor: null }))); await third;
  const reloaded = client.reload();
  pending[3].resolve(Response.json(page([1], { revision: 'edited' })));
  // Drain transport + Response.json continuations, without a clock-dependent sleep.
  for (let i = 0; i < 20 && pending.length < 5; i++) await Promise.resolve();
  assert.equal(pending.length, 5);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2, 3]);
  pending[4].resolve(Response.json(page([2], { revision: 'edited', nextCursor: 'third' })));
  for (let i = 0; i < 20 && pending.length < 6; i++) await Promise.resolve();
  assert.equal(pending.length, 6);
  pending[5].resolve(Response.json(page([4], { revision: 'edited', nextCursor: null })));
  await reloaded;
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2, 4]);
});


test('selection survives data revisions but excludes deleted IDs and other query/account scopes', () => {
  const key = itemPageKey(query, 1);
  const selection = { key, ids: new Set([1, 2, 3]) };
  assert.deepEqual([...selectedItemPageIds(selection, key, page([1], { revision: 'after-edit', matchedIds: [1, 3] }))], [1, 3]);
  assert.equal(selectedItemPageIds(selection, itemPageKey(query, 2), page([1])).size, 0);
  assert.equal(selectedItemPageIds(selection, itemPageKey({ ...query, searchQuery: 'other' }, 1), page([1])).size, 0);
});


test('a repeated conflict during multi-page reload is bounded and keeps the previous window', async () => {
  let call = 0;
  const client = new ItemPageClient(async () => {
    call++;
    if (call === 1) return Response.json(page([1]));
    if (call === 2) return Response.json(page([2], { nextCursor: null }));
    if (call === 3 || call === 5) return Response.json(page([8], { revision: 'fresh-' + call }));
    return Response.json({ code: 'LIST_CHANGED' }, { status: 409 });
  });
  await client.open(query, 1); await client.more();
  await client.reload();
  assert.equal(call, 6);
  assert.equal(client.getSnapshot().error, true);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1, 2]);
});

test('multi-page refresh stops when the result shrinks and does not request an absent cursor', async () => {
  let call = 0;
  const client = new ItemPageClient(async () => Response.json(++call === 1
    ? page([1]) : call === 2 ? page([2], { nextCursor: null })
      : page([1], { revision: 'after-delete', nextCursor: null })));
  await client.open(query, 1); await client.more(); await client.reload();
  assert.equal(call, 3);
  assert.deepEqual(client.getSnapshot().page?.items.map(item => item.id), [1]);
  assert.equal(client.getSnapshot().loading, false);
});
