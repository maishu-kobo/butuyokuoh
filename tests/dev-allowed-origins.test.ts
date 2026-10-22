import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nextConfig from '../next.config';

test('parseDevAllowedOrigins reads comma-separated hostnames only in development', async () => {
  const { parseDevAllowedOrigins } = await import('../src/lib/dev-origins');
  assert.deepEqual(
    parseDevAllowedOrigins('phone.tailnet.ts.net, 192.168.1.20', 'development'),
    ['phone.tailnet.ts.net', '192.168.1.20'],
  );
  assert.deepEqual(
    parseDevAllowedOrigins(' HTTPS://Phone.Example:443/path ', 'development'),
    ['phone.example'],
  );
  assert.deepEqual(parseDevAllowedOrigins('192.168.1.20:3000', 'development'), ['192.168.1.20']);
  assert.deepEqual(parseDevAllowedOrigins('*.tailnet.ts.net', 'development'), ['*.tailnet.ts.net']);
  assert.equal(parseDevAllowedOrigins('', 'development'), undefined);
  assert.equal(parseDevAllowedOrigins(' , ', 'development'), undefined);
  assert.equal(parseDevAllowedOrigins(undefined, 'development'), undefined);
  assert.equal(parseDevAllowedOrigins('phone.tailnet.ts.net', 'production'), undefined);
  assert.equal(parseDevAllowedOrigins('phone.tailnet.ts.net', 'test'), undefined);
  assert.equal(parseDevAllowedOrigins('phone.tailnet.ts.net', undefined), undefined);
});

test('next config wires allowedDevOrigins through the parser and does not hard-code hosts', () => {
  const source = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('parseDevAllowedOrigins'), true);
  assert.equal(source.includes('DEV_ALLOWED_ORIGINS'), true);
  assert.equal(source.includes('allowedDevOrigins'), true);
  assert.equal(/allowedDevOrigins:\s*\[/.test(source), false);
});

test('an empty dev origin list leaves the loaded config on the current behavior', () => {
  const raw = process.env.DEV_ALLOWED_ORIGINS;
  const nodeEnv = process.env.NODE_ENV;
  const inactive = nodeEnv !== 'development' || !raw?.trim();
  if (inactive) assert.equal(nextConfig.allowedDevOrigins, undefined);
});
