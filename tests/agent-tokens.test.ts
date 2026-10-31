import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { call, createMember, db, setTestUser } from './regression-harness';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const tokenIdPath = '../src/app/api/agent-tokens/[id]/route.ts';
const undoPath = '../src/app/api/agent-tokens/[id]/undo/route.ts';
const auditPath = '../src/app/api/agent-tokens/[id]/audit/route.ts';
const agentMePath = '../src/app/api/agent/v1/me/route.ts';
const passwordPath = '../src/app/api/auth/password/route.ts';
const logoutPath = '../src/app/api/auth/logout/route.ts';
const itemsPath = '../src/app/api/items/route.ts';
const mePath = '../src/app/api/auth/me/route.ts';
const accountPath = '../src/app/api/auth/account/route.ts';

let exclusive: Promise<void> = Promise.resolve();

function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

async function createToken(
  scopes: ('read' | 'write')[] = ['read', 'write'],
  expiresInDays = 90,
  name = 'test-agent',
) {
  const created = await call(tokensPath, 'POST', '/api/agent-tokens', {
    name,
    scopes,
    expiresInDays,
  });
  assert.equal(created.status, 201, created.text);
  const body = created.json as {
    token: string;
    record: { id: number; token_prefix: string; scopes: string[]; active: boolean };
  };
  assert.ok(body.token.startsWith('byoagt_'));
  assert.ok(body.record.token_prefix.startsWith('byoagt_'));
  assert.ok(!JSON.stringify(body.record).includes(body.token.slice(12)));
  return body;
}

test('agent token: hash-only storage, prefix, create/list/revoke', () => serial(async () => {
  const user = await createMember('agent-crud');
  const created = await createToken(['read'], 30, 'Cursor');
  const database = await db();
  const row = database.prepare('SELECT * FROM agent_tokens WHERE id = ?').get(created.record.id) as {
    token_hash: string;
    token_prefix: string;
    name: string;
  };
  assert.equal(row.name, 'Cursor');
  assert.equal(row.token_prefix, created.record.token_prefix);
  assert.notEqual(row.token_hash, created.token);
  assert.ok(!row.token_hash.includes(created.token));

  const listed = await call(tokensPath, 'GET', '/api/agent-tokens');
  assert.equal(listed.status, 200, listed.text);
  const tokens = (listed.json as { tokens: { id: number; active: boolean }[] }).tokens;
  assert.ok(tokens.some((t) => t.id === created.record.id && t.active));
  assert.ok(!JSON.stringify(listed.json).includes(created.token));

  const revoked = await call(tokenIdPath, 'DELETE', `/api/agent-tokens/${created.record.id}`, undefined, {
    id: String(created.record.id),
  });
  assert.equal(revoked.status, 200, revoked.text);

  const me = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${created.token}`,
  });
  assert.equal(me.status, 401, me.text);
  await setTestUser(user);
}));

test('agent token: scope enforcement on requireAgentToken', () => serial(async () => {
  await createMember('agent-scope');
  const readOnly = await createToken(['read'], 90, 'read-only');
  const writeOnly = await createToken(['write'], 90, 'write-only');

  const ok = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${readOnly.token}`,
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((ok.json as { scopes: string[] }).scopes.includes('read'), true);

  const denied = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${writeOnly.token}`,
  });
  assert.equal(denied.status, 403, denied.text);
  assert.equal((denied.json as { code: string }).code, 'AGENT_SCOPE_DENIED');
}));

test('agent token: expiry rejects auth', () => serial(async () => {
  await createMember('agent-expiry');
  const created = await createToken(['read'], 1, 'expiring');
  const database = await db();
  database.prepare(
    `UPDATE agent_tokens SET expires_at = datetime('now', '-1 day') WHERE id = ?`,
  ).run(created.record.id);

  const me = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${created.token}`,
  });
  assert.equal(me.status, 401, me.text);
}));

test('agent token: rate limits for reads', () => serial(async () => {
  await createMember('agent-rate');
  const created = await createToken(['read'], 90, 'rate');
  const { consumeAgentRate } = await import('../src/lib/agent-token');
  const database = await db();
  for (let i = 0; i < 60; i++) {
    consumeAgentRate(created.record.id, 'read', database, 1_000_000);
  }
  assert.throws(
    () => consumeAgentRate(created.record.id, 'read', database, 1_000_000),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'AGENT_RATE_LIMITED',
  );
  for (let i = 0; i < 20; i++) {
    consumeAgentRate(created.record.id, 'add', database, 2_000_000);
  }
  assert.throws(
    () => consumeAgentRate(created.record.id, 'add', database, 2_000_000),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'AGENT_RATE_LIMITED',
  );
  for (let i = 0; i < 10; i++) {
    consumeAgentRate(created.record.id, 'add_url', database, 3_000_000);
  }
  assert.throws(
    () => consumeAgentRate(created.record.id, 'add_url', database, 3_000_000),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'AGENT_RATE_LIMITED',
  );
  for (let i = 0; i < 200; i++) {
    consumeAgentRate(created.record.id, 'add_day', database, 4_000_000);
  }
  assert.throws(
    () => consumeAgentRate(created.record.id, 'add_day', database, 4_000_000),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'AGENT_RATE_LIMITED',
  );
}));

test('agent token: password change revokes all; logout does not', () => serial(async () => {
  const { hashPassword, installAuthTestHooks } = await import('../src/lib/auth');
  const database = await db();
  const email = `pw-revoke-${Date.now()}@example.test`;
  const passwordHash = await hashPassword('secret1');
  const userId = Number(database.prepare(
    'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
  ).run(email, 'pw', passwordHash).lastInsertRowid);
  const user = database.prepare(
    'SELECT id, email, name, created_at, account_type FROM users WHERE id = ?',
  ).get(userId) as Awaited<ReturnType<typeof createMember>>;
  await setTestUser(user);

  const jar: { value?: string; deleted?: boolean } = {};
  const { MEMBER_TOKEN_COOKIE } = await import('../src/lib/cookie-policy');
  installAuthTestHooks({
    user,
    cookies: {
      set(_name, value) {
        jar.value = value;
        jar.deleted = false;
      },
      delete() {
        jar.deleted = true;
        jar.value = undefined;
      },
      get(name) {
        if (name !== MEMBER_TOKEN_COOKIE || jar.deleted) return undefined;
        return jar.value;
      },
    },
  });

  const a = await createToken(['read'], 90, 'a');
  const b = await createToken(['write'], 90, 'b');

  const logout = await call(logoutPath, 'POST', '/api/auth/logout', undefined, undefined, {
    origin: 'http://localhost',
  }, 'http://localhost/api/auth/logout');
  assert.equal(logout.status, 200, logout.text);

  // ログアウト後もエージェント用トークンは有効（会員セッションは別）。
  await setTestUser(null);
  const stillOk = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${a.token}`,
  });
  assert.equal(stillOk.status, 200, stillOk.text);

  await setTestUser(user);
  installAuthTestHooks({
    user,
    cookies: {
      set(_name, value) {
        jar.value = value;
        jar.deleted = false;
      },
      delete() {
        jar.deleted = true;
        jar.value = undefined;
      },
      get(name) {
        if (name !== MEMBER_TOKEN_COOKIE || jar.deleted) return undefined;
        return jar.value;
      },
    },
  });

  const changed = await call(passwordPath, 'PUT', '/api/auth/password', {
    currentPassword: 'secret1',
    newPassword: 'secret2',
  });
  assert.equal(changed.status, 200, changed.text);

  const afterA = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${a.token}`,
  });
  const afterB = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${b.token}`,
  });
  assert.equal(afterA.status, 401, afterA.text);
  assert.equal(afterB.status, 401, afterB.text);
}));

test('agent token: screen APIs reject agent bearer and cookie', () => serial(async () => {
  const user = await createMember('agent-screen');
  const created = await createToken(['read', 'write'], 90, 'screen');

  await setTestUser(null);
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { MEMBER_TOKEN_COOKIE } = await import('../src/lib/cookie-policy');
  installAuthTestHooks({
    user: null,
    session: null,
    cookies: {
      set() {},
      delete() {},
      get(name) {
        if (name === MEMBER_TOKEN_COOKIE) return created.token;
        return undefined;
      },
    },
  });

  const me = await call(mePath, 'GET', '/api/auth/me');
  assert.equal(me.status, 401, me.text);

  const items = await call(itemsPath, 'GET', '/api/items', undefined, undefined, {
    Authorization: `Bearer ${created.token}`,
  });
  assert.equal(items.status, 401, items.text);

  const { getCurrentUser, getUserIdFromToken } = await import('../src/lib/auth');
  assert.equal(await getCurrentUser(), null);
  assert.equal(getUserIdFromToken(created.token), null);

  installAuthTestHooks(null);
  await setTestUser(user);
}));

test('agent token: guests cannot create tokens', () => serial(async () => {
  const database = await db();
  const guestId = Number(database.prepare(
    "INSERT INTO users (email, name, account_type) VALUES (?, 'ゲスト', 'guest')",
  ).run(`guest-agent-${Date.now()}@guest.invalid`).lastInsertRowid);
  await setTestUser({
    id: guestId,
    account_type: 'guest',
    email: null,
    name: 'ゲスト',
    created_at: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const created = await call(tokensPath, 'POST', '/api/agent-tokens', {
    name: 'nope',
    scopes: ['read'],
  });
  assert.ok(created.status === 401 || created.status === 403, created.text);
}));

test('agent token: added-by marker and bulk trash undo', () => serial(async () => {
  const user = await createMember('agent-marker');
  const created = await createToken(['write'], 90, 'adder');
  const database = await db();
  const itemId = Number(database.prepare(`
    INSERT INTO items (user_id, name, url, source, added_by_agent_token_id)
    VALUES (?, ?, ?, 'other', ?)
  `).run(user.id, 'agent item', `https://example.test/agent-${created.record.id}`, created.record.id).lastInsertRowid);

  const listed = await call(itemsPath, 'GET', '/api/items');
  assert.equal(listed.status, 200, listed.text);
  const items = listed.json as { id: number; added_by_agent_token_id: number | null }[];
  const found = items.find((item) => item.id === itemId);
  assert.ok(found);
  assert.equal(found!.added_by_agent_token_id, created.record.id);

  const undone = await call(undoPath, 'POST', `/api/agent-tokens/${created.record.id}/undo`, undefined, {
    id: String(created.record.id),
  });
  assert.equal(undone.status, 200, undone.text);
  assert.equal((undone.json as { moved: number }).moved, 1);
  const row = database.prepare('SELECT deleted_at FROM items WHERE id = ?').get(itemId) as { deleted_at: string | null };
  assert.ok(row.deleted_at);
}));

test('agent token: audit log omits token values and keeps entries', () => serial(async () => {
  await createMember('agent-audit');
  const created = await createToken(['read'], 90, 'audited');
  await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${created.token}`,
  });
  const audit = await call(auditPath, 'GET', `/api/agent-tokens/${created.record.id}/audit`, undefined, {
    id: String(created.record.id),
  });
  assert.equal(audit.status, 200, audit.text);
  const text = JSON.stringify(audit.json);
  assert.ok(!text.includes(created.token));
  const entries = (audit.json as { entries: { action: string }[] }).entries;
  assert.ok(entries.some((entry) => entry.action === 'token.create'));
  assert.ok(entries.some((entry) => entry.action === 'agent.me'));
}));

test('agent token: account deletion removes agent tables', () => serial(async () => {
  const user = await createMember('agent-delete');
  const created = await createToken(['read'], 90, 'gone');
  const database = await db();
  database.prepare(`
    INSERT INTO items (user_id, name, url, source, added_by_agent_token_id)
    VALUES (?, 'x', ?, 'other', ?)
  `).run(user.id, `https://example.test/del-${created.record.id}`, created.record.id);

  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { MEMBER_TOKEN_COOKIE } = await import('../src/lib/cookie-policy');
  installAuthTestHooks({
    user,
    cookies: {
      set() {},
      delete() {},
      get(name) {
        if (name === MEMBER_TOKEN_COOKIE) return 'unused';
        return undefined;
      },
    },
  });

  const deleted = await call(accountPath, 'DELETE', '/api/auth/account');
  assert.equal(deleted.status, 200, deleted.text);

  const tokens = database.prepare('SELECT COUNT(*) AS c FROM agent_tokens WHERE user_id = ?').get(user.id) as { c: number };
  const audits = database.prepare('SELECT COUNT(*) AS c FROM agent_audit_log WHERE user_id = ?').get(user.id) as { c: number };
  const users = database.prepare('SELECT COUNT(*) AS c FROM users WHERE id = ?').get(user.id) as { c: number };
  assert.equal(tokens.c, 0);
  assert.equal(audits.c, 0);
  assert.equal(users.c, 0);
  installAuthTestHooks(null);
}));

test('agent token: max expiry is 365 days', () => serial(async () => {
  await createMember('agent-max-days');
  const tooLong = await call(tokensPath, 'POST', '/api/agent-tokens', {
    name: 'long',
    scopes: ['read'],
    expiresInDays: 366,
  });
  assert.equal(tooLong.status, 400, tooLong.text);
  const ok = await call(tokensPath, 'POST', '/api/agent-tokens', {
    name: 'year',
    scopes: ['read'],
    expiresInDays: 365,
  });
  assert.equal(ok.status, 201, ok.text);
}));

test('agent token: requireAgentToken helper rejects missing bearer', () => serial(async () => {
  const { requireAgentToken } = await import('../src/lib/agent-token');
  const { GuestError } = await import('../src/lib/guest');
  const request = new NextRequest('http://127.0.0.1/api/agent/v1/me');
  await assert.rejects(
    () => requireAgentToken(request, 'read'),
    (error: unknown) => error instanceof GuestError && error.status === 401,
  );
}));
