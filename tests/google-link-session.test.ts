import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { decode, encode } from 'next-auth/jwt';
import { call, cookieSink, db } from './regression-harness';
import { linkGoogleAccount } from '../src/lib/link-google-account';

const registerPath = '../src/app/api/auth/register/route.ts';
const loginPath = '../src/app/api/auth/login/route.ts';
const sessionCookie = 'authjs.session-token';

async function nextAuthToken(claims: Record<string, unknown>) {
  return encode({
    token: claims,
    secret: process.env.AUTH_SECRET!,
    salt: sessionCookie,
  });
}

function cookieValue(setCookie: string, name: string) {
  const prefix = `${name}=`;
  if (!setCookie.startsWith(prefix)) return null;
  return decodeURIComponent(setCookie.slice(prefix.length).split(';')[0]);
}

test('リンク前の自前JWTとNextAuthのtoken.userIdは確認済みGoogle連携のあと拒否される', async () => {
  await cookieSink();
  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'PreLink@Session.TEST',
    password: 'attacker-secret',
    name: '先取り',
  });
  assert.equal(created.status, 200);
  const createdBody = created.json as { token: string; user: { id: number; email: string } };
  const registrationToken = createdBody.token;
  const userId = createdBody.user.id;

  const preLinkSession = await nextAuthToken({
    sub: String(userId),
    email: createdBody.user.email,
    userId: String(userId),
  });

  const database = await db();
  const linked = linkGoogleAccount(database, {
    email: 'prelink@session.test',
    googleId: 'google-prelink-session',
    name: '本人',
    emailVerified: true,
  });
  assert.deepEqual(linked, { ok: true, userId });

  const { getUserIdFromToken, generateToken } = await import('../src/lib/auth');
  const member = database.prepare(
    'SELECT id, email, name, created_at, account_type FROM users WHERE id = ?'
  ).get(userId) as {
    id: number;
    email: string;
    name: string | null;
    created_at: string;
    account_type: 'member';
  };
  // 連携後に会員行を見て発行し直したトークンは本人の新しいセッションとして残す。
  assert.equal(getUserIdFromToken(generateToken(member)), userId);

  const { GET: readSession } = await import('../src/app/api/auth/[...nextauth]/route');
  const postLinkSession = await nextAuthToken({
    sub: String(userId),
    email: member.email,
    userId: String(userId),
    sessionGeneration: 1,
  });
  const postLinkResponse = await readSession(new NextRequest('http://127.0.0.1/api/auth/session', {
    headers: { cookie: `${sessionCookie}=${postLinkSession}` },
  }));
  const postLinkBody = JSON.parse(await postLinkResponse.text()) as { user?: { id?: string } };
  assert.equal(postLinkBody.user?.id, String(userId));

  const problems: string[] = [];
  if (getUserIdFromToken(registrationToken) !== null) {
    problems.push(`app jwt still accepted for user ${getUserIdFromToken(registrationToken)}`);
  }

  const { GET: readCategories } = await import('../src/app/api/extension-categories/route');
  const read = await readCategories(new NextRequest('http://127.0.0.1/api/extension-categories', {
    headers: { authorization: `Bearer ${registrationToken}` },
  }));
  if (read.status !== 401) problems.push(`extension read status ${read.status}`);

  const { POST: addItem } = await import('../src/app/api/extension-add/route');
  const write = await addItem(new NextRequest('http://127.0.0.1/api/extension-add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: registrationToken,
      item: {
        name: '奪った商品',
        url: 'https://example.test/stolen',
        price: 100,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    }),
  }));
  if (write.status !== 401) problems.push(`extension write status ${write.status}`);
  const stolen = database.prepare(
    "SELECT id FROM items WHERE user_id = ? AND url = 'https://example.test/stolen'"
  ).get(userId);
  if (stolen) problems.push('pre-link jwt wrote an item');

  const sessionResponse = await readSession(new NextRequest('http://127.0.0.1/api/auth/session', {
    headers: { cookie: `${sessionCookie}=${preLinkSession}` },
  }));
  const sessionText = await sessionResponse.text();
  const sessionBody = sessionText ? JSON.parse(sessionText) as { user?: { id?: string } } : null;
  if (sessionBody?.user?.id !== undefined) {
    problems.push(`nextauth token.userId still accepted as ${sessionBody.user.id}`);
  }

  const refreshed = sessionResponse.headers.getSetCookie()
    .map((entry) => cookieValue(entry, sessionCookie))
    .find((value) => value);
  if (!refreshed) {
    problems.push('session endpoint did not re-sign the cookie');
  } else {
    const refreshedClaims = await decode({
      token: refreshed,
      secret: process.env.AUTH_SECRET!,
      salt: sessionCookie,
    });
    if (refreshedClaims?.userId !== undefined) {
      problems.push(`re-signed nextauth token kept userId ${String(refreshedClaims.userId)}`);
    }
  }

  assert.deepEqual(problems, []);
});

test('パスワードログインは従来どおり会員トークンを発行できる', async () => {
  await cookieSink();
  const created = await call(registerPath, 'POST', '/api/auth/register', {
    email: 'Still-Valid@Login.TEST',
    password: 'secret1',
  });
  assert.equal(created.status, 200);
  const createdBody = created.json as { token: string; user: { id: number } };
  const { getUserIdFromToken } = await import('../src/lib/auth');
  assert.equal(getUserIdFromToken(createdBody.token), createdBody.user.id);

  const loggedIn = await call(loginPath, 'POST', '/api/auth/login', {
    email: 'still-valid@login.test',
    password: 'secret1',
  });
  assert.equal(loggedIn.status, 200);
  const loggedBody = loggedIn.json as { token: string; user: { id: number } };
  assert.equal(loggedBody.user.id, createdBody.user.id);
  assert.equal(getUserIdFromToken(loggedBody.token), loggedBody.user.id);
});
