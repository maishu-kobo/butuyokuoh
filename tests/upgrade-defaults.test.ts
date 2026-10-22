import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import nextConfig from '../next.config';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { defaultConfig } from 'next/dist/server/config-shared';
import {
  MEMBER_TOKEN_COOKIE,
  MEMBER_TOKEN_MAX_AGE_SECONDS,
  clearGuestCookieOptions,
  guestSessionCookieOptions,
  memberTokenCookieOptions,
} from '../src/lib/cookie-policy';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const braces = require('braces') as { expand: (pattern: string) => string[] };

test('Next 16.4 leaves this app on the 16.1 caching model', () => {
  assert.equal(nextConfig.cacheComponents, undefined);
  assert.equal(nextConfig.partialPrefetching, undefined);
  assert.equal(defaultConfig.cacheComponents, false);
  assert.equal(defaultConfig.experimental.cachedNavigations, false);
  assert.equal(defaultConfig.experimental.staleTimes.dynamic, 0);
  assert.equal(defaultConfig.experimental.staleTimes.static, 300);
  // 16.2 introduced this as opt-in. 16.4 turns it on unless an app opts out.
  // It only changes how prefetched segments are packaged, not rendered data.
  assert.equal(defaultConfig.experimental.prefetchInlining, true);
  assert.equal(nextConfig.experimental?.prefetchInlining, undefined);
});

test('image optimizer keeps the 50MB cap and still refuses SVG', () => {
  assert.equal(nextConfig.images, undefined);
  assert.equal(imageConfigDefault.maximumResponseBody, 50_000_000);
  assert.equal(imageConfigDefault.dangerouslyAllowSVG, false);
  assert.equal(imageConfigDefault.minimumCacheTTL, 14_400);
});

test('there is no middleware or proxy file to rename', () => {
  for (const name of [
    'middleware.ts',
    'middleware.js',
    'src/middleware.ts',
    'src/middleware.js',
    'proxy.ts',
    'proxy.js',
    'src/proxy.ts',
    'src/proxy.js',
  ]) {
    assert.equal(existsSync(join(process.cwd(), name)), false, name);
  }
});

test('app auth cookies stay httpOnly, lax, and secure only in production', () => {
  assert.equal(MEMBER_TOKEN_COOKIE, 'butuyokuoh_token');
  const dev = memberTokenCookieOptions('development');
  const prod = memberTokenCookieOptions('production');
  assert.equal(dev.httpOnly, true);
  assert.equal(dev.sameSite, 'lax');
  assert.equal(dev.path, '/');
  assert.equal(dev.secure, false);
  assert.equal(dev.maxAge, MEMBER_TOKEN_MAX_AGE_SECONDS);
  assert.equal(prod.secure, true);

  const expiresAt = '2026-10-23T00:00:00.000Z';
  const guest = guestSessionCookieOptions(expiresAt, 'development');
  assert.equal(guest.httpOnly, true);
  assert.equal(guest.sameSite, 'lax');
  assert.equal(guest.path, '/');
  assert.equal(guest.secure, false);
  assert.equal(guest.expires.toISOString(), expiresAt);
  assert.equal(guestSessionCookieOptions(expiresAt, 'production').secure, true);

  const cleared = clearGuestCookieOptions('production');
  assert.deepEqual(cleared, {
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
});

test('Auth.js cookie names and flags match the beta.30 defaults', async () => {
  const href = pathToFileURL(join(process.cwd(), 'node_modules/@auth/core/lib/utils/cookie.js')).href;
  const { defaultCookies } = await import(href) as {
    defaultCookies: (useSecureCookies: boolean) => {
      sessionToken: { name: string; options: { httpOnly: boolean; sameSite: string; path: string; secure: boolean } };
      csrfToken: { name: string };
      state: { name: string };
      nonce: { name: string };
      pkceCodeVerifier: { name: string };
    };
  };
  const secure = defaultCookies(true);
  assert.equal(secure.sessionToken.name, '__Secure-authjs.session-token');
  assert.equal(secure.sessionToken.options.httpOnly, true);
  assert.equal(secure.sessionToken.options.sameSite, 'lax');
  assert.equal(secure.sessionToken.options.path, '/');
  assert.equal(secure.sessionToken.options.secure, true);
  assert.equal(secure.csrfToken.name, '__Host-authjs.csrf-token');
  assert.equal(secure.state.name, '__Secure-authjs.state');
  assert.equal(secure.nonce.name, '__Secure-authjs.nonce');
  assert.equal(secure.pkceCodeVerifier.name, '__Secure-authjs.pkce.code_verifier');
  assert.equal(defaultCookies(false).sessionToken.name, 'authjs.session-token');
  assert.equal(defaultCookies(false).sessionToken.options.secure, false);
  assert.equal(defaultConfig.experimental.useSkewCookie, false);
  assert.equal(defaultConfig.experimental.authInterrupts, false);
});

test('patched braces keeps lint expansions and refuses deep nesting', () => {
  const installed = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/braces/package.json'), 'utf8')) as { version: string };
  assert.equal(installed.version, '3.0.4');
  assert.deepEqual(braces.expand('a{b,c}d'), ['abd', 'acd']);
  assert.deepEqual(braces.expand('src/{lib,app}/*.ts'), ['src/lib/*.ts', 'src/app/*.ts']);
  const deep = '{'.repeat(400) + 'a,b' + '}'.repeat(400);
  const expanded = braces.expand(deep);
  assert.ok(Array.isArray(expanded));
  assert.ok(expanded.length > 0);
  assert.ok(expanded.every((value) => typeof value === 'string'));
});

test('puppeteer 25 still exposes the launch API the scrapers call', () => {
  assert.equal(typeof puppeteer.launch, 'function');
  assert.equal(typeof puppeteer.defaultArgs, 'function');
});
