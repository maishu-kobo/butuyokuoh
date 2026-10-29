import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type Database from 'better-sqlite3';

const root = mkdtempSync(path.join(tmpdir(), 'guest-issue-73-'));
const cleanupFile = path.join(root, 'cleanup.sqlite');
const spyFile = path.join(root, 'spy.sqlite');
process.env.BUTUYOKUOH_DB_PATH = spyFile;
process.env.GUEST_MODE_ENABLED = 'true';
process.env.GUEST_SCRAPES_PER_MINUTE = '100';
process.env.GUEST_GLOBAL_SCRAPES_PER_MINUTE = '100';
process.env.GUEST_WRITES_PER_MINUTE = '100';
process.env.JWT_SECRET = 'guest-issue-73-test-only';
process.env.AUTH_SECRET = 'guest-issue-73-test-only';
process.env.NEXTAUTH_SECRET = 'guest-issue-73-test-only';
process.env.AUTH_URL = 'http://127.0.0.1:3000';
delete process.env.E2E_PRODUCT_FIXTURES;

const origin = 'http://127.0.0.1:3000';
const require = createRequire(path.join(process.cwd(), 'package.json'));

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function count(db: Database.Database, sql: string, ...params: unknown[]) {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function itemIds(db: Database.Database, userId: number) {
  return (db.prepare('SELECT id FROM items WHERE user_id = ?').all(userId) as { id: number }[]).map(row => row.id);
}

function attachGuestRows(db: Database.Database, userId: number, now: number) {
  const itemId = (db.prepare('SELECT id FROM items WHERE user_id = ? LIMIT 1').get(userId) as { id: number }).id;
  db.prepare('INSERT INTO notification_settings (item_id, target_price) VALUES (?, 100)').run(itemId);
  db.prepare(
    'INSERT INTO user_notification_settings (user_id, slack_webhook, discord_webhook) VALUES (?, ?, ?)',
  ).run(userId, 'https://hooks.slack.com/services/T/B/X', 'https://discord.com/api/webhooks/1/x');
  const captureId = Number(db.prepare("INSERT INTO captures (user_id, status) VALUES (?, 'open')").run(userId).lastInsertRowid);
  db.prepare(
    'INSERT INTO capture_candidates (user_id, capture_id, source, name, url, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, captureId, 'other', '候補', 'https://example.com/candidate', now + 60_000);
  db.prepare('INSERT INTO guest_rate_limits (bucket, count, resets_at) VALUES (?, 1, ?)').run(`write:${userId}`, now + 60_000);
  db.prepare('INSERT INTO guest_rate_limits (bucket, count, resets_at) VALUES (?, 1, ?)').run(`scrape:${userId}`, now + 60_000);
  return itemIds(db, userId);
}

function assertGuestGone(db: Database.Database, userId: number, savedItemIds: number[]) {
  assert.equal(count(db, 'SELECT COUNT(*) n FROM users WHERE id = ?', userId), 0, 'user');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM guest_sessions WHERE user_id = ?', userId), 0, 'session');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM items WHERE user_id = ?', userId), 0, 'items');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM categories WHERE user_id = ?', userId), 0, 'categories');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM comparison_groups WHERE user_id = ?', userId), 0, 'groups');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM user_notification_settings WHERE user_id = ?', userId), 0, 'user notifications');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM captures WHERE user_id = ?', userId), 0, 'captures');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM capture_candidates WHERE user_id = ?', userId), 0, 'candidates');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM guest_rate_limits WHERE bucket IN (?, ?)', `write:${userId}`, `scrape:${userId}`), 0, 'rates');
  for (const itemId of savedItemIds) {
    assert.equal(count(db, 'SELECT COUNT(*) n FROM items WHERE id = ?', itemId), 0, `item ${itemId}`);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM price_history WHERE item_id = ?', itemId), 0, `history ${itemId}`);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM notification_settings WHERE item_id = ?', itemId), 0, `notify ${itemId}`);
  }
}

function expire(db: Database.Database, userId: number, now: number) {
  db.prepare('UPDATE guest_sessions SET expires_at = ? WHERE user_id = ?').run(now - 1, userId);
}

async function raceEndAndCleanup(filename: string, token: string, now: number) {
  const gate = new SharedArrayBuffer(8);
  const view = new Int32Array(gate);
  const workers: Worker[] = [];
  const run = (op: 'end' | 'cleanup') => new Promise<void>((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), 'tests/guest-cleanup-race-worker.cjs'), {
      workerData: { op, filename, token, now, gate },
    });
    workers.push(worker);
    let message: { ok?: boolean; message?: string } | undefined;
    worker.on('message', (value: { ok?: boolean; message?: string }) => { message = value; });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (message?.ok && code === 0) resolve();
      else reject(new Error(message?.message || `${op} worker exit ${code}`));
    });
  });
  try {
    const finished = Promise.all([run('end'), run('cleanup')]);
    let failure: Error | undefined;
    finished.catch((error: Error) => { failure = error; });
    for (let attempt = 0; attempt < 50 && Atomics.load(view, 0) < 2; attempt += 1) {
      if (failure) throw failure;
      const seen = Atomics.load(view, 0);
      if (seen >= 2) break;
      Atomics.wait(view, 0, seen, 200);
    }
    if (failure) throw failure;
    assert.equal(Atomics.load(view, 0), 2, 'cleanup and end did not both start');
    Atomics.store(view, 1, 1);
    Atomics.notify(view, 1);
    await finished;
  } finally {
    for (const worker of workers) await worker.terminate();
  }
}

test('cleanup twice and cleanup racing the end leave no guest data after the database is reopened', { timeout: 60_000 }, async () => {
  const { openDatabase } = await import('../src/lib/db');
  const { startGuest, findGuest, endGuest, cleanupGuests } = await import('../src/lib/guest');
  const now = Date.now();
  const db = openDatabase(cleanupFile);
  const memberId = Number(db.prepare("INSERT INTO users (email, name) VALUES ('member@example.test', '会員')").run().lastInsertRowid);
  const memberItemId = Number(db.prepare("INSERT INTO items (user_id, name, url) VALUES (?, '会員の品', 'https://example.com/member')").run(memberId).lastInsertRowid);
  db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, 500)').run(memberItemId);
  const expired = startGuest(undefined, db, now);
  const racing = startGuest(undefined, db, now);
  const ending = startGuest(undefined, db, now);
  const expiredItems = attachGuestRows(db, expired.user.id, now);
  const racingItems = attachGuestRows(db, racing.user.id, now);
  const endingItems = attachGuestRows(db, ending.user.id, now);
  try {
    expire(db, expired.user.id, now);

    const first = cleanupGuests(db, now);
    const second = cleanupGuests(db, now);
    assert.equal(first.deleted, 1);
    assert.equal(second.deleted, 0);
    assert.equal(second.remainingBatch, false);
    assertGuestGone(db, expired.user.id, expiredItems);
    assert.equal(findGuest(expired.token, db, now), null);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM guest_sessions WHERE user_id = ?', racing.user.id), 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM guest_sessions WHERE user_id = ?', ending.user.id), 1);

    expire(db, racing.user.id, now);
    await raceEndAndCleanup(cleanupFile, racing.token, now);
    const third = cleanupGuests(db, now);
    assert.equal(third.deleted, 0);
    assertGuestGone(db, racing.user.id, racingItems);
    assert.equal(findGuest(racing.token, db, now), null);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM users WHERE id = ?', ending.user.id), 1, 'active guest removed by the other cleanup');

    endGuest(ending.token, db);
    assertGuestGone(db, ending.user.id, endingItems);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM users WHERE account_type = ?', 'guest'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM guest_sessions'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM users WHERE id = ?', memberId), 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM items WHERE id = ?', memberItemId), 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM price_history WHERE item_id = ?', memberItemId), 1);
  } finally {
    db.close();
  }

  const reopened = openDatabase(cleanupFile);
  try {
    assert.equal(count(reopened, 'SELECT COUNT(*) n FROM users WHERE account_type = ?', 'guest'), 0);
    assert.equal(count(reopened, 'SELECT COUNT(*) n FROM guest_sessions'), 0);
    for (const guest of [expired, racing, ending]) {
      assert.equal(findGuest(guest.token, reopened, now), null);
    }
    assert.equal(count(reopened, 'SELECT COUNT(*) n FROM users WHERE id = ?', memberId), 1);
    assert.equal(count(reopened, 'SELECT COUNT(*) n FROM items WHERE id = ?', memberItemId), 1);
    assert.equal(count(reopened, 'SELECT COUNT(*) n FROM price_history WHERE item_id = ?', memberItemId), 1);
    assertGuestGone(reopened, expired.user.id, expiredItems);
    assertGuestGone(reopened, racing.user.id, racingItems);
    assertGuestGone(reopened, ending.user.id, endingItems);
    assert.equal(cleanupGuests(reopened, now).deleted, 0);
    endGuest(expired.token, reopened);
    const revived = startGuest(expired.token, reopened, now);
    assert.equal(revived.created, true);
    assert.notEqual(revived.user.id, expired.user.id);
    assertGuestGone(reopened, expired.user.id, expiredItems);
    endGuest(revived.token, reopened);
    assert.equal(findGuest(revived.token, reopened, now), null);
    assert.equal(findGuest(expired.token, reopened, now), null);
    reopened.close();
    const again = openDatabase(cleanupFile);
    try {
      assert.equal(count(again, 'SELECT COUNT(*) n FROM guest_sessions'), 0);
      assert.equal(findGuest(expired.token, again, now), null);
      assert.equal(findGuest(racing.token, again, now), null);
      assert.equal(findGuest(ending.token, again, now), null);
      assert.equal(findGuest(revived.token, again, now), null);
      assertGuestGone(again, expired.user.id, expiredItems);
      assert.equal(count(again, 'SELECT COUNT(*) n FROM users WHERE id = ?', memberId), 1);
      assert.equal(count(again, 'SELECT COUNT(*) n FROM items WHERE id = ?', memberItemId), 1);
    } finally {
      again.close();
    }
  } finally {
    if (reopened.open) reopened.close();
  }
});

function scrapeUrlFrame(stack: string) {
  return /at (?:async )?scrapeUrl(?:FromPage)? \(/.test(stack);
}

function multipart(bytes: Buffer) {
  const boundary = '----guestissue73';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dot.png"\r\nContent-Type: image/png\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

test('a guest never scrapes with the member scraper, saves a file, or sends a webhook', { timeout: 60_000 }, async () => {
  const http = require('node:http') as typeof import('node:http');
  const https = require('node:https') as typeof import('node:https');
  const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');
  const moduleApi = require('node:module') as { prototype: { require: (id: string) => unknown } };
  const originalRequire = moduleApi.prototype.require;
  const originalWrite = fsPromises.writeFile;
  const originalFetch = globalThis.fetch;
  const originalHttp = http.request;
  const originalHttps = https.request;
  const fileSaveStacks: string[] = [];
  const fileSaves = mock.fn(async () => {
    fileSaveStacks.push((new Error().stack ?? '').split('\n').slice(2, 5).join(' | '));
    throw new Error('writeFile');
  });
  const webhookSends = mock.fn(async (input?: RequestInfo | URL) => new Response('no', {
    status: 500,
    statusText: typeof input,
  }));
  const networkRequests = mock.fn(() => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    request.end = () => { queueMicrotask(() => request.emit('error', new Error('network'))); };
    request.destroy = () => undefined;
    return request;
  });
  const browserLaunches = mock.fn(() => {
    throw new Error('browser launch');
  });
  const scrapeUrlCalls = mock.fn((href: string) => href);
  const pageReads = mock.fn((href: string) => href);

  fsPromises.writeFile = fileSaves as typeof fsPromises.writeFile;
  globalThis.fetch = webhookSends as typeof fetch;
  http.request = networkRequests as unknown as typeof http.request;
  https.request = networkRequests as unknown as typeof https.request;
  moduleApi.prototype.require = function (id: string) {
    if (id === 'puppeteer') return { launch: browserLaunches };
    return originalRequire.call(this, id);
  };

  const port = await import('../src/lib/product-fetch-port');
  const fixture = {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: Buffer.from('<!doctype html><html><head><title>Probe</title></head><body>Probe</body></html>'),
  };
  port.installProductFetchPort({
    lookup(url) {
      const stack = new Error().stack ?? '';
      if (scrapeUrlFrame(stack)) scrapeUrlCalls(url.href);
      else pageReads(url.href);
      return fixture;
    },
  });

  try {
    const { getDb } = await import('../src/lib/db');
    const { startGuest } = await import('../src/lib/guest');
    const { installAuthTestHooks } = await import('../src/lib/auth');
    const { scrapeUrl } = await import('../src/lib/scraper');
    const { launchPageBrowser } = await import('../src/lib/page-browser');
    const { priceCheckItems } = await import('../src/lib/price-check-items');
    const { sendDiscordNotification, sendSlackNotification } = await import('../src/lib/notifier');
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const database = getDb();
    const rows = database.prepare('PRAGMA database_list').all() as { file: string }[];
    assert.equal(rows.some(row => row.file === spyFile), true);
    const { NextRequest } = await import('next/server');
    const itemsRoute = await import('../src/app/api/items/route');
    const previewRoute = await import('../src/app/api/items/preview/route');
    const refreshRoute = await import('../src/app/api/items/[id]/refresh/route');
    const uploadRoute = await import('../src/app/api/upload/route');
    const notifyRoute = await import('../src/app/api/notification-settings/route');
    const wishlistRoute = await import('../src/app/api/import-wishlist/route');
    fileSaves.mock.resetCalls();
    webhookSends.mock.resetCalls();
    networkRequests.mock.resetCalls();
    browserLaunches.mock.resetCalls();
    scrapeUrlCalls.mock.resetCalls();
    pageReads.mock.resetCalls();

    await assert.rejects(() => fsPromises.writeFile(path.join(root, 'unused'), 'x'));
    assert.equal(fileSaves.mock.calls.length, 1);
    await webhookSends('https://hooks.slack.com/services/T/B/self');
    assert.equal(webhookSends.mock.calls.length, 1);
    networkRequests();
    assert.equal(networkRequests.mock.calls.length, 1);
    await assert.rejects(() => launchPageBrowser());
    assert.equal(browserLaunches.mock.calls.length >= 1, true);
    await scrapeUrl('https://example.com/products/member-probe');
    assert.equal(scrapeUrlCalls.mock.calls.length, 1, 'member scraper probe did not reach the stub');
    fileSaves.mock.resetCalls();
    fileSaveStacks.length = 0;
    webhookSends.mock.resetCalls();
    networkRequests.mock.resetCalls();
    browserLaunches.mock.resetCalls();
    scrapeUrlCalls.mock.resetCalls();
    pageReads.mock.resetCalls();

    const guest = startGuest(undefined, database);
    installAuthTestHooks({ user: guest.user });
    const guestItem = database.prepare('SELECT id FROM items WHERE user_id = ? LIMIT 1').get(guest.user.id) as { id: number };
    database.prepare('UPDATE items SET url = ?, current_price = 2000, target_price = 1000 WHERE id = ?').run(
      'https://example.com/products/guest-refresh',
      guestItem.id,
    );
    database.prepare(
      'INSERT INTO user_notification_settings (user_id, slack_webhook, discord_webhook, notify_on_price_drop, notify_on_target_price) VALUES (?, ?, ?, 1, 1)',
    ).run(guest.user.id, 'https://hooks.slack.com/services/T/B/X', 'https://discord.com/api/webhooks/1/x');

    const call = async (
      handler: (
        request: InstanceType<typeof NextRequest>,
        context?: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      method: string,
      requestPath: string,
      body?: unknown,
      params?: Record<string, string>,
    ) => {
      const request = new NextRequest(`${origin}${requestPath}`, {
        method,
        headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
      return response.status;
    };
    const routeHandler = (route: object, method: 'GET' | 'POST' | 'PUT') =>
      (route as Record<string, (request: InstanceType<typeof NextRequest>, context?: { params: Promise<Record<string, string>> }) => Promise<Response>>)[method];

    assert.equal(await call(routeHandler(itemsRoute, 'POST'), 'POST', '/api/items', { manual: true, name: '手入力' }), 201);
    assert.equal(await call(routeHandler(previewRoute, 'POST'), 'POST', '/api/items/preview', { url: 'https://example.com/products/guest-preview' }), 200);
    const added = await call(routeHandler(itemsRoute, 'POST'), 'POST', '/api/items', { url: 'https://example.com/products/guest-add' });
    assert.equal(added, 201);
    assert.equal(await call(routeHandler(refreshRoute, 'POST'), 'POST', `/api/items/${guestItem.id}/refresh`, undefined, { id: String(guestItem.id) }), 200);
    assert.ok(pageReads.mock.calls.length > 0);

    const packed = multipart(png);
    const uploadResponse = await uploadRoute.POST(new NextRequest(`${origin}/api/upload`, {
      method: 'POST',
      headers: { origin, 'content-type': packed.contentType },
      body: packed.body,
    }));
    assert.equal(uploadResponse.status, 403);
    assert.equal(await call(routeHandler(notifyRoute, 'GET'), 'GET', '/api/notification-settings'), 403);
    assert.equal(await call(routeHandler(notifyRoute, 'PUT'), 'PUT', '/api/notification-settings', {
      slack_webhook: 'https://hooks.slack.com/services/T/B/Y',
      discord_webhook: 'https://discord.com/api/webhooks/2/y',
    }), 403);
    assert.equal(await call(routeHandler(wishlistRoute, 'POST'), 'POST', '/api/import-wishlist', {
      url: 'https://www.amazon.co.jp/hz/wishlist/ls/GUEST73',
    }), 403);

    const checks = priceCheckItems(database) as { user_id: number; url: string }[];
    assert.equal(checks.some(item => item.user_id === guest.user.id), false);
    for (const item of checks) await scrapeUrl(item.url);

    const payload = {
      item: { id: guestItem.id, name: 'ゲスト品', url: 'https://example.com/products/guest-refresh', image_url: null },
      oldPrice: 2000,
      newPrice: 800,
      targetPrice: 1000,
      type: 'price_drop' as const,
    };
    assert.equal(await sendSlackNotification('https://hooks.slack.com/services/T/B/X', payload), false);
    assert.equal(await sendDiscordNotification('https://discord.com/api/webhooks/1/x', payload), false);

    assert.equal(scrapeUrlCalls.mock.calls.length, 0);
    assert.equal(browserLaunches.mock.calls.length, 0);
    assert.equal(fileSaves.mock.calls.length, 0, fileSaveStacks.join('\n'));
    assert.equal(webhookSends.mock.calls.length, 0);
    assert.equal(networkRequests.mock.calls.length, 0);
  } finally {
    moduleApi.prototype.require = originalRequire;
    fsPromises.writeFile = originalWrite;
    globalThis.fetch = originalFetch;
    http.request = originalHttp;
    https.request = originalHttps;
    const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
    installProductFetchPort(null);
    const { installAuthTestHooks } = await import('../src/lib/auth');
    installAuthTestHooks(null);
  }
});
