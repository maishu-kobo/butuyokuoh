import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { encode } from 'next-auth/jwt';
import { call, db, setTestUser } from './regression-harness';

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

  const loggedOut = await call(logoutPath, 'POST', '/api/auth/logout');
  assert.equal(loggedOut.status, 200);
  assert.equal((loggedOut.json as { success?: boolean }).success, true);
  assert.equal(jar.deleted, true);

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

  const uploadDir = mkdtempSync(join(tmpdir(), 'butuyokuoh-account-uploads-'));
  const previousUploadDir = process.env.BUTUYOKUOH_UPLOAD_DIR;
  process.env.BUTUYOKUOH_UPLOAD_DIR = uploadDir;
  const ownerFile = join(uploadDir, `${owner.user.id}_1710000000000.jpg`);
  const otherFile = join(uploadDir, `${other.user.id}_1710000000000.png`);
  const lookalike = join(uploadDir, `${owner.user.id}9_1710000000000.jpg`);
  const note = join(uploadDir, 'readme.txt');
  writeFileSync(ownerFile, 'owner-image');
  writeFileSync(otherFile, 'other-image');
  writeFileSync(lookalike, 'not-this-user');
  writeFileSync(note, 'keep');

  try {
    present(jar, owner.token);
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
    assert.equal(existsSync(otherFile), true);
    assert.equal(existsSync(lookalike), true);
    assert.equal(existsSync(note), true);

    const { getUserIdFromToken } = await import('../src/lib/auth');
    assert.equal(getUserIdFromToken(owner.token), null);
    assert.equal(getUserIdFromToken(other.token), other.user.id);
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
    assert.deepEqual(ownedCounts(database, recreated.user.id), empty);

    present(jar, owner.token);
    const again = await call(accountPath, 'DELETE', '/api/auth/account');
    assert.equal(again.status, 401);
    assert.deepEqual(ownedCounts(database, other.user.id), full);
    assert.equal(existsSync(otherFile), true);
  } finally {
    if (previousUploadDir === undefined) delete process.env.BUTUYOKUOH_UPLOAD_DIR;
    else process.env.BUTUYOKUOH_UPLOAD_DIR = previousUploadDir;
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
