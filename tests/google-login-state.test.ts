import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:3000';

// match: Google が state をそのまま返す。missing: state が無い。tampered: でたらめな値が付いている。
// foreign: 同じサーバが別のブラウザに発行した本物の state が付いている（ログイン CSRF の形）。
type Mode = 'match' | 'missing' | 'tampered' | 'foreign';

type Probe = {
  authorizeHost: string;
  authorizeParams: Record<string, string>;
  signinCookies: string[];
  callbackStatus: number;
  callbackLocation: string;
  sessionCookie: boolean;
  tokenRequests: number;
  members: number;
};

// 本物の Google には出ない。子プロセスの fetch を差し替えて、認可の開始から戻りまでを通す。
function probe(mode: Mode): Probe {
  const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-google-state-'));
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG,
    AUTH_SECRET: 'google-login-state-auth-secret',
    NEXTAUTH_SECRET: 'google-login-state-auth-secret',
    AUTH_URL: origin,
    NEXTAUTH_URL: origin,
    JWT_SECRET: 'google-login-state-jwt-secret',
    GOOGLE_CLIENT_ID: 'google-login-state-client',
    GOOGLE_CLIENT_SECRET: 'google-login-state-secret',
    BUTUYOKUOH_DB_PATH: join(directory, 'test.sqlite'),
    PROBE_MODE: mode,
    PROBE_ORIGIN: origin,
  };

  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { NextRequest } from 'next/server';

    const origin = process.env.PROBE_ORIGIN;
    const mode = process.env.PROBE_MODE;
    const issuer = 'https://accounts.google.com';
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';
    let tokenRequests = 0;

    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === issuer + '/.well-known/openid-configuration') {
        return json({
          issuer,
          authorization_endpoint: issuer + '/o/oauth2/v2/auth',
          token_endpoint: tokenEndpoint,
          userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['plain', 'S256'],
        });
      }
      if (url === tokenEndpoint) {
        tokenRequests += 1;
        const now = Math.floor(Date.now() / 1000);
        const idToken = [
          part({ alg: 'RS256', typ: 'JWT', kid: 'probe' }),
          part({
            iss: issuer,
            aud: process.env.GOOGLE_CLIENT_ID,
            sub: 'google-login-state-sub',
            email: 'state-probe@example.test',
            email_verified: true,
            name: 'State Probe',
            iat: now,
            exp: now + 600,
          }),
          Buffer.from('not-a-real-signature').toString('base64url'),
        ].join('.');
        return json({ access_token: 'probe-access-token', token_type: 'Bearer', expires_in: 600, id_token: idToken });
      }
      throw new Error('unexpected fetch: ' + url);
    };

    const loaded = await import('./src/auth.ts');
    const handlers = loaded.handlers ?? loaded.default?.handlers;
    if (!handlers?.GET || !handlers?.POST) throw new Error('auth handlers missing');

    // ブラウザ1つ分の Cookie。
    const browser = () => {
      const jar = new Map();
      const keep = (response) => {
        for (const line of response.headers.getSetCookie()) {
          const pair = line.split(';')[0];
          const at = pair.indexOf('=');
          const name = pair.slice(0, at);
          const value = pair.slice(at + 1);
          if (value === '' || /max-age=0/i.test(line)) jar.delete(name);
          else jar.set(name, value);
        }
      };
      const cookieHeader = () => [...jar].map(([name, value]) => name + '=' + value).join('; ');
      return { jar, keep, cookieHeader };
    };

    // そのブラウザでログインを始め、Google へ送る URL を返す。
    const begin = async ({ keep, cookieHeader }) => {
      const csrf = await handlers.GET(new NextRequest(origin + '/api/auth/csrf'));
      keep(csrf);
      const { csrfToken } = await csrf.json();
      const signin = await handlers.POST(new NextRequest(origin + '/api/auth/signin/google', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
        body: new URLSearchParams({ csrfToken, callbackUrl: '/' }).toString(),
      }));
      keep(signin);
      return new URL(signin.headers.get('location') ?? '');
    };

    const mine = browser();
    const authorize = await begin(mine);
    const signinCookies = [...mine.jar.keys()].sort();

    const back = new URL(origin + '/api/auth/callback/google');
    back.searchParams.set('code', 'probe-code');
    const issued = authorize.searchParams.get('state');
    if (mode === 'match' && issued) back.searchParams.set('state', issued);
    if (mode === 'tampered') back.searchParams.set('state', 'state-chosen-by-someone-else');
    if (mode === 'foreign') {
      const foreign = (await begin(browser())).searchParams.get('state');
      if (!foreign || foreign === issued) throw new Error('another browser was not issued its own state');
      back.searchParams.set('state', foreign);
    }

    const callback = await handlers.GET(new NextRequest(back, { headers: { cookie: mine.cookieHeader() } }));
    mine.keep(callback);

    const database = await import('./src/lib/db.ts');
    const getDb = database.getDb ?? database.default?.getDb;
    if (!getDb) throw new Error('getDb missing');
    const members = getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE account_type = 'member'").get().n;

    process.stdout.write(JSON.stringify({
      authorizeHost: authorize.host,
      authorizeParams: Object.fromEntries(authorize.searchParams),
      signinCookies,
      callbackStatus: callback.status,
      callbackLocation: callback.headers.get('location') ?? '',
      sessionCookie: mine.jar.has('authjs.session-token'),
      tokenRequests,
      members,
    }));
  `], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `state probe exited ${result.status}`);
  }
  return JSON.parse(result.stdout) as Probe;
}

test('the Google sign-in request carries state and S256 PKCE, and asks only for the login scopes', () => {
  const { authorizeHost, authorizeParams, signinCookies } = probe('match');
  assert.equal(authorizeHost, 'accounts.google.com');
  assert.equal(typeof authorizeParams.state, 'string');
  assert.notEqual(authorizeParams.state ?? '', '');
  assert.notEqual(authorizeParams.code_challenge ?? '', '');
  assert.equal(authorizeParams.code_challenge_method, 'S256');
  assert.equal(authorizeParams.scope, 'openid profile email');
  assert.equal(authorizeParams.redirect_uri, `${origin}/api/auth/callback/google`);
  assert.equal(signinCookies.includes('authjs.state'), true);
  assert.equal(signinCookies.includes('authjs.pkce.code_verifier'), true);
});

test('a callback that returns the issued state completes the Google login', () => {
  const result = probe('match');
  assert.equal(result.callbackStatus, 302);
  assert.equal(result.callbackLocation, `${origin}/`);
  assert.equal(result.tokenRequests, 1);
  assert.equal(result.sessionCookie, true);
  assert.equal(result.members, 1);
});

test('a callback with a missing or different state is refused before the token exchange', () => {
  for (const mode of ['missing', 'tampered', 'foreign'] as const) {
    const result = probe(mode);
    assert.equal(result.tokenRequests, 0, mode);
    assert.equal(result.sessionCookie, false, mode);
    assert.equal(result.members, 0, mode);
    assert.match(result.callbackLocation, /[?&]error=/, mode);
  }
});
