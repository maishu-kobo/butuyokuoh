import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LoginForm from '../src/components/LoginForm';
import GuestBanner from '../src/components/GuestBanner';
import { AuthContext } from '../src/components/AuthProvider';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type GoogleEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

function providerCatalog(google: GoogleEnv): Record<string, { id?: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-google-login-'));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG,
    AUTH_SECRET: 'google-login-availability-auth-secret',
    NEXTAUTH_SECRET: 'google-login-availability-auth-secret',
    AUTH_URL: 'http://localhost:3000',
    NEXTAUTH_URL: 'http://localhost:3000',
    JWT_SECRET: 'google-login-availability-jwt-secret',
    BUTUYOKUOH_DB_PATH: join(directory, 'test.sqlite'),
  };
  if ('GOOGLE_CLIENT_ID' in google) env.GOOGLE_CLIENT_ID = google.GOOGLE_CLIENT_ID;
  if ('GOOGLE_CLIENT_SECRET' in google) env.GOOGLE_CLIENT_SECRET = google.GOOGLE_CLIENT_SECRET;

  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { NextRequest } from 'next/server';
    const loaded = await import('./src/auth.ts');
    const handlers = loaded.handlers ?? loaded.default?.handlers;
    if (!handlers?.GET) throw new Error('auth handlers missing');
    const response = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/providers'));
    if (!response.ok) throw new Error('providers status ' + response.status);
    process.stdout.write(await response.text());
  `], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `providers probe exited ${result.status}`);
  }
  return JSON.parse(result.stdout) as Record<string, { id?: string }>;
}

function authValue(googleLogin: boolean, guest: boolean) {
  return {
    user: guest
      ? { id: 1, account_type: 'guest' as const, email: null, name: 'ゲスト', expiresAt: '2030-01-01T00:00:00.000Z' }
      : null,
    token: null,
    loading: false,
    isGuest: guest,
    guestEnabled: false,
    ttlHours: 24,
    googleLogin,
    startGuest: async () => {},
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function markup(googleLogin: boolean, guest: boolean, node: ReactNode) {
  return renderToStaticMarkup(createElement(AuthContext.Provider, { value: authValue(googleLogin, guest) }, node));
}

function screens(googleLogin: boolean) {
  return {
    login: markup(googleLogin, false, createElement(LoginForm)),
    guest: markup(googleLogin, true, createElement(GuestBanner)),
  };
}

async function serverAllowsGoogleLogin(env: GoogleEnv): Promise<boolean> {
  const loaded = await import('../src/lib/google-login');
  const read = loaded.googleLoginEnabled ?? loaded.default?.googleLoginEnabled;
  if (typeof read !== 'function') throw new Error('googleLoginEnabled missing');
  return read(env);
}

const hiddenCases: GoogleEnv[] = [
  {},
  { GOOGLE_CLIENT_ID: '' },
  { GOOGLE_CLIENT_SECRET: '' },
  { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
  { GOOGLE_CLIENT_ID: 'only-id' },
  { GOOGLE_CLIENT_SECRET: 'only-secret' },
  { GOOGLE_CLIENT_ID: '   ', GOOGLE_CLIENT_SECRET: 'secret-with-id-blank' },
  { GOOGLE_CLIENT_ID: 'id-with-secret-blank', GOOGLE_CLIENT_SECRET: ' \n ' },
];

test('both Google credentials register the provider, keep the secret on the server, and show the buttons', async () => {
  const clientId = 'google-client-visible-check';
  const clientSecret = 'google-secret-must-stay-on-server';
  const catalog = providerCatalog({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
  });
  const serialized = JSON.stringify(catalog);
  assert.equal(serialized.includes(clientSecret), false);
  assert.equal(serialized.includes(clientId), false);
  assert.equal(serialized.includes('clientSecret'), false);
  assert.equal(Object.hasOwn(catalog, 'credentials'), true);
  assert.equal(Object.hasOwn(catalog, 'google'), true);

  const enabled = await serverAllowsGoogleLogin({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
  });
  assert.equal(enabled, Object.hasOwn(catalog, 'google'));
  const { login, guest } = screens(enabled);
  assert.equal(login.includes('Googleでログイン'), true);
  assert.equal(guest.includes('Googleでログイン'), true);
  assert.equal(login.includes(clientSecret), false);
  assert.equal(guest.includes(clientSecret), false);
  assert.match(login, /メールアドレス/);
  assert.match(login, /type="password"/);
});

test('the server flag shows Google login only when it is on, and email login stays either way', () => {
  const shown = screens(true);
  assert.equal(shown.login.includes('Googleでログイン'), true);
  assert.equal(shown.guest.includes('Googleでログイン'), true);
  assert.match(shown.login, /メールアドレス/);
  assert.match(shown.login, /type="password"/);

  const hidden = screens(false);
  assert.equal(hidden.login.includes('Googleでログイン'), false);
  assert.equal(hidden.guest.includes('Googleでログイン'), false);
  assert.match(hidden.login, /メールアドレス/);
  assert.match(hidden.login, /type="password"/);
  assert.match(hidden.guest, /体験を終了/);
});

test('missing or blank Google credentials omit the provider and hide every Google login button', async () => {
  for (const google of hiddenCases) {
    const label = JSON.stringify(google);
    const catalog = providerCatalog(google);
    const serialized = JSON.stringify(catalog);
    if (google.GOOGLE_CLIENT_SECRET?.trim()) {
      assert.equal(serialized.includes(google.GOOGLE_CLIENT_SECRET), false, label);
    }
    if (google.GOOGLE_CLIENT_ID?.trim()) {
      assert.equal(serialized.includes(google.GOOGLE_CLIENT_ID), false, label);
    }
    assert.equal(Object.hasOwn(catalog, 'credentials'), true, label);
    assert.equal(Object.hasOwn(catalog, 'google'), false, label);

    const enabled = await serverAllowsGoogleLogin(google);
    assert.equal(enabled, false, label);
    const { login, guest } = screens(enabled);
    assert.equal(login.includes('Googleでログイン'), false, label);
    assert.equal(guest.includes('Googleでログイン'), false, label);
    assert.match(login, /メールアドレス/, label);
    assert.match(login, /type="password"/, label);
    assert.match(guest, /体験を終了/, label);
  }
});
