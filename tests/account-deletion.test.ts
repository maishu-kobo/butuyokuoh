import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { encode } from 'next-auth/jwt';
import { call, db, setTestUser } from './regression-harness';
import { deleteMemberAccount } from '../src/lib/delete-member-account';

const registerPath = '../src/app/api/auth/register/route.ts';
const loginPath = '../src/app/api/auth/login/route.ts';
const logoutPath = '../src/app/api/auth/logout/route.ts';
const accountPath = '../src/app/api/auth/account/route.ts';
const tokenPath = '../src/app/api/auth/token/route.ts';
const mePath = '../src/app/api/auth/me/route.ts';
const itemsPath = '../src/app/api/items/route.ts';
const sessionCookie = 'authjs.session-token';

let exclusive: Promise<void> = Promise.resolve();

function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

type CookieJar = {
  name?: string;
  value?: string;
  deleted: boolean;
};

async function resetAuth() {
  const { installAuthTestHooks } = await import('../src/lib/auth');
  installAuthTestHooks(null);
}

async function memberCookieJar(): Promise<CookieJar> {
  const saved: CookieJar = { deleted: false };
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { MEMBER_TOKEN_COOKIE } = await import('../src/lib/cookie-policy');
  installAuthTestHooks({
    session: null,
    cookies: {
      set(name, value) {
        saved.name = name;
        saved.value = value;
        saved.deleted = false;
      },
      delete(name) {
        saved.name = name;
        saved.value = undefined;
        saved.deleted = true;
      },
      get(name) {
        if (saved.deleted || name !== MEMBER_TOKEN_COOKIE) return undefined;
        return saved.value;
      },
    },
  });
  return saved;
}

function present(jar: CookieJar, token: string) {
  jar.value = token;
  jar.deleted = false;
}

async function register(email: string) {
  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email,
    password: 'secret1',
    name: email,
  });
  assert.equal(created.status, 200, created.text);
  const body = created.json as { token: string; user: { id: number; email: string } };
  return body;
}

function seedOwned(database: Awaited<ReturnType<typeof db>>, userId: number, webhook: string) {
  const categoryId = Number(database.prepare(
    'INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)',
  ).run(userId, `cat-${userId}`, '#112233').lastInsertRowid);
  const groupId = Number(database.prepare(
    'INSERT INTO comparison_groups (user_id, name, origin) VALUES (?, ?, ?)',
  ).run(userId, `group-${userId}`, 'photo').lastInsertRowid);
  const itemId = Number(database.prepare(
    `INSERT INTO items (user_id, name, url, current_price, category_id, comparison_group_id, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(userId, `item-${userId}`, `https://example.test/item-${userId}`, 1200, categoryId, groupId).lastInsertRowid);
  database.prepare('UPDATE comparison_groups SET budget_item_id = ? WHERE id = ?').run(itemId, groupId);
  database.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, 1200);
  database.prepare(
    'INSERT INTO notification_settings (item_id, target_price, notify_on_any_drop, enabled) VALUES (?, ?, 1, 1)',
  ).run(itemId, 1000);
  database.prepare(
    'INSERT INTO user_notification_settings (user_id, slack_webhook, discord_webhook) VALUES (?, ?, ?)',
  ).run(userId, webhook, `https://discord.example.test/api/webhooks/${userId}`);
  const captureId = Number(database.prepare(
    'INSERT INTO captures (user_id, estimated_name, status, comparison_group_id, registered_item_id) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, `cap-${userId}`, 'open', groupId, itemId).lastInsertRowid);
  database.prepare(
    `INSERT INTO capture_candidates (user_id, capture_id, source, name, url, price)
     VALUES (?, ?, 'amazon', ?, ?, 900)`,
  ).run(userId, captureId, `cand-${userId}`, `https://example.test/cand-${userId}`);
  database.prepare(
    'INSERT INTO capture_ai_usage (user_key, day, at_ms, neurons) VALUES (?, ?, ?, ?)',
  ).run(String(userId), '2026-10-23', 1_700_000_000_000, 3);
}

function ownedCounts(database: Awaited<ReturnType<typeof db>>, userId: number) {
  const n = (sql: string, param: number | string) =>
    (database.prepare(sql).get(param) as { n: number }).n;
  return {
    users: n('SELECT COUNT(*) AS n FROM users WHERE id = ?', userId),
    items: n('SELECT COUNT(*) AS n FROM items WHERE user_id = ?', userId),
    categories: n('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', userId),
    groups: n('SELECT COUNT(*) AS n FROM comparison_groups WHERE user_id = ?', userId),
    history: n(
      'SELECT COUNT(*) AS n FROM price_history WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)',
      userId,
    ),
    itemNotify: n(
      'SELECT COUNT(*) AS n FROM notification_settings WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)',
      userId,
    ),
    userNotify: n('SELECT COUNT(*) AS n FROM user_notification_settings WHERE user_id = ?', userId),
    captures: n('SELECT COUNT(*) AS n FROM captures WHERE user_id = ?', userId),
    candidates: n('SELECT COUNT(*) AS n FROM capture_candidates WHERE user_id = ?', userId),
    ai: n('SELECT COUNT(*) AS n FROM capture_ai_usage WHERE user_key = ?', String(userId)),
  };
}

const full = {
  users: 1,
  items: 1,
  categories: 1,
  groups: 1,
  history: 1,
  itemNotify: 1,
  userNotify: 1,
  captures: 1,
  candidates: 1,
  ai: 1,
};

const empty = {
  users: 0,
  items: 0,
  categories: 0,
  groups: 0,
  history: 0,
  itemNotify: 0,
  userNotify: 0,
  captures: 0,
  candidates: 0,
  ai: 0,
};

async function sessionToken(userId: number, email: string, sessionGeneration?: number) {
  return encode({
    token: {
      sub: String(userId),
      email,
      userId: String(userId),
      ...(sessionGeneration === undefined ? {} : { sessionGeneration }),
    },
    secret: process.env.AUTH_SECRET!,
    salt: sessionCookie,
  });
}

async function sessionUserId(token: string) {
  const { GET: readSession } = await import('../src/app/api/auth/[...nextauth]/route');
  const response = await readSession(new NextRequest('http://127.0.0.1/api/auth/session', {
    headers: { cookie: `${sessionCookie}=${token}` },
  }));
  const text = await response.text();
  const body = text ? JSON.parse(text) as { user?: { id?: string } } : null;
  return body?.user?.id;
}

test('ログアウトすると古いログイン情報は拒否され、データは残る', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Logout-Owner@Example.TEST');
  const ownerToken = owner.token;
  assert.equal(jar.value, ownerToken);
  const other = await register('logout-other@example.test');
  present(jar, ownerToken);

  const database = await db();
  seedOwned(database, owner.user.id, 'https://hooks.example.test/slack/logout-owner');
  seedOwned(database, other.user.id, 'https://hooks.example.test/slack/logout-other');
  const { getUserIdFromToken, verifyToken } = await import('../src/lib/auth');
  assert.equal(getUserIdFromToken(ownerToken), owner.user.id);

  const { GET: readCategories } = await import('../src/app/api/extension-categories/route');
  const before = await readCategories(new NextRequest('http://127.0.0.1/api/extension-categories', {
    headers: { authorization: `Bearer ${ownerToken}` },
  }));
  assert.equal(before.status, 200);

  const issued = await call(tokenPath, 'GET', '/api/auth/token');
  assert.equal(issued.status, 200);
  const extensionToken = (issued.json as { token: string }).token;
  assert.equal(getUserIdFromToken(extensionToken), owner.user.id);

  const previousSession = await sessionToken(owner.user.id, owner.user.email);
  assert.equal(await sessionUserId(previousSession), String(owner.user.id));

  const generationBefore = (database.prepare(
    'SELECT session_generation FROM users WHERE id = ?',
  ).get(owner.user.id) as { session_generation: number }).session_generation;
  const loggedOut = await call(logoutPath, 'POST', '/api/auth/logout', undefined, undefined, {
    origin: 'http://localhost',
  }, 'http://localhost/api/auth/logout');
  assert.equal(loggedOut.status, 200);
  assert.equal((loggedOut.json as { success?: boolean }).success, true);
  assert.equal(jar.deleted, true);
  assert.equal(
    (database.prepare('SELECT session_generation FROM users WHERE id = ?').get(owner.user.id) as {
      session_generation: number;
    }).session_generation,
    generationBefore + 1,
  );

  present(jar, ownerToken);
  assert.equal(getUserIdFromToken(ownerToken), null);
  assert.equal(getUserIdFromToken(extensionToken), null);
  assert.equal(getUserIdFromToken(other.token), other.user.id);

  const me = await call(mePath, 'GET', '/api/auth/me');
  assert.equal(me.status, 401);
  const items = await call(itemsPath, 'GET', '/api/items');
  assert.equal(items.status, 401);

  const read = await readCategories(new NextRequest('http://127.0.0.1/api/extension-categories', {
    headers: { authorization: `Bearer ${ownerToken}` },
  }));
  assert.equal(read.status, 401);
  const { POST: addItem } = await import('../src/app/api/extension-add/route');
  const write = await addItem(new NextRequest('http://127.0.0.1/api/extension-add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: extensionToken,
      item: {
        name: 'ログアウト後の商品',
        url: 'https://example.test/after-logout',
        price: 100,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    }),
  }));
  assert.equal(write.status, 401);
  assert.equal(
    database.prepare("SELECT id FROM items WHERE url = 'https://example.test/after-logout'").get(),
    undefined,
  );
  assert.equal(await sessionUserId(previousSession), undefined);
  assert.deepEqual(ownedCounts(database, owner.user.id), full);
  assert.deepEqual(ownedCounts(database, other.user.id), full);
  assert.equal(
    (database.prepare('SELECT session_generation FROM users WHERE id = ?').get(other.user.id) as {
      session_generation: number;
    }).session_generation,
    0,
  );

  const again = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'logout-owner@example.test',
    password: 'secret1',
  });
  assert.equal(again.status, 200);
  const renewed = again.json as { token: string; user: { id: number } };
  assert.equal(renewed.user.id, owner.user.id);
  assert.equal(getUserIdFromToken(ownerToken), null);
  assert.equal(getUserIdFromToken(renewed.token), owner.user.id);
  const generation = verifyToken(renewed.token)?.sessionGeneration;
  assert.equal(typeof generation, 'number');
  const renewedSession = await sessionToken(owner.user.id, owner.user.email, generation);
  assert.equal(await sessionUserId(renewedSession), String(owner.user.id));
  assert.equal(await sessionUserId(previousSession), undefined);
}));

async function postLogout(origin: string | null) {
  const { POST } = await import(logoutPath);
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  const response = await POST(new NextRequest('http://localhost/api/auth/logout', {
    method: 'POST',
    headers,
  }));
  return { status: response.status, text: await response.text() };
}

test('別オリジンのログアウトは世代を上げず、同じオリジンでは上げる', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Logout-Origin@Example.TEST');
  const database = await db();
  const generation = () => (database.prepare(
    'SELECT session_generation FROM users WHERE id = ?',
  ).get(owner.user.id) as { session_generation: number }).session_generation;
  assert.equal(generation(), 0);
  present(jar, owner.token);

  const foreign = await postLogout('https://evil.example');
  assert.equal(foreign.status, 403);
  assert.equal(generation(), 0);
  assert.equal(jar.deleted, false);

  const missing = await postLogout(null);
  assert.equal(missing.status, 403);
  assert.equal(generation(), 0);
  assert.equal(jar.deleted, false);

  const same = await postLogout('http://localhost');
  assert.equal(same.status, 200, same.text);
  assert.equal(generation(), 1);
  assert.equal(jar.deleted, true);
  const { getUserIdFromToken } = await import('../src/lib/auth');
  assert.equal(getUserIdFromToken(owner.token), null);
}));

test('退会すると本人のデータだけ消え、古いログイン情報は拒否される', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Delete-Owner@Example.TEST');
  const other = await register('delete-other@example.test');
  const database = await db();
  const ownerWebhook = 'https://hooks.example.test/slack/delete-owner';
  const otherWebhook = 'https://hooks.example.test/slack/delete-other';
  seedOwned(database, owner.user.id, ownerWebhook);
  seedOwned(database, other.user.id, otherWebhook);

  const uploadDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const ownerFile = join(uploadDir, `${owner.user.id}_1710000000000.jpg`);
  const otherFile = join(uploadDir, `${other.user.id}_1710000000000.png`);
  const lookalike = join(uploadDir, `${owner.user.id}9_1710000000000.jpg`);
  const note = join(uploadDir, 'readme.txt');
  const ownerLink = join(uploadDir, `${owner.user.id}_1710000000001.jpg`);
  writeFileSync(ownerFile, 'owner-image');
  writeFileSync(otherFile, 'other-image');
  writeFileSync(lookalike, 'not-this-user');
  writeFileSync(note, 'keep');
  symlinkSync(otherFile, ownerLink);

  try {
    present(jar, owner.token);
    const previousSession = await sessionToken(owner.user.id, owner.user.email);
    assert.equal(await sessionUserId(previousSession), String(owner.user.id));
    const removed = await call(accountPath, 'DELETE', '/api/auth/account', { userId: other.user.id });
    assert.equal(removed.status, 200, removed.text);
    assert.equal((removed.json as { success?: boolean }).success, true);
    assert.equal(jar.deleted, true);

    assert.deepEqual(ownedCounts(database, owner.user.id), empty);
    assert.deepEqual(ownedCounts(database, other.user.id), full);
    assert.equal(
      database.prepare('SELECT slack_webhook FROM user_notification_settings WHERE slack_webhook = ?').get(ownerWebhook),
      undefined,
    );
    assert.equal(
      (database.prepare('SELECT slack_webhook FROM user_notification_settings WHERE slack_webhook = ?').get(otherWebhook) as {
        slack_webhook: string;
      }).slack_webhook,
      otherWebhook,
    );
    assert.equal(existsSync(ownerFile), false);
    assert.equal(existsSync(ownerLink), false);
    assert.equal(existsSync(otherFile), true);
    assert.equal(existsSync(lookalike), true);
    assert.equal(existsSync(note), true);

    const { getUserIdFromToken } = await import('../src/lib/auth');
    assert.equal(getUserIdFromToken(owner.token), null);
    assert.equal(getUserIdFromToken(other.token), other.user.id);
    assert.equal(await sessionUserId(previousSession), undefined);
    present(jar, owner.token);
    assert.equal((await call(mePath, 'GET', '/api/auth/me')).status, 401);
    assert.equal((await call(itemsPath, 'GET', '/api/items')).status, 401);

    const oldPassword = await call(loginPath, 'POST', '/api/auth/login', {
      email: 'delete-owner@example.test',
      password: 'secret1',
    });
    assert.equal(oldPassword.status, 401);

    const recreated = await register('delete-owner@example.test');
    assert.notEqual(recreated.user.id, owner.user.id);
    const recreatedCounts = ownedCounts(database, recreated.user.id);
    assert.equal(recreatedCounts.users, 1);
    assert.deepEqual({ ...recreatedCounts, users: 0 }, empty);

    present(jar, owner.token);
    const again = await call(accountPath, 'DELETE', '/api/auth/account');
    assert.equal(again.status, 401);
    assert.equal(ownedCounts(database, recreated.user.id).users, 1);
    assert.deepEqual(ownedCounts(database, other.user.id), full);
    assert.equal(existsSync(otherFile), true);
  } finally {
    for (const file of [ownerFile, ownerLink, otherFile, lookalike, note]) {
      try { unlinkSync(file); } catch { /* 退会が消したファイルや、最初から無いファイル */ }
    }
  }
}));

test('退会すると十六進名のアップロードは image URL から消え、他の会員のファイルは残る', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Hex-Owner@Example.TEST');
  const other = await register('hex-other@example.test');
  const database = await db();
  seedOwned(database, owner.user.id, 'https://hooks.example.test/slack/hex-owner');
  seedOwned(database, other.user.id, 'https://hooks.example.test/slack/hex-other');

  const uploadDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const ownerHex = `${'a'.repeat(64)}.jpg`;
  const otherHex = `${'b'.repeat(64)}.png`;
  const candidateHex = `${'d'.repeat(64)}.gif`;
  const orphanHex = `${'c'.repeat(64)}.webp`;
  const ownerLegacy = `${owner.user.id}_1710000000000.jpg`;
  const otherLegacy = `${other.user.id}_1710000000000.png`;
  const ownerHexFile = join(uploadDir, ownerHex);
  const otherHexFile = join(uploadDir, otherHex);
  const candidateFile = join(uploadDir, candidateHex);
  const orphanFile = join(uploadDir, orphanHex);
  const ownerLegacyFile = join(uploadDir, ownerLegacy);
  const otherLegacyFile = join(uploadDir, otherLegacy);
  const outside = join(process.cwd(), 'public', 'not-an-upload.txt');
  writeFileSync(ownerHexFile, 'owner-hex');
  writeFileSync(otherHexFile, 'other-hex');
  writeFileSync(candidateFile, 'candidate-hex');
  writeFileSync(orphanFile, 'orphan-hex');
  writeFileSync(ownerLegacyFile, 'owner-legacy');
  writeFileSync(otherLegacyFile, 'other-legacy');
  writeFileSync(outside, 'keep-outside');
  database.prepare('UPDATE items SET image_url = ? WHERE user_id = ?').run(`/uploads/${ownerHex}`, owner.user.id);
  database.prepare('UPDATE items SET image_url = ? WHERE user_id = ?').run(`/uploads/${otherHex}`, other.user.id);
  database.prepare('UPDATE capture_candidates SET image_url = ? WHERE user_id = ?').run(
    `/uploads/${candidateHex}`,
    owner.user.id,
  );
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'copied', 'https://example.test/copied-upload', `/uploads/${otherHex}`);
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'copied-legacy', 'https://example.test/copied-legacy', `/uploads/${otherLegacy}`);
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'escape', 'https://example.test/escape-upload', '/uploads/../not-an-upload.txt');

  try {
    present(jar, owner.token);
    const removed = await call(accountPath, 'DELETE', '/api/auth/account');
    assert.equal(removed.status, 200, removed.text);
    assert.equal(existsSync(ownerHexFile), false);
    assert.equal(existsSync(candidateFile), false);
    assert.equal(existsSync(ownerLegacyFile), false);
    assert.equal(existsSync(otherHexFile), true);
    assert.equal(existsSync(otherLegacyFile), true);
    assert.equal(existsSync(orphanFile), true);
    assert.equal(existsSync(outside), true);
    assert.deepEqual(ownedCounts(database, other.user.id), full);
  } finally {
    for (const file of [ownerHexFile, otherHexFile, candidateFile, orphanFile, ownerLegacyFile, otherLegacyFile, outside]) {
      try { unlinkSync(file); } catch { /* 退会が消したファイルや、最初から無いファイル */ }
    }
  }
}));

function uploadPath(url: string): string {
  assert.match(url, /^\/uploads\/[0-9a-f]{64}\.jpg$/);
  return join(process.cwd(), 'public', 'uploads', url.slice('/uploads/'.length));
}

async function uploadJpeg(): Promise<string> {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 12, g: 34, b: 56 } },
  }).jpeg().toBuffer();
  const boundary = '----accountdeletionupload';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="owned.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const { NextRequest } = await import('next/server');
  const { POST } = await import('../src/app/api/upload/route');
  const request = new NextRequest('http://127.0.0.1/api/upload', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Uint8Array.from(body),
  });
  const response = await POST(request);
  const json = JSON.parse(await response.text()) as { url?: string; error?: string };
  assert.equal(response.status, 200, JSON.stringify(json));
  const url = json.url || '';
  assert.match(url, /^\/uploads\/[0-9a-f]{64}\.jpg$/);
  assert.equal(existsSync(uploadPath(url)), true);
  return url;
}

function linkGone(file: string): boolean {
  try {
    lstatSync(file);
    return false;
  } catch {
    return true;
  }
}

test('退会すると十六進の差し替え前ファイルと未保存のアップロードが消え、別会員のファイルとパストラバーサルは残る', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Replaced-Owner@Example.TEST');
  const other = await register('replaced-other@example.test');
  const database = await db();
  seedOwned(database, owner.user.id, 'https://hooks.example.test/slack/replaced-owner');
  seedOwned(database, other.user.id, 'https://hooks.example.test/slack/replaced-other');

  const uploadDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const outside = join(process.cwd(), 'public', 'replaced-upload-escape.txt');
  const linkTarget = join(process.cwd(), 'public', 'replaced-upload-symlink-target.txt');
  const linkName = `${'f'.repeat(64)}.jpg`;
  const linkPath = join(uploadDir, linkName);
  const orphanName = `${'e'.repeat(64)}.jpg`;
  const orphanFile = join(uploadDir, orphanName);
  writeFileSync(outside, 'keep-outside');
  writeFileSync(linkTarget, 'keep-symlink-target');
  writeFileSync(orphanFile, 'orphan-hex');
  symlinkSync(linkTarget, linkPath);

  present(jar, owner.token);
  const ownerPrevious = await uploadJpeg();
  const ownerCurrent = await uploadJpeg();
  const ownerUnsaved = await uploadJpeg();
  present(jar, other.token);
  const otherPrevious = await uploadJpeg();
  const otherCurrent = await uploadJpeg();
  const otherUnsaved = await uploadJpeg();

  database.prepare('UPDATE items SET image_url = ? WHERE user_id = ?').run(ownerCurrent, owner.user.id);
  database.prepare('UPDATE items SET image_url = ? WHERE user_id = ?').run(otherCurrent, other.user.id);
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'copied-previous', 'https://example.test/copied-previous', otherPrevious);
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'escape', 'https://example.test/replaced-escape', '/uploads/../replaced-upload-escape.txt');
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'symlink', 'https://example.test/replaced-symlink', `/uploads/${linkName}`);

  const created = [
    uploadPath(ownerPrevious),
    uploadPath(ownerCurrent),
    uploadPath(ownerUnsaved),
    uploadPath(otherPrevious),
    uploadPath(otherCurrent),
    uploadPath(otherUnsaved),
    outside,
    linkTarget,
    linkPath,
    orphanFile,
  ];

  try {
    present(jar, owner.token);
    const removed = await call(accountPath, 'DELETE', '/api/auth/account');
    assert.equal(removed.status, 200, removed.text);
    assert.equal(existsSync(uploadPath(ownerPrevious)), false);
    assert.equal(existsSync(uploadPath(ownerUnsaved)), false);
    assert.equal(existsSync(uploadPath(ownerCurrent)), false);
    assert.equal(existsSync(uploadPath(otherPrevious)), true);
    assert.equal(existsSync(uploadPath(otherCurrent)), true);
    assert.equal(existsSync(uploadPath(otherUnsaved)), true);
    assert.equal(existsSync(orphanFile), true);
    assert.equal(existsSync(outside), true);
    assert.equal(existsSync(linkTarget), true);
    assert.equal(linkGone(linkPath), true);
    assert.deepEqual(ownedCounts(database, other.user.id), full);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM member_uploads WHERE user_id = ?').get(owner.user.id) as { n: number }).n,
      0,
    );
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM member_uploads WHERE user_id = ?').get(other.user.id) as { n: number }).n,
      3,
    );
  } finally {
    for (const file of created) {
      try { unlinkSync(file); } catch { /* 退会が消したファイルや、最初から無いファイル */ }
    }
  }
}));

test('退会は所有記録のパストラバーサルとシンボリックリンクの先を消さない', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Poison-Owner@Example.TEST');
  const other = await register('poison-other@example.test');
  const database = await db();
  seedOwned(database, owner.user.id, 'https://hooks.example.test/slack/poison-owner');
  seedOwned(database, other.user.id, 'https://hooks.example.test/slack/poison-other');

  const uploadDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const outside = join(process.cwd(), 'public', 'owned-record-escape.txt');
  const linkTarget = join(process.cwd(), 'public', 'owned-record-symlink-target.txt');
  const linkName = `${'9'.repeat(64)}.jpg`;
  const linkPath = join(uploadDir, linkName);
  const otherLegacy = `${other.user.id}_1710000000000.png`;
  const otherLegacyFile = join(uploadDir, otherLegacy);
  const keptNote = join(uploadDir, 'kept-note.txt');
  writeFileSync(outside, 'keep-outside');
  writeFileSync(linkTarget, 'keep-symlink-target');
  writeFileSync(otherLegacyFile, 'other-legacy');
  writeFileSync(keptNote, 'keep-note');
  symlinkSync(linkTarget, linkPath);

  try {
    database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run('../owned-record-escape.txt', owner.user.id);
    database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run(linkName, owner.user.id);
    database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run(otherLegacy, owner.user.id);
    database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run('kept-note.txt', owner.user.id);
    present(jar, owner.token);
    const removed = await call(accountPath, 'DELETE', '/api/auth/account');
    assert.equal(removed.status, 200, removed.text);
    assert.equal(existsSync(outside), true);
    assert.equal(existsSync(linkTarget), true);
    assert.equal(linkGone(linkPath), true);
    assert.equal(existsSync(otherLegacyFile), true);
    assert.equal(existsSync(keptNote), true);
    assert.deepEqual(ownedCounts(database, other.user.id), full);
  } finally {
    for (const file of [outside, linkTarget, linkPath, otherLegacyFile, keptNote]) {
      try { unlinkSync(file); } catch { /* 退会が消したファイルや、最初から無いファイル */ }
    }
  }
}));

test('退会のトランザクションが戻ると、所有ファイルも他会員のファイルもパストラバーサルも残る', () => serial(async () => {
  await resetAuth();
  await memberCookieJar();
  const owner = await register('Rollback-Owner@Example.TEST');
  const other = await register('rollback-other@example.test');
  const database = await db();
  const uploadDir = join(process.cwd(), 'public', 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const ownedName = `${'1'.repeat(64)}.jpg`;
  const ownedFile = join(uploadDir, ownedName);
  const otherName = `${'2'.repeat(64)}.png`;
  const otherFile = join(uploadDir, otherName);
  const orphanName = `${'3'.repeat(64)}.webp`;
  const orphanFile = join(uploadDir, orphanName);
  const legacyName = `${owner.user.id}_1710000000002.jpg`;
  const legacyFile = join(uploadDir, legacyName);
  const outside = join(process.cwd(), 'public', 'rollback-upload-escape.txt');
  const linkTarget = join(process.cwd(), 'public', 'rollback-upload-symlink-target.txt');
  const linkName = `${'4'.repeat(64)}.gif`;
  const linkPath = join(uploadDir, linkName);
  writeFileSync(ownedFile, 'owned');
  writeFileSync(otherFile, 'other');
  writeFileSync(orphanFile, 'orphan');
  writeFileSync(legacyFile, 'legacy');
  writeFileSync(outside, 'keep-outside');
  writeFileSync(linkTarget, 'keep-symlink-target');
  symlinkSync(linkTarget, linkPath);
  database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run(ownedName, owner.user.id);
  database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run(otherName, other.user.id);
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'old-hex', 'https://example.test/rollback-old-hex', `/uploads/${orphanName}`);
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'escape', 'https://example.test/rollback-escape', '/uploads/../rollback-upload-escape.txt');
  database.prepare(
    'INSERT INTO items (user_id, name, url, image_url) VALUES (?, ?, ?, ?)',
  ).run(owner.user.id, 'symlink', 'https://example.test/rollback-symlink', `/uploads/${linkName}`);
  database.exec(`
    CREATE TRIGGER member_delete_abort
    BEFORE DELETE ON users
    BEGIN
      SELECT RAISE(ABORT, 'test rollback');
    END
  `);

  try {
    assert.throws(() => deleteMemberAccount(owner.user.id, database));
    assert.equal(existsSync(ownedFile), true);
    assert.equal(existsSync(legacyFile), true);
    assert.equal(existsSync(otherFile), true);
    assert.equal(existsSync(orphanFile), true);
    assert.equal(existsSync(outside), true);
    assert.equal(existsSync(linkTarget), true);
    assert.equal(linkGone(linkPath), false);
    assert.equal(
      (database.prepare("SELECT id FROM users WHERE id = ? AND account_type = 'member'").get(owner.user.id) as { id: number }).id,
      owner.user.id,
    );
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM member_uploads WHERE user_id = ?').get(owner.user.id) as { n: number }).n,
      1,
    );
  } finally {
    database.exec('DROP TRIGGER IF EXISTS member_delete_abort');
    for (const file of [ownedFile, otherFile, orphanFile, legacyFile, outside, linkTarget, linkPath]) {
      try { unlinkSync(file); } catch { /* 退会が消したファイルや、最初から無いファイル */ }
    }
  }
}));

test('未ログインとゲストは退会で会員データを消せない', () => serial(async () => {
  await resetAuth();
  const jar = await memberCookieJar();
  const owner = await register('Kept-Member@Example.TEST');
  const database = await db();
  seedOwned(database, owner.user.id, 'https://hooks.example.test/slack/kept-member');
  const guestId = Number(database.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('kept-guest@guest.invalid', 'ゲスト', 'guest')",
  ).run().lastInsertRowid);

  await setTestUser({
    id: guestId,
    account_type: 'guest',
    email: null,
    name: 'ゲスト',
    created_at: '2026-10-23 00:00:00',
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  const guestDelete = await call(accountPath, 'DELETE', '/api/auth/account');
  assert.equal(guestDelete.status, 403);
  assert.equal(
    (database.prepare('SELECT account_type FROM users WHERE id = ?').get(guestId) as { account_type: string }).account_type,
    'guest',
  );
  assert.deepEqual(ownedCounts(database, owner.user.id), full);

  await setTestUser(null);
  const anonymous = await call(accountPath, 'DELETE', '/api/auth/account');
  assert.equal(anonymous.status, 401);
  assert.deepEqual(ownedCounts(database, owner.user.id), full);
  assert.equal(jar.deleted, false);
}));
