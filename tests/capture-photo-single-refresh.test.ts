// 写真から1件だけ登録した商品の価格再取得。
// DNS と HTTPS はここで受け止める。外の Yahoo! には接続しない。
import dnsPromises from 'node:dns/promises';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const refresh = '../src/app/api/items/[id]/refresh/route.ts';
const requested: string[] = [];
const dns = dnsPromises as { lookup: typeof dnsPromises.lookup };
const originalLookup = dns.lookup;
const originalRequest = https.request;
const page = [
  '<title>牛乳</title>',
  '<script type="application/ld+json">{"offers":{"price":"980","priceCurrency":"JPY"}}</script>',
  '<meta property="og:image" content="https://item-shopping.c.yimg.jp/i/g/milk">',
].join('');

function requestHref(urlOrOptions: URL | string | Record<string, unknown>): string {
  if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) return new URL(urlOrOptions).href;
  const opts = urlOrOptions;
  if (typeof opts.href === 'string') return new URL(opts.href).href;
  const headers = (opts.headers || {}) as Record<string, string>;
  const host = headers.Host || headers.host || opts.servername || opts.host || opts.hostname;
  const protocol = typeof opts.protocol === 'string' ? opts.protocol : 'https:';
  const path = typeof opts.path === 'string' ? opts.path : '/';
  return new URL(`${protocol}//${host}${path}`).href;
}

function installShopPage(): () => void {
  dns.lookup = (async () => [{ address: '1.1.1.1', family: 4 }]) as unknown as typeof dns.lookup;
  // requestPinned は options 単体、旧経路は URL + options。どちらでも Host から元 URL を復元する。
  https.request = ((
    urlOrOptions: URL | string | Record<string, unknown>,
    optionsOrCallback?: unknown,
    maybeCallback?: (response: IncomingMessage) => void,
  ) => {
    const callback = (typeof optionsOrCallback === 'function'
      ? optionsOrCallback
      : maybeCallback) as (response: IncomingMessage) => void;
    requested.push(requestHref(urlOrOptions));
    const response = new EventEmitter() as IncomingMessage;
    response.statusCode = 200;
    response.headers = { 'content-type': 'text/html; charset=utf-8' };
    const request = new EventEmitter() as ClientRequest;
    request.end = (() => {
      callback(response);
      response.emit('data', Buffer.from(page));
      response.emit('end');
      return request;
    }) as ClientRequest['end'];
    return request;
  }) as typeof https.request;
  return () => {
    dns.lookup = originalLookup;
    https.request = originalRequest;
  };
}

type StoredItem = {
  name: string;
  url: string;
  current_price: number | null;
  original_price: number | null;
  image_url: string | null;
  source: string;
  source_item_code: string | null;
  comparison_group_id: number | null;
  last_scraped_at: string | null;
  scrape_status: string | null;
  scrape_error: string | null;
  deleted_at?: string | null;
};

test('one photo registration refreshes the page price the same way as a url item', async () => {
  const restore = installShopPage();
  try {
    const { call, createMember, db } = await import('./regression-harness');
    const { priceCheckItems } = await import('../src/lib/price-check-items');
    const member = await createMember('single-photo-refresh');
    const database = await db();
    const groupOf = (name: string) => Number(database.prepare(
      'INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, ?, ?)',
    ).run(member.id, name, 'photo').lastInsertRowid);
    const shops = groupOf('牛乳');
    const loneGroup = groupOf('パン');
    const add = (
      name: string,
      url: string,
      extra: { code?: string | null; groupId?: number | null } = {},
    ) => Number(database.prepare(`
      INSERT INTO items (
        user_id, name, url, current_price, original_price, source, source_name, source_item_code, comparison_group_id
      ) VALUES (?, ?, ?, 1500, 1500, 'yahoo', 'Yahoo!ショッピング', ?, ?)
    `).run(
      member.id,
      name,
      url,
      extra.code === undefined ? null : extra.code,
      extra.groupId === undefined ? null : extra.groupId,
    ).lastInsertRowid);

    const fromUrl = add('URLの牛乳', 'https://store.shopping.yahoo.co.jp/shop/url-milk');
    const fromPhoto = add('写真の牛乳', 'https://store.shopping.yahoo.co.jp/shop/photo-milk', { code: 'yahoo:milk' });
    const left = add('左の店', 'https://store.shopping.yahoo.co.jp/shop/group-a', { code: 'yahoo:a', groupId: shops });
    const right = add('右の店', 'https://store.shopping.yahoo.co.jp/shop/group-b', { code: 'yahoo:b', groupId: shops });
    const lone = add('1店のパン', 'https://store.shopping.yahoo.co.jp/shop/lone-bread', { code: 'yahoo:bread', groupId: loneGroup });

    const stored = (id: number) => database.prepare(`
      SELECT name, url, current_price, original_price, image_url, source, source_item_code, comparison_group_id,
             last_scraped_at, scrape_status, scrape_error, deleted_at
      FROM items WHERE id = ?
    `).get(id) as StoredItem;
    const history = (id: number) => (database.prepare(
      'SELECT price FROM price_history WHERE item_id = ? ORDER BY id',
    ).all(id) as { price: number }[]).map((row) => row.price);
    const beforeGroup = [stored(left), stored(right)];

    const refreshOne = (id: number) => call(refresh, 'POST', `/api/items/${id}/refresh`, undefined, { id: String(id) });
    const urlResponse = await refreshOne(fromUrl);
    const photoResponse = await refreshOne(fromPhoto);
    const loneResponse = await refreshOne(lone);
    const groupResponse = await refreshOne(left);
    const again = await refreshOne(fromPhoto);

    const urlItem = stored(fromUrl);
    const photoItem = stored(fromPhoto);
    const loneItem = stored(lone);
    assert.equal(urlResponse.status, 200);
    assert.equal(photoResponse.status, 200);
    assert.equal(loneResponse.status, 200);
    assert.equal((urlResponse.json as { current_price: number }).current_price, 980);
    assert.equal((photoResponse.json as { current_price: number }).current_price, 980);
    assert.equal((loneResponse.json as { current_price: number }).current_price, 980);
    assert.equal((photoResponse.json as { code?: string }).code, undefined);
    assert.equal(urlItem.name, '牛乳');
    assert.equal(photoItem.name, urlItem.name);
    assert.equal(photoItem.current_price, urlItem.current_price);
    assert.equal(photoItem.original_price, 1500);
    assert.equal(urlItem.original_price, 1500);
    assert.equal(photoItem.image_url, 'https://item-shopping.c.yimg.jp/i/g/milk');
    assert.equal(urlItem.image_url, photoItem.image_url);
    assert.equal(photoItem.scrape_status, 'success');
    assert.equal(urlItem.scrape_status, 'success');
    assert.equal(photoItem.scrape_error, null);
    assert.equal(urlItem.scrape_error, null);
    assert.ok(photoItem.last_scraped_at);
    assert.ok(urlItem.last_scraped_at);
    assert.equal(photoItem.source, 'yahoo');
    assert.equal(photoItem.source_item_code, 'yahoo:milk');
    assert.equal(photoItem.comparison_group_id, null);
    assert.deepEqual(history(fromUrl), [980]);
    assert.deepEqual(history(fromPhoto), [980]);
    assert.equal(again.status, 200);
    assert.deepEqual(history(fromPhoto), [980]);
    assert.equal(loneItem.current_price, 980);
    assert.equal(loneItem.source_item_code, 'yahoo:bread');
    assert.deepEqual(history(lone), [980]);

    assert.equal(groupResponse.status, 409);
    assert.deepEqual(groupResponse.json, {
      error: '写真から登録した商品は価格の再取得をしません',
      code: 'PHOTO_PRICE_EXCLUDED',
    });
    assert.deepEqual([stored(left), stored(right)], beforeGroup);
    assert.deepEqual(history(left), []);
    assert.deepEqual(history(right), []);

    database.prepare("UPDATE items SET deleted_at = '2026-01-01 00:00:00' WHERE id = ?").run(right);
    const opened = await refreshOne(left);
    assert.equal(opened.status, 200);
    assert.equal(stored(left).current_price, 980);
    assert.equal(stored(left).source_item_code, 'yahoo:a');
    assert.equal(stored(right).current_price, 1500);
    assert.equal(stored(right).deleted_at, '2026-01-01 00:00:00');
    assert.deepEqual(history(left), [980]);
    assert.deepEqual(history(right), []);

    const urls = requested.map((href) => new URL(href).pathname);
    assert.deepEqual(urls.sort(), [
      '/shop/group-a',
      '/shop/lone-bread',
      '/shop/photo-milk',
      '/shop/photo-milk',
      '/shop/url-milk',
    ]);

    const checked = (priceCheckItems(database) as { id: number }[]).map((row) => row.id);
    assert.equal(checked.includes(fromUrl), true);
    assert.equal(checked.includes(fromPhoto), false);
    assert.equal(checked.includes(lone), false);
    assert.equal(checked.includes(left), false);
    assert.equal(checked.includes(right), false);
  } finally {
    restore();
  }
});
