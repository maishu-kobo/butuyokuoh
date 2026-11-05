import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { authRedirectUrl } from '../src/lib/auth-redirect';

test('Google login returns to the configured MCP consent page without opening arbitrary redirects', () => {
  const previous = process.env.MCP_PUBLIC_ORIGIN;
  const base = 'https://wishlist.example.test:8000';
  const publicOrigin = 'https://wishlist.example.test';
  process.env.MCP_PUBLIC_ORIGIN = publicOrigin;
  try {
    const callback = `${publicOrigin}/oauth/authorize/consent?pending=example`;
    assert.equal(authRedirectUrl(callback, base), callback);
    assert.equal(authRedirectUrl('/settings', base), `${base}/settings`);
    assert.equal(authRedirectUrl(`${base}/settings`, base), `${base}/settings`);
    for (const url of [
      `${publicOrigin}/settings`, `${publicOrigin}/oauth/authorize/consent/other`,
      `${publicOrigin}/oauth/authorize/consent/../../other`,
      `${publicOrigin}.evil.test/oauth/authorize/consent`,
      'https://wishlist.example.test@evil.test/oauth/authorize/consent',
      '//evil.test/oauth/authorize/consent', 'javascript:alert(1)',
      'http://wishlist.example.test/oauth/authorize/consent',
    ]) assert.equal(authRedirectUrl(url, base), base);
    fc.assert(fc.property(fc.webUrl(), url => {
      const candidate = new URL(url);
      fc.pre(candidate.origin !== publicOrigin && candidate.origin !== base);
      assert.equal(authRedirectUrl(url, base), base);
    }), { seed: 344, numRuns: 100 });
    delete process.env.MCP_PUBLIC_ORIGIN;
    assert.equal(authRedirectUrl(callback, base), base);
  } finally {
    if (previous === undefined) delete process.env.MCP_PUBLIC_ORIGIN;
    else process.env.MCP_PUBLIC_ORIGIN = previous;
  }
});
