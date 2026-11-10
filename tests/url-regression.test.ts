import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { CurrentUser } from '../src/lib/auth';

const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-url-regression-'));
process.env.BUTUYOKUOH_DB_PATH = join(directory, 'app.sqlite');
process.env.JWT_SECRET = 'url-regression-jwt-secret';
process.env.AUTH_SECRET = 'url-regression-auth-secret';
process.env.NEXTAUTH_SECRET = 'url-regression-auth-secret';
process.env.GUEST_MODE_ENABLED = 'true';
process.env.AUTH_URL = 'http://127.0.0.1:3000';
process.env.GUEST_SCRAPES_PER_MINUTE = '1000';
process.env.GUEST_GLOBAL_SCRAPES_PER_MINUTE = '1000';
process.env.GUEST_WRITES_PER_MINUTE = '1000';
delete process.env.E2E_PRODUCT_FIXTURES;

const origin = 'http://127.0.0.1:3000';

function bodyOf(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.ok(value);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

async function call(modulePath: string, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const { NextRequest } = await import('next/server');
  const loaded = await import(modulePath) as Record<string, (
    request: InstanceType<typeof NextRequest>,
    context?: { params: Promise<Record<string, string>> },
  ) => Promise<Response>>;
  const request = new NextRequest(`${origin}${path}`, {
    method,
    headers: {
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await loaded[method](request, params ? { params: Promise.resolve(params) } : undefined);
  const text = await response.text();
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    text,
    json: type.includes('json') && text ? JSON.parse(text) as unknown : undefined,
  };
}

test('production does not install product fetch fixtures', () => {
  const script = join(directory, 'production-check.mjs');
  writeFileSync(script, `
    process.env.NODE_ENV = 'production';
    process.env.E2E_PRODUCT_FIXTURES = '1';
    const port = await import(${JSON.stringify(join(process.cwd(), 'src/lib/product-fetch-port.ts'))});
    if (port.productFetchDeps() !== undefined) process.exit(2);
    let message = '';
    try { port.installProductFetchPort({ lookup() { return undefined; } }); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    if (!message.includes('unavailable')) process.exit(3);
    if (port.productFetchDeps() !== undefined) process.exit(4);
  `);
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('fixed shop fixtures register, refresh and fail for guests and members without a shop connection', async () => {
  const fixtures = await import('../src/lib/product-regression-fixtures');
  const port = await import('../src/lib/product-fetch-port');
  const { getDb } = await import('../src/lib/db');
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { startGuest } = await import('../src/lib/guest');
  const database = getDb();
  const preview = '../src/app/api/items/preview/route.ts';
  const items = '../src/app/api/items/route.ts';
  const itemRoute = '../src/app/api/items/[id]/route.ts';
  const refresh = '../src/app/api/items/[id]/refresh/route.ts';
  const help = '手動で追加';
  const genericHelp = '商品情報を自動取得できませんでした';
  const blockedHelp = '自動での商品情報取得を制限';

  port.installProductFetchPort(fixtures.regressionFetchPort());
  installAuthTestHooks({ user: null });
  try {
    assert.notEqual(port.productFetchDeps(), undefined);
    const privatePreview = await call(preview, 'POST', '/api/items/preview', { url: 'http://127.0.0.1/secret' });
    assert.equal(privatePreview.status, 401);

    const guest = startGuest(undefined, database);
    installAuthTestHooks({ user: guest.user });
    const denied = await call(preview, 'POST', '/api/items/preview', { url: 'http://127.0.0.1/secret' });
    assert.equal(denied.status, 400, denied.text);

    const tsukumo = 'https://shop.tsukumo.co.jp/goods/4981254057384/';
    const tsukumoImage = 'https://cdn.tsukumo.co.jp/image/item/4981254057384_1.jpg';
    const imageOnly = await call(items, 'POST', '/api/items', { url: tsukumo });
    assert.equal(imageOnly.status, 201, imageOnly.text);
    const partial = bodyOf(imageOnly.json);
    assert.equal(partial.image_url, tsukumoImage);
    assert.equal(partial.url, tsukumo);
    assert.equal(partial.current_price, null);
    assert.match(String(partial.name), /4981254057384/);
    database.prepare('UPDATE items SET name = ?, current_price = ?, image_url = NULL WHERE id = ?')
      .run('CANVIO DESKTOP HD-TDA4U3-B', 24981, partial.id);
    const photoRecovered = await call(refresh, 'POST', `/api/items/${partial.id}/refresh`, undefined, { id: String(partial.id) });
    assert.equal(photoRecovered.status, 200, photoRecovered.text);
    assert.equal(bodyOf(photoRecovered.json).image_url, tsukumoImage);
    assert.equal(bodyOf(photoRecovered.json).name, 'CANVIO DESKTOP HD-TDA4U3-B');
    assert.equal(bodyOf(photoRecovered.json).current_price, 24981);
    const editedImage = 'https://cdn.example.com/my-hdd.jpg';
    database.prepare('UPDATE items SET image_url = ? WHERE id = ?').run(editedImage, partial.id);
    const withExistingImage = await call(refresh, 'POST', `/api/items/${partial.id}/refresh`, undefined, { id: String(partial.id) });
    assert.equal(withExistingImage.status, 200, withExistingImage.text);
    const refreshed = bodyOf(withExistingImage.json);
    assert.equal(refreshed.name, 'CANVIO DESKTOP HD-TDA4U3-B');
    assert.equal(refreshed.image_url, editedImage);
    assert.match(String(refreshed.note), /商品名と価格は取得できませんでした/);
    assert.equal(refreshed.scrape_error, refreshed.note);
    assert.doesNotMatch(String(refreshed.note), /商品番号で表示/);
    // 商品名と価格は更新できても、ページに写真がなければ編集済みの画像を維持する。
    port.installProductFetchPort({ lookup(target) {
      if (target.href !== tsukumo) return fixtures.regressionLookup(target);
      return { status: 200, contentType: 'text/html', body: Buffer.from('<title>CANVIO HDD</title><p>販売価格: 24,000円</p>') };
    } });
    const fromPage = await call(refresh, 'POST', `/api/items/${partial.id}/refresh`, undefined, { id: String(partial.id) });
    assert.equal(fromPage.status, 200, fromPage.text);
    const details = bodyOf(fromPage.json);
    assert.equal(details.name, 'CANVIO HDD');
    assert.equal(details.current_price, 24000);
    assert.equal(details.image_url, editedImage);
    port.installProductFetchPort(fixtures.regressionFetchPort());
    // A missing CDN image never turns a failed page into a saved item.
    const unavailable = await call(preview, 'POST', '/api/items/preview', { url: 'https://shop.tsukumo.co.jp/goods/0406621759011/' });
    assert.ok(unavailable.status >= 400, unavailable.text);

    const pitaka = await call(preview, 'POST', '/api/items/preview', { url: fixtures.PITAKA_URL });
    assert.equal(pitaka.status, 200, pitaka.text);
    assert.deepEqual(bodyOf(pitaka.json), {
      ...bodyOf(pitaka.json),
      name: fixtures.PITAKA_NAME,
      price: fixtures.PITAKA_PRICE,
      image_url: fixtures.PITAKA_IMAGE,
    });
    const added = await call(items, 'POST', '/api/items', {
      url: fixtures.PITAKA_URL, notes: 'ゲストのメモ', priority: 2, quantity: 2, planned_purchase_date: '2026-11-01',
    });
    assert.equal(added.status, 201, added.text);
    const addedBody = bodyOf(added.json);
    assert.equal(addedBody.name, fixtures.PITAKA_NAME);
    assert.equal(addedBody.current_price, fixtures.PITAKA_PRICE);
    assert.equal(addedBody.image_url, fixtures.PITAKA_IMAGE);
    const addedId = Number(addedBody.id);
    database.prepare('UPDATE items SET name = ?, current_price = NULL, image_url = NULL WHERE id = ?').run('価格も画像もない', addedId);
    const recovered = await call(refresh, 'POST', `/api/items/${addedId}/refresh`, undefined, { id: String(addedId) });
    assert.equal(recovered.status, 200, recovered.text);
    const recoveredRow = database.prepare('SELECT name, current_price, image_url FROM items WHERE id = ?').get(addedId) as {
      name: string; current_price: number; image_url: string;
    };
    assert.equal(recoveredRow.name, fixtures.PITAKA_NAME);
    assert.equal(recoveredRow.current_price, fixtures.PITAKA_PRICE);
    assert.equal(recoveredRow.image_url, fixtures.PITAKA_IMAGE);
    const edited = await call(itemRoute, 'PATCH', `/api/items/${addedId}`, { name: '編集後のグリップ' }, { id: String(addedId) });
    assert.equal(edited.status, 200, edited.text);
    const kept = database.prepare('SELECT name, image_url, notes FROM items WHERE id = ?').get(addedId) as {
      name: string; image_url: string; notes: string;
    };
    assert.equal(kept.name, '編集後のグリップ');
    assert.equal(kept.image_url, fixtures.PITAKA_IMAGE);
    assert.equal(kept.notes, 'ゲストのメモ');

    const noPrice = await call(items, 'POST', '/api/items', { url: fixtures.AMAZON_NO_PRICE_URL });
    assert.equal(noPrice.status, 201, noPrice.text);
    const noPriceBody = bodyOf(noPrice.json);
    assert.equal(noPriceBody.name, fixtures.AMAZON_NO_PRICE_NAME);
    assert.equal(noPriceBody.current_price, null);
    assert.equal(noPriceBody.image_url, fixtures.AMAZON_IMAGE);
    assert.equal(noPriceBody.current_price === 2599, false);
    assert.match(String(noPriceBody.scrapeNote), /編集/);

    const short = await call(preview, 'POST', '/api/items/preview', { url: fixtures.AMAZON_SHORT_URL });
    assert.equal(short.status, 200, short.text);
    assert.equal(bodyOf(short.json).name, fixtures.AMAZON_NAME);
    assert.equal(bodyOf(short.json).price, fixtures.AMAZON_PRICE);
    assert.equal(bodyOf(short.json).image_url, fixtures.AMAZON_IMAGE);

    const rakuten = await call(items, 'POST', '/api/items', { url: fixtures.RAKUTEN_URL });
    assert.equal(rakuten.status, 201, rakuten.text);
    const rakutenId = Number(bodyOf(rakuten.json).id);
    assert.equal(bodyOf(rakuten.json).name, fixtures.RAKUTEN_NAME);
    assert.equal(bodyOf(rakuten.json).current_price, fixtures.RAKUTEN_PRICE);
    assert.equal(bodyOf(rakuten.json).image_url, fixtures.RAKUTEN_IMAGE);
    database.prepare('UPDATE items SET name = ? WHERE id = ?').run('文字化け再現', rakutenId);
    const restored = await call(refresh, 'POST', `/api/items/${rakutenId}/refresh`, undefined, { id: String(rakutenId) });
    assert.equal(restored.status, 200, restored.text);
    const restoredRow = database.prepare('SELECT name, current_price, image_url FROM items WHERE id = ?').get(rakutenId) as {
      name: string; current_price: number; image_url: string;
    };
    assert.equal(restoredRow.name, fixtures.RAKUTEN_NAME);
    assert.equal(restoredRow.current_price, fixtures.RAKUTEN_PRICE);
    assert.equal(restoredRow.image_url, fixtures.RAKUTEN_IMAGE);

    const beforeFail = database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(guest.user.id) as { n: number };
    for (const url of [fixtures.FAIL_URL, fixtures.EMPTY_URL, fixtures.BOT_URL]) {
      const response = await call(preview, 'POST', '/api/items/preview', { url });
      assert.notEqual(response.status, 200, `${url} ${response.text}`);
      const payload = bodyOf(response.json);
      assert.equal(payload.code, 'SCRAPE_FAILED', response.text);
      assert.match(String(payload.error), new RegExp(help));
      assert.doesNotMatch(String(payload.error), /大きすぎ|MiB/);
      if (url === fixtures.BOT_URL) {
        assert.match(String(payload.error), new RegExp(blockedHelp));
      } else {
        assert.match(String(payload.error), new RegExp(genericHelp));
      }
      const saved = await call(items, 'POST', '/api/items', { url, notes: '残すメモ' });
      assert.notEqual(saved.status, 201, `${url} ${saved.text}`);
    }
    const timedOut = await call(preview, 'POST', '/api/items/preview', { url: fixtures.TIMEOUT_URL });
    assert.equal(timedOut.status, 504, timedOut.text);
    assert.equal(bodyOf(timedOut.json).code, 'SCRAPE_FAILED');
    assert.match(String(bodyOf(timedOut.json).error), /再試行/);
    assert.notEqual((await call(items, 'POST', '/api/items', { url: fixtures.TIMEOUT_URL })).status, 201);
    const afterFail = database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(guest.user.id) as { n: number };
    assert.equal(afterFail.n, beforeFail.n);

    const preservedId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source)
      VALUES (?, '残す商品', ?, 'https://cdn.example.com/keep.webp', 1200, 1200, 'other')
    `).run(guest.user.id, fixtures.FAIL_URL).lastInsertRowid);
    database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 1200)').run(preservedId);
    const failedRefresh = await call(refresh, 'POST', `/api/items/${preservedId}/refresh`, undefined, { id: String(preservedId) });
    assert.notEqual(failedRefresh.status, 200, failedRefresh.text);
    const preserved = database.prepare('SELECT name, current_price, image_url FROM items WHERE id = ?').get(preservedId) as {
      name: string; current_price: number; image_url: string;
    };
    assert.equal(preserved.name, '残す商品');
    assert.equal(preserved.current_price, 1200);
    assert.equal(preserved.image_url, 'https://cdn.example.com/keep.webp');
    const history = database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(preservedId) as { n: number };
    assert.equal(history.n, 1);

    database.prepare('INSERT OR REPLACE INTO guest_rate_limits VALUES (?, 1000, ?)').run(`scrape:${guest.user.id}`, Date.now() + 60_000);
    const limited = await call(preview, 'POST', '/api/items/preview', { url: fixtures.PITAKA_URL });
    assert.equal(limited.status, 429, limited.text);

    const memberId = Number(database.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('member-url@example.test', 'member').lastInsertRowid);
    const member = database.prepare('SELECT id, email, name, created_at, account_type FROM users WHERE id = ?').get(memberId) as CurrentUser;
    installAuthTestHooks({ user: member });
    const memberRakuten = await call(preview, 'POST', '/api/items/preview', { url: fixtures.RAKUTEN_URL });
    assert.equal(memberRakuten.status, 200, memberRakuten.text);
    assert.equal(bodyOf(memberRakuten.json).name, fixtures.RAKUTEN_NAME);
    assert.equal(bodyOf(memberRakuten.json).price, fixtures.RAKUTEN_PRICE);
    const memberAdded = await call(items, 'POST', '/api/items', { url: fixtures.AMAZON_SHORT_URL });
    assert.equal(memberAdded.status, 201, memberAdded.text);
    assert.equal(bodyOf(memberAdded.json).name, fixtures.AMAZON_NAME);
    assert.equal(bodyOf(memberAdded.json).current_price, fixtures.AMAZON_PRICE);
    const memberFail = await call(items, 'POST', '/api/items', { url: fixtures.EMPTY_URL });
    assert.equal(memberFail.status, 422, memberFail.text);
    assert.equal(bodyOf(memberFail.json).code, 'SCRAPE_FAILED');
    assert.equal(database.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(member.id, fixtures.EMPTY_URL), undefined);
    const memberTsukumo = await call(preview, 'POST', '/api/items/preview', { url: tsukumo });
    assert.equal(memberTsukumo.status, 200, memberTsukumo.text);
    assert.equal(bodyOf(memberTsukumo.json).image_url, tsukumoImage);
    assert.equal(bodyOf(memberTsukumo.json).price, null);
    const deadShort = 'https://amzn.asia/d/expand-fail';
    const deadPreview = await call(preview, 'POST', '/api/items/preview', { url: deadShort });
    assert.equal(deadPreview.status, 422, deadPreview.text);
    assert.equal(bodyOf(deadPreview.json).code, 'SCRAPE_FAILED');
    assert.match(String(bodyOf(deadPreview.json).error), new RegExp(help));
    assert.equal(bodyOf(deadPreview.json).name, undefined);
    const deadAdd = await call(items, 'POST', '/api/items', { url: deadShort, notes: '残すメモ' });
    assert.equal(deadAdd.status, 422, deadAdd.text);
    assert.equal(database.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(member.id, deadShort), undefined);
    const memberKeptId = Number(database.prepare(`
      INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source)
      VALUES (?, '会員の残す商品', ?, 'https://cdn.example.com/member.webp', 800, 800, 'amazon')
    `).run(member.id, fixtures.FAIL_URL).lastInsertRowid);
    database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 800)').run(memberKeptId);
    const memberRefresh = await call(refresh, 'POST', `/api/items/${memberKeptId}/refresh`, undefined, { id: String(memberKeptId) });
    assert.equal(memberRefresh.status, 200, memberRefresh.text);
    const memberKept = database.prepare('SELECT name, current_price, image_url, scrape_status FROM items WHERE id = ?').get(memberKeptId) as {
      name: string; current_price: number; image_url: string; scrape_status: string;
    };
    assert.equal(memberKept.name, '会員の残す商品');
    assert.equal(memberKept.current_price, 800);
    assert.equal(memberKept.image_url, 'https://cdn.example.com/member.webp');
    assert.equal(memberKept.scrape_status, 'failed');
    assert.equal((database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(memberKeptId) as { n: number }).n, 1);
    const relative = await call(preview, 'POST', '/api/items/preview', { url: fixtures.RELATIVE_IMAGE_URL });
    assert.equal(relative.status, 200, relative.text);
    assert.equal(bodyOf(relative.json).image_url, 'https://cdn.example.com/a.webp');

    installAuthTestHooks({ user: null });
    const anonymous = await call(preview, 'POST', '/api/items/preview', { url: fixtures.PITAKA_URL });
    assert.equal(anonymous.status, 401, anonymous.text);
  } finally {
    port.installProductFetchPort(null);
    installAuthTestHooks(null);
  }
});

test('member registration uses the redirected Tsukumo product number for catalog photos', async () => {
  const { scrapeUrl } = await import('../src/lib/scraper');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const original = 'https://shop.tsukumo.co.jp/goods/4981254057384/';
  const destination = 'https://shop.tsukumo.co.jp/goods/0406621759011/';
  const destinationImage = 'https://cdn.tsukumo.co.jp/image/item/0406621759011_1.jpg';
  let pageStatus = 200;
  const requests: string[] = [];
  installProductFetchPort({ lookup(target) {
    requests.push(target.href);
    if (target.href === original) return { status: 301, location: destination };
    if (target.href === destination) {
      return { status: pageStatus, contentType: 'text/html', body: Buffer.from('<title>Monitor-B｜ツクモ公式通販サイト</title><p>販売価格: 10,000円</p>') };
    }
    return { status: 200, contentType: 'image/jpeg' };
  } });
  try {
    for (pageStatus of [200, 503]) {
      requests.length = 0;
      const item = await scrapeUrl(original);
      assert.equal(item.name, pageStatus === 200 ? 'Monitor-B' : 'ツクモの商品（0406621759011）');
      assert.equal(item.price, pageStatus === 200 ? 10000 : null);
      assert.equal(item.imageUrl, destinationImage);
      assert.deepEqual(requests, [original, destination, destinationImage]);
    }
  } finally { installProductFetchPort(null); }
});

test('price-only checks fetch the Tsukumo page without probing the image CDN', async () => {
  const { scrapeUrl } = await import('../src/lib/scraper');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const url = 'https://shop.tsukumo.co.jp/goods/4981254057384/';
  const requests: string[] = [];
  let status = 200;
  installProductFetchPort({
    lookup(target) {
      requests.push(target.href);
      return { status, contentType: 'text/html', body: Buffer.from('<title>HDD</title><p>販売価格: 24,981円</p>') };
    },
  });
  try {
    for (status of [200, 503]) {
      requests.length = 0;
      const result = await scrapeUrl(url, undefined, 'price');
      assert.equal(result.price, status === 200 ? 24981 : null);
      assert.deepEqual(requests, [url]);
    }
  } finally { installProductFetchPort(null); }
});

test('Tsukumo photo recovery only accepts a JPEG from the matching official product path', async () => {
  const { recoverTsukumoImage } = await import('../src/lib/tsukumo-image');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const url = 'https://shop.tsukumo.co.jp/goods/4981254057384/';
  const image = 'https://cdn.tsukumo.co.jp/image/item/4981254057384_1.jpg';
  const lookups: string[] = [];
  let response = { status: 200, contentType: 'image/jpeg' };
  installProductFetchPort({ lookup(candidate) { lookups.push(candidate.href); return response; } });
  try {
    const item = { name: 'CANVIO DESKTOP HD-TDA4U3-B', price: 24981, imageUrl: null, source: 'other', sourceName: 'ツクモ' };
    for (const invalid of ['https://example.com/goods/4981254057384/', url + 'related/', url.replace('https:', 'http:')]) {
      assert.equal(await recoverTsukumoImage(invalid), null);
    }
    assert.equal(await recoverTsukumoImage(url, { ...item, imageUrl: image }), null);
    assert.deepEqual(lookups, []);
    assert.deepEqual(await recoverTsukumoImage(url, item), { ...item, imageUrl: image, imageIsFallback: true });
    for (response of [{ status: 200, contentType: 'text/html' }, { status: 302, contentType: 'image/jpeg' }, { status: 404, contentType: 'image/jpeg' }]) {
      assert.equal(await recoverTsukumoImage(url), null);
    }
    assert.deepEqual([...new Set(lookups)], [image]);
  } finally {
    installProductFetchPort(null);
  }
});
