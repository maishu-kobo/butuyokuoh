import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { call, cookieSink, createMember, db, useUser } from './regression-harness';
import { isValidEmail, normalizeEmail } from '../src/lib/email';

const registerPath = '../src/app/api/auth/register/route.ts';
const loginPath = '../src/app/api/auth/login/route.ts';
const logoutPath = '../src/app/api/auth/logout/route.ts';
const tokenPath = '../src/app/api/auth/token/route.ts';
const itemsPath = '../src/app/api/items/route.ts';

test('email normalization rejects blanks and accepts a normal address', () => {
  assert.equal(normalizeEmail('  Foo@Example.COM '), 'foo@example.com');
  assert.equal(isValidEmail('foo@example.com'), true);
  assert.equal(isValidEmail('foo@example'), false);
  assert.equal(isValidEmail('foo bar@example.com'), false);
  assert.equal(isValidEmail(''), false);
});

test('register normalizes email, rejects bad input, and logs in regardless of case', async () => {
  const cookies = await cookieSink();
  const missing = await call(registerPath, 'POST', '/api/auth/register', { email: 'a@example.test' });
  assert.equal(missing.status, 400);

  const short = await call(registerPath, 'POST', '/api/auth/register', { email: 'a@example.test', password: '12345' });
  assert.equal(short.status, 400);

  const guestMail = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'person@guest.invalid', password: 'secret1',
  });
  assert.equal(guestMail.status, 400);

  const notString = await call(registerPath, 'POST', '/api/auth/register', { email: 1, password: 'secret1' });
  assert.equal(notString.status, 400);

  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email: '  Owner@Example.TEST ', password: 'secret1', name: 'オーナー',
  });
  assert.equal(created.status, 200);
  const createdBody = created.json as { user: { email: string; password_hash?: string; account_type: string }; token: string };
  assert.equal(createdBody.user.email, 'owner@example.test');
  assert.equal(createdBody.user.account_type, 'member');
  assert.equal(createdBody.user.password_hash, undefined);
  assert.equal(cookies.name, 'butuyokuoh_token');
  assert.equal(cookies.value, createdBody.token);
  assert.equal(cookies.options?.httpOnly, true);
  assert.equal(cookies.options?.sameSite, 'lax');
  assert.equal(cookies.options?.path, '/');
  assert.equal(cookies.options?.secure, false);
  assert.equal(cookies.options?.maxAge, 7 * 24 * 60 * 60);

  const duplicate = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'OWNER@example.test', password: 'secret1',
  });
  assert.equal(duplicate.status, 400);

  const wrong = await call(loginPath, 'POST', '/api/auth/login', { email: 'owner@example.test', password: 'nope12' });
  assert.equal(wrong.status, 401);

  const loggedIn = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'Owner@Example.test', password: 'secret1',
  });
  assert.equal(loggedIn.status, 200);
  const loggedBody = loggedIn.json as { user: { email: string; password_hash?: string }; token: string };
  assert.equal(loggedBody.user.email, 'owner@example.test');
  assert.equal(loggedBody.user.password_hash, undefined);
  assert.equal(cookies.value, loggedBody.token);

  const loggedOut = await call(logoutPath, 'POST', '/api/auth/logout');
  assert.equal(loggedOut.status, 200);
  assert.equal(cookies.deleted, true);
});

test('a logged-out caller is rejected and a member token cannot name a guest', async () => {
  await useUser(null);
  for (const path of ['/api/items', '/api/budget', '/api/export', '/api/stats', '/api/purchased', '/api/trash', '/api/categories', '/api/comparison-groups', '/api/notification-settings', '/api/auth/token']) {
    const response = await call(itemsPath.replace('items/route.ts', path.slice('/api/'.length) + '/route.ts'), 'GET', path);
    assert.equal(response.status, 401, path);
    assert.equal((response.json as { code: string }).code, 'SESSION_REQUIRED');
  }

  const member = await createMember('token-owner');
  const tokenResponse = await call(tokenPath, 'GET', '/api/auth/token');
  assert.equal(tokenResponse.status, 200);
  const token = (tokenResponse.json as { token: string }).token;
  const { getUserIdFromToken, verifyToken } = await import('../src/lib/auth');
  assert.equal(verifyToken(token)?.userId, member.id);
  assert.equal(getUserIdFromToken(token), member.id);
  assert.equal(verifyToken('not-a-token'), null);

  const database = await db();
  const guestId = Number(database.prepare(
    "INSERT INTO users (email, name, account_type) VALUES ('guest-token@guest.invalid', 'ゲスト', 'guest')",
  ).run().lastInsertRowid);
  const forged = jwt.sign({ userId: guestId, email: 'guest-token@guest.invalid' }, process.env.JWT_SECRET!);
  assert.equal(getUserIdFromToken(forged), null);
});

test('production refuses the auth test hook', async () => {
  const env = process.env as { NODE_ENV?: string };
  const previous = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    const { installAuthTestHooks } = await import('../src/lib/auth');
    assert.throws(() => installAuthTestHooks({ user: null }), /unavailable in production/);
  } finally {
    env.NODE_ENV = previous;
  }
});
