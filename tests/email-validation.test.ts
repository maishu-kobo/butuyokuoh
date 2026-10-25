import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fc from 'fast-check';
import { isValidEmail, normalizeEmail } from '../src/lib/email';

test('email validation preserves the existing normalized format for generated addresses', () => {
  const segment = fc.array(fc.constantFrom('a', 'Z', '0', '!', '.', '-', 'あ'), { minLength: 1, maxLength: 30 }).map((chars) => chars.join(''));
  fc.assert(fc.property(segment, segment, segment, (local, domain, suffix) => {
    const email = normalizeEmail(`${local}@${domain}.${suffix}`);
    assert.equal(isValidEmail(email), true, email);
    for (const whitespace of [' ', '\t', '\n', '\r', '\u00a0']) {
      assert.equal(isValidEmail(`${local}@${domain}${whitespace}.${suffix}`), false);
    }
    assert.equal(isValidEmail(`${local}@@${domain}.${suffix}`), false);
    assert.equal(isValidEmail(`${local}${domain}${suffix}`), false);
  }), { seed: 234, numRuns: 200 });
  for (const email of ['@a.b', 'a@.b', 'a@b.', 'a@b', '', 'a.b']) assert.equal(isValidEmail(email), false, email);
});

test('a long invalid domain cannot stall email validation', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', `
    const { isValidEmail } = require('./src/lib/email.ts');
    if (isValidEmail('a@' + '!.'.repeat(200000) + '@')) process.exit(1);
  `], { cwd: new URL('..', import.meta.url), timeout: 10000, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
