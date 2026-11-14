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
  // Amazon ボット失敗は「編集」、その他の取得失敗は「手動で追加」へ案内する（#408）
  const help = '手動で追加|「編集」から入力';
  const genericHelp = '商品情報を自動取得できませんでした';
  const blockedHelp = 'Amazon側|ゲスト体験に限った制限ではありません|販売サイトが、サーバーからの';

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
    // 商品名しか保存されておらずページを取得できないため、写真の同一性は確認できない。
    assert.equal(bodyOf(photoRecovered.json).image_url, null);
    assert.match(String(bodyOf(photoRecovered.json).note), /同じ商品/);
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
  let redirectTo = destination;
  let pageStatus = 200;
  const requests: string[] = [];
  installProductFetchPort({ lookup(target) {
    requests.push(target.href);
    if (target.href === original) return { status: 301, location: redirectTo };
    if (target.href === redirectTo) {
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
    for (redirectTo of ['https://other.example/goods/0406621759011/', 'https://shop.tsukumo.co.jp/search/']) {
      for (pageStatus of [200, 503]) {
        requests.length = 0;
        const item = await scrapeUrl(original);
        assert.equal(item.imageUrl, null);
        assert.deepEqual(requests, [original, redirectTo]);
      }
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

// #374 / PR #376 のレビュー指摘: 転送後に取得できなかったとき、元の商品の公式画像で登録しない。
// 画像の補完は「最後に検証して接続した URL」を基準にする。
const REDIRECT_SOURCE = 'https://shop.tsukumo.co.jp/goods/4981254057384/';
const REDIRECT_SOURCE_IMAGE = 'https://cdn.tsukumo.co.jp/image/item/4981254057384_1.jpg';
const REDIRECT_PRODUCT = 'https://shop.tsukumo.co.jp/goods/0406621759011/';
const REDIRECT_PRODUCT_IMAGE = 'https://cdn.tsukumo.co.jp/image/item/0406621759011_1.jpg';
const REDIRECT_NON_PRODUCTS = [
  'https://other.example/goods/0406621759011/',
  'https://shop.tsukumo.co.jp/search/',
  'http://shop.tsukumo.co.jp/goods/0406621759011/',
];

// 入力は必ず転送する。転送先は失敗し、公式 CDN は両方の商品の画像を返す。
function redirectFailurePort(state: { destination: string; failure: 'status' | 'exception' }, requests: string[]) {
  return {
    lookup(target: URL) {
      requests.push(target.href);
      if (target.href === REDIRECT_SOURCE) return { status: 301, location: state.destination };
      if (target.href === state.destination) {
        if (state.failure === 'exception') throw new Error('socket hang up');
        return { status: 503 };
      }
      if (target.hostname === 'cdn.tsukumo.co.jp') return { status: 200, contentType: 'image/jpeg' };
      return undefined;
    },
  };
}

test('guest registration never saves the original Tsukumo photo after a redirect whose destination fails (#374)', async () => {
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const { getDb } = await import('../src/lib/db');
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { startGuest } = await import('../src/lib/guest');
  const database = getDb();
  const items = '../src/app/api/items/route.ts';
  const requests: string[] = [];
  const state = { destination: REDIRECT_PRODUCT, failure: 'status' as const };
  const guest = startGuest(undefined, database);
  // ゲストには見本の品目が最初から入っているので、URL から登録した行だけを見る。
  const saved = () => database.prepare("SELECT name, url, image_url FROM items WHERE user_id = ? AND url LIKE 'http%'")
    .all(guest.user.id).map(row => ({ ...(row as { name: string; url: string; image_url: string | null }) }));
  installProductFetchPort(redirectFailurePort(state, requests));
  installAuthTestHooks({ user: guest.user });
  try {
    for (const destination of REDIRECT_NON_PRODUCTS) {
      state.destination = destination;
      requests.length = 0;
      const response = await call(items, 'POST', '/api/items', { url: REDIRECT_SOURCE });
      assert.equal(response.status, 502, `${destination} ${response.text}`);
      assert.equal(bodyOf(response.json).code, 'SCRAPE_FAILED');
      assert.deepEqual(requests, [REDIRECT_SOURCE, destination]);
      assert.deepEqual(saved(), []);
    }

    // 同じ店の別商品へ転送されたときは、転送先の商品番号と画像で登録する。
    state.destination = REDIRECT_PRODUCT;
    requests.length = 0;
    const response = await call(items, 'POST', '/api/items', { url: REDIRECT_SOURCE });
    assert.equal(response.status, 201, response.text);
    assert.deepEqual(requests, [REDIRECT_SOURCE, REDIRECT_PRODUCT, REDIRECT_PRODUCT_IMAGE]);
    assert.deepEqual(saved(), [{
      name: 'ツクモの商品（0406621759011）', url: REDIRECT_SOURCE, image_url: REDIRECT_PRODUCT_IMAGE,
    }]);
    assert.equal(requests.includes(REDIRECT_SOURCE_IMAGE), false);
  } finally {
    installProductFetchPort(null);
    installAuthTestHooks(null);
  }
});

test('member registration never returns the original Tsukumo photo after a redirect whose connection breaks (#374)', async () => {
  const { scrapeUrl } = await import('../src/lib/scraper');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const requests: string[] = [];
  const state = { destination: REDIRECT_PRODUCT, failure: 'exception' as const };
  installProductFetchPort(redirectFailurePort(state, requests));
  try {
    for (const destination of REDIRECT_NON_PRODUCTS) {
      state.destination = destination;
      requests.length = 0;
      const item = await scrapeUrl(REDIRECT_SOURCE);
      assert.equal(item.name, '取得失敗', destination);
      assert.equal(item.imageUrl, null, destination);
      assert.deepEqual(requests, [REDIRECT_SOURCE, destination]);
    }

    state.destination = REDIRECT_PRODUCT;
    requests.length = 0;
    const item = await scrapeUrl(REDIRECT_SOURCE);
    assert.equal(item.name, 'ツクモの商品（0406621759011）');
    assert.equal(item.imageUrl, REDIRECT_PRODUCT_IMAGE);
    assert.deepEqual(requests, [REDIRECT_SOURCE, REDIRECT_PRODUCT, REDIRECT_PRODUCT_IMAGE]);

    // 定期の価格確認は、転送先で通信が切れても CDN を呼ばない。
    requests.length = 0;
    const priceOnly = await scrapeUrl(REDIRECT_SOURCE, undefined, 'price');
    assert.equal(priceOnly.name, '取得失敗');
    assert.equal(priceOnly.imageUrl, null);
    assert.deepEqual(requests, [REDIRECT_SOURCE, REDIRECT_PRODUCT]);

    // 転送を追う前の通信例外は、従来どおり入力した商品の公式画像で登録できる。
    state.destination = REDIRECT_SOURCE;
    requests.length = 0;
    installProductFetchPort({ lookup(target) {
      requests.push(target.href);
      if (target.href === REDIRECT_SOURCE) throw new Error('socket hang up');
      return { status: 200, contentType: 'image/jpeg' };
    } });
    const direct = await scrapeUrl(REDIRECT_SOURCE);
    assert.equal(direct.name, 'ツクモの商品（4981254057384）');
    assert.equal(direct.imageUrl, REDIRECT_SOURCE_IMAGE);
    assert.deepEqual(requests, [REDIRECT_SOURCE, REDIRECT_SOURCE_IMAGE]);
  } finally { installProductFetchPort(null); }
});

test('member registration does not fall back to the original product when the redirect target cannot be resolved (#374)', async () => {
  const { scrapeUrl } = await import('../src/lib/scraper');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const pages: string[] = [];
  const images: string[] = [];
  let lookups = 0;
  installProductFetchPort({ lookup(target) { images.push(target.href); return { status: 200, contentType: 'image/jpeg' }; } });
  try {
    const item = await scrapeUrl(REDIRECT_SOURCE, {
      maxRetries: 0,
      baseDelayMs: 0,
      timeoutMs: 1000,
      // 入力の名前解決は通り、転送先の名前解決だけ失敗する。
      resolve: async () => {
        if (++lookups > 1) throw new Error('getaddrinfo ENOTFOUND');
        return [{ address: '8.8.8.8', family: 4 }];
      },
      request: async (url) => {
        pages.push(url.href);
        return { status: 301, location: REDIRECT_PRODUCT, body: Buffer.alloc(0) };
      },
    });
    assert.equal(item.name, '取得失敗');
    assert.equal(item.imageUrl, null);
    assert.deepEqual(pages, [REDIRECT_SOURCE]);
    assert.deepEqual(images, []);
  } finally { installProductFetchPort(null); }
});

test('a retry cannot recover the image of a product already known to redirect (#374)', async () => {
  const { scrapeUrl } = await import('../src/lib/scraper');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const images: string[] = [];
  const requests: string[] = [];
  installProductFetchPort({ lookup(target) {
    images.push(target.href);
    return { status: 200, contentType: 'image/jpeg' };
  } });
  try {
    const item = await scrapeUrl(REDIRECT_SOURCE, {
      maxRetries: 1, baseDelayMs: 0,
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async (url) => {
        requests.push(url.href);
        if (requests.length === 1) return { status: 302, location: REDIRECT_PRODUCT, body: Buffer.alloc(0) };
        if (url.href === REDIRECT_PRODUCT) return { status: 503, body: Buffer.alloc(0) };
        throw new Error('connection interrupted');
      },
    });
    assert.deepEqual(requests, [REDIRECT_SOURCE, REDIRECT_PRODUCT, REDIRECT_SOURCE]);
    assert.equal(item.imageUrl, null);
    assert.deepEqual(images, []);
  } finally { installProductFetchPort(null); }
});

test('a redirect without a reachable destination cannot identify a catalog photo (#374)', async () => {
  const { fetchPublicPage, PublicPageError } = await import('../src/lib/public-page');
  const { scrapeUrl } = await import('../src/lib/scraper');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
  for (const location of [REDIRECT_SOURCE, undefined]) {
    const redirect = { status: 302, location };
    await assert.rejects(fetchPublicPage(REDIRECT_SOURCE, {
      resolve, request: async () => ({ ...redirect, html: '' }),
    }), (err: unknown) => err instanceof PublicPageError && !err.url);
    const images: string[] = [];
    installProductFetchPort({ lookup(target) {
      images.push(target.href);
      return { status: 200, contentType: 'image/jpeg' };
    } });
    try {
      const item = await scrapeUrl(REDIRECT_SOURCE, {
        maxRetries: 0, resolve, request: async () => ({ ...redirect, body: Buffer.alloc(0) }),
      });
      assert.equal(item.imageUrl, null);
      assert.deepEqual(images, []);
    } finally { installProductFetchPort(null); }
  }
});

test('refresh keeps the saved product when only a different redirected photo is available (#374)', async () => {
  const { getDb } = await import('../src/lib/db');
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { startGuest } = await import('../src/lib/guest');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const db = getDb();
  const guest = startGuest(undefined, db).user;
  const memberId = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run('refresh-374@example.test', 'member').lastInsertRowid;
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(memberId) as CurrentUser;
  const savedName = '保存済みのHDD';
  installProductFetchPort(redirectFailurePort({ destination: REDIRECT_PRODUCT, failure: 'status' }, []));
  try {
    for (const user of [guest, member]) {
      installAuthTestHooks({ user });
      const id = String(db.prepare('INSERT INTO items (user_id, name, url, current_price) VALUES (?, ?, ?, ?)')
        .run(user.id, savedName, REDIRECT_SOURCE, 24981).lastInsertRowid);
      const refresh = () => call('../src/app/api/items/[id]/refresh/route.ts', 'POST', `/api/items/${id}/refresh`, undefined, { id });
      const response = await refresh();
      assert.equal(response.status, 200, response.text);
      const item = bodyOf(response.json);
      assert.equal(item.name, savedName);
      assert.equal(item.current_price, 24981);
      assert.equal(item.image_url, null);
      assert.match(String(item.note), /同じ商品/);
      assert.equal(db.prepare('SELECT image_url FROM items WHERE id = ?').pluck().get(id), null);

      // 転送先の商品番号が保存済みであれば、その商品の画像は回復できる。
      db.prepare('UPDATE items SET name = ? WHERE id = ?').run('ツクモの商品（0406621759011）', id);
      const matched = await refresh();
      assert.equal(bodyOf(matched.json).image_url, REDIRECT_PRODUCT_IMAGE);
    }
  } finally {
    installProductFetchPort(null);
    installAuthTestHooks(null);
  }
});

test('refresh cannot identify a previously redirected product from the stored input URL alone (#374)', async () => {
  const { getDb } = await import('../src/lib/db');
  const { startGuest } = await import('../src/lib/guest');
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  const guest = startGuest(undefined, getDb()).user;
  let registering = true;
  installAuthTestHooks({ user: guest });
  installProductFetchPort({ lookup(target) {
    if (target.href === REDIRECT_SOURCE) return registering ? { status: 302, location: REDIRECT_PRODUCT } : { status: 503 };
    if (target.href === REDIRECT_PRODUCT) return {
      status: 200, contentType: 'text/html', body: Buffer.from('<title>商品B</title><p>販売価格: 10,000円</p>'),
    };
    return { status: target.href === REDIRECT_SOURCE_IMAGE ? 200 : 404, contentType: 'image/jpeg' };
  } });
  try {
    const created = await call('../src/app/api/items/route.ts', 'POST', '/api/items', { url: REDIRECT_SOURCE });
    assert.equal(created.status, 201, created.text);
    const item = bodyOf(created.json);
    assert.equal(item.url, REDIRECT_SOURCE);
    assert.equal(item.name, '商品B');
    assert.equal(item.image_url, null);
    registering = false;
    const id = String(item.id);
    const refreshed = await call('../src/app/api/items/[id]/refresh/route.ts', 'POST', `/api/items/${id}/refresh`, undefined, { id });
    assert.equal(refreshed.status, 200, refreshed.text);
    assert.equal(bodyOf(refreshed.json).name, '商品B');
    assert.equal(bodyOf(refreshed.json).current_price, 10000);
    assert.equal(bodyOf(refreshed.json).image_url, null);
  } finally {
    installProductFetchPort(null);
    installAuthTestHooks(null);
  }
});
