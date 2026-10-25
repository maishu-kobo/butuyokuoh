import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, cookieSink, db } from './regression-harness';
import { hashPassword } from '../src/lib/auth';
import { linkGoogleAccount } from '../src/lib/link-google-account';

const registerPath = '../src/app/api/auth/register/route.ts';
const loginPath = '../src/app/api/auth/login/route.ts';

test('password signup and login keep normalization, and a missing hash is 401', async () => {
  await cookieSink();
  const guestMail = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'person@guest.invalid',
    password: 'secret1',
  });
  assert.equal(guestMail.status, 400);

  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email: '  Keeper@Example.TEST ',
    password: 'secret1',
    name: '本人',
  });
  assert.equal(created.status, 200);
  const createdBody = created.json as { user: { email: string; account_type: string; password_hash?: string } };
  assert.equal(createdBody.user.email, 'keeper@example.test');
  assert.equal(createdBody.user.account_type, 'member');
  assert.equal(createdBody.user.password_hash, undefined);

  const loggedIn = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'KEEPER@example.test',
    password: 'secret1',
  });
  assert.equal(loggedIn.status, 200);
  assert.equal((loggedIn.json as { user: { email: string } }).user.email, 'keeper@example.test');

  const database = await db();
  const guestHash = await hashPassword('secret1');
  database.prepare(
    "INSERT INTO users (email, password_hash, name, account_type) VALUES ('guest-login@example.test', ?, 'ゲスト', 'guest')"
  ).run(guestHash);
  const guestLogin = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'guest-login@example.test',
    password: 'secret1',
  });
  assert.equal(guestLogin.status, 401);

  database.prepare(
    "INSERT INTO users (email, password_hash, account_type) VALUES ('no-hash@example.test', NULL, 'member')"
  ).run();
  const noHash = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'No-Hash@Example.test',
    password: 'secret1',
  });
  assert.equal(noHash.status, 401);
});

test('an unverified signup in another letter case cannot keep the Google identity', async () => {
  await cookieSink();
  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'Victim@Takeover.TEST',
    password: 'attacker-secret',
  });
  assert.equal(created.status, 200);

  const database = await db();
  const before = database.prepare(
    "SELECT id FROM users WHERE LOWER(email) = 'victim@takeover.test' AND account_type = 'member' ORDER BY id LIMIT 1"
  ).get() as { id: number };

  const linked = linkGoogleAccount(database, {
    email: 'VICTIM@takeover.test',
    googleId: 'google-victim-takeover',
    name: '本人',
    emailVerified: true,
  });
  assert.deepEqual(linked, { ok: true, userId: before.id });

  const rows = database.prepare(
    "SELECT id, password_hash, google_id, account_type FROM users WHERE LOWER(email) = 'victim@takeover.test' ORDER BY id"
  ).all() as { id: number; password_hash: string | null; google_id: string | null; account_type: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].password_hash, null);
  assert.equal(rows[0].google_id, 'google-victim-takeover');
  assert.equal(rows[0].account_type, 'member');

  const login = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'victim@takeover.test',
    password: 'attacker-secret',
  });
  assert.equal(login.status, 401);
});

test('a legacy mixed-case password row cannot take over LOWER(email) login', async () => {
  await cookieSink();
  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'legacy@mixed-case.test',
    password: 'legacy-secret',
  });
  assert.equal(created.status, 200);

  const database = await db();
  database.prepare(
    "UPDATE users SET email = 'Legacy@Mixed-Case.TEST' WHERE LOWER(email) = 'legacy@mixed-case.test'"
  ).run();

  const linked = linkGoogleAccount(database, {
    email: 'legacy@mixed-case.test',
    googleId: 'google-legacy-mixed',
    name: '本人',
    emailVerified: true,
  });
  assert.equal(linked.ok, true);

  const loginTarget = database.prepare(
    "SELECT id, password_hash, google_id FROM users WHERE LOWER(email) = ? AND account_type = 'member' ORDER BY id LIMIT 1"
  ).get('legacy@mixed-case.test') as { id: number; password_hash: string | null; google_id: string | null };
  assert.equal(loginTarget.password_hash, null);
  assert.equal(loginTarget.google_id, 'google-legacy-mixed');
  if (!linked.ok) return;
  assert.equal(linked.userId, loginTarget.id);

  const login = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'LEGACY@mixed-case.test',
    password: 'legacy-secret',
  });
  assert.equal(login.status, 401);
});
