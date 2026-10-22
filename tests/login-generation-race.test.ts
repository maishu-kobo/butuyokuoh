import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { decode } from 'next-auth/jwt';
import { call, cookieSink, db } from './regression-harness';
import { linkGoogleAccount } from '../src/lib/link-google-account';
import { hashPassword } from '../src/lib/auth';

const registerPath = '../src/app/api/auth/register/route.ts';
const loginPath = '../src/app/api/auth/login/route.ts';
const sessionCookie = 'authjs.session-token';

let exclusive: Promise<void> = Promise.resolve();

function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

type Compare = typeof bcrypt.compare;

async function duringPasswordCheck(action: () => Promise<void> | void, run: () => Promise<void>) {
  const original = bcrypt.compare;
  let started = false;
  const wrapped = async (
    password: string,
    hash: string,
    callback?: Parameters<Compare>[2],
    progress?: Parameters<Compare>[3],
  ) => {
    if (!started && callback === undefined) {
      started = true;
      await action();
    }
    return original(password, hash, callback, progress);
  };
  bcrypt.compare = wrapped as unknown as Compare;
  try {
    await run();
  } finally {
    bcrypt.compare = original;
  }
  assert.equal(started, true, 'verifyPassword did not run');
}

async function registerMember(email: string, password: string) {
  const cookies = await cookieSink();
  const created = await call(registerPath, 'POST', '/api/auth/register', { email, password });
  assert.equal(created.status, 200, created.text);
  cookies.value = undefined;
  cookies.deleted = false;
  return cookies;
}

async function commitLink(email: string, mode: 'clear' | 'replace') {
  const database = await db();
  if (mode === 'clear') {
    const linked = linkGoogleAccount(database, {
      email,
      googleId: `google-race-${email}`,
      name: '本人',
      emailVerified: true,
    });
    assert.equal(linked.ok, true, linked.ok ? '' : linked.reason);
    return;
  }
  const replacement = await hashPassword('replacement-secret');
  const updated = database.prepare(
    `UPDATE users
     SET password_hash = ?, session_generation = session_generation + 1
     WHERE LOWER(email) = ? AND account_type = 'member'`
  ).run(replacement, email);
  assert.equal(updated.changes, 1);
}

function cookiePair(setCookie: string) {
  return setCookie.split(';')[0];
}

async function credentialsSignIn(email: string, password: string) {
  const { GET, POST } = await import('../src/app/api/auth/[...nextauth]/route');
  const csrfResponse = await GET(new NextRequest('http://127.0.0.1/api/auth/csrf'));
  const csrfBody = JSON.parse(await csrfResponse.text()) as { csrfToken?: string };
  assert.equal(typeof csrfBody.csrfToken, 'string');
  const csrfCookie = csrfResponse.headers.getSetCookie().map(cookiePair).join('; ');
  assert.match(csrfCookie, /csrf/i);
  const response = await POST(new NextRequest('http://127.0.0.1/api/auth/callback/credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: csrfCookie,
    },
    body: new URLSearchParams({
      csrfToken: csrfBody.csrfToken!,
      email,
      password,
      callbackUrl: 'http://127.0.0.1/',
    }),
  }));
  const sessionValues = response.headers.getSetCookie()
    .map((entry) => {
      const pair = cookiePair(entry);
      if (!pair.startsWith(`${sessionCookie}=`) && !pair.startsWith(`${sessionCookie}.`)) return null;
      return decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
    })
    .filter((value): value is string => Boolean(value));
  let userId: unknown;
  let sessionGeneration: unknown;
  if (sessionValues.length > 0) {
    const claims = await decode({
      token: sessionValues[0],
      secret: process.env.AUTH_SECRET!,
      salt: sessionCookie,
    });
    userId = claims?.userId;
    sessionGeneration = claims?.sessionGeneration;
  }
  return { status: response.status, location: response.headers.get('location'), userId, sessionGeneration };
}

test('パスワード検証中に連携が確定したら /api/auth/login はトークンを出さない', async () => {
  await serial(async () => {
    const problems: string[] = [];
    for (const mode of ['clear', 'replace'] as const) {
      const email = `login-race-${mode}@example.test`;
      const cookies = await registerMember(email, 'secret1');
      await duringPasswordCheck(() => commitLink(email, mode), async () => {
        const loggedIn = await call(loginPath, 'POST', '/api/auth/login', { email, password: 'secret1' });
        const token = (loggedIn.json as { token?: string } | undefined)?.token;
        if (loggedIn.status !== 401 || token) {
          const { getUserIdFromToken, verifyToken } = await import('../src/lib/auth');
          const accepted = token ? getUserIdFromToken(token) : null;
          const generation = token ? verifyToken(token)?.sessionGeneration : undefined;
          problems.push(
            `login ${mode}: status ${loggedIn.status} token=${token ? 'issued' : 'absent'} accepted=${String(accepted)} generation=${String(generation)} cookie=${cookies.value ? 'set' : 'unset'}`
          );
        }
      });
    }
    assert.deepEqual(problems, []);
  });
});

test('パスワード検証中に連携が確定したら Credentials authorize はトークンを出さない', async () => {
  await serial(async () => {
    const problems: string[] = [];
    for (const mode of ['clear', 'replace'] as const) {
      const email = `credentials-race-${mode}@example.test`;
      await registerMember(email, 'secret1');
      await duringPasswordCheck(() => commitLink(email, mode), async () => {
        const signedIn = await credentialsSignIn(email, 'secret1');
        if (signedIn.userId !== undefined) {
          problems.push(
            `credentials ${mode}: status ${signedIn.status} location ${signedIn.location} userId=${String(signedIn.userId)} generation=${String(signedIn.sessionGeneration)}`
          );
        }
      });
    }
    assert.deepEqual(problems, []);
  });
});

test('競合が無いパスワードログインは従来どおりトークンを発行する', async () => {
  await serial(async () => {
    const email = 'login-no-race@example.test';
    const cookies = await registerMember(email, 'secret1');
    const loggedIn = await call(loginPath, 'POST', '/api/auth/login', {
      email: 'Login-No-Race@Example.test',
      password: 'secret1',
    });
    assert.equal(loggedIn.status, 200);
    const token = (loggedIn.json as { token: string }).token;
    const { getUserIdFromToken } = await import('../src/lib/auth');
    const database = await db();
    const member = database.prepare(
      "SELECT id FROM users WHERE email = ? AND account_type = 'member'"
    ).get(email) as { id: number };
    assert.equal(getUserIdFromToken(token), member.id);
    assert.equal(cookies.value, token);

    const signedIn = await credentialsSignIn(email, 'secret1');
    assert.equal(signedIn.userId, String(member.id));
    assert.equal(signedIn.sessionGeneration, 0);
  });
});

test('確認したあと世代が進んでも、署名はその読み取りの世代のまま', async () => {
  await serial(async () => {
    const email = 'pin-generation@example.test';
    await registerMember(email, 'secret1');
    const database = await db();
    const { installAuthTestHooks, getUserIdFromToken, verifyToken } = await import('../src/lib/auth');
    installAuthTestHooks({
      afterPasswordConfirmed() {
        database.prepare(
          'UPDATE users SET session_generation = session_generation + 5 WHERE email = ?'
        ).run(email);
      },
    });
    try {
      const loggedIn = await call(loginPath, 'POST', '/api/auth/login', { email, password: 'secret1' });
      assert.equal(loggedIn.status, 200);
      const token = (loggedIn.json as { token: string }).token;
      assert.equal(verifyToken(token)?.sessionGeneration, 0);
      assert.equal(getUserIdFromToken(token), null);

      const signedIn = await credentialsSignIn(email, 'secret1');
      assert.equal(signedIn.userId, String(
        (database.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id
      ));
      assert.equal(signedIn.sessionGeneration, 5);
      const stored = database.prepare(
        'SELECT session_generation FROM users WHERE email = ?'
      ).get(email) as { session_generation: number };
      assert.equal(stored.session_generation, 10);
    } finally {
      installAuthTestHooks(null);
    }
  });
});
