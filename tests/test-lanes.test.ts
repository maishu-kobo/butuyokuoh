import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_E2E,
  DISABLED_E2E,
  activeE2eTests,
  listUnitTests,
  parseQuarantine,
  partitionTests,
} from '../scripts/test-lanes.mjs';

const unitTests = ['tests/a.test.ts', 'tests/b.test.ts'];
const e2eTests = ['tests/e2e/guest.spec.ts', 'tests/e2e/capture.spec.ts'];

test('comments and blank lines are not quarantined', () => {
  assert.deepEqual(parseQuarantine('# tests/a.test.ts\n\n  \n./tests/b.test.ts\n'), ['tests/b.test.ts']);
});

test('a listed unit test leaves the blocking lane and an unknown path is reported', () => {
  const split = partitionTests({
    unitTests,
    e2eTests,
    quarantined: ['tests/a.test.ts', 'tests/missing.test.ts'],
  });
  assert.deepEqual(split.blockingUnit, ['tests/b.test.ts']);
  assert.deepEqual(split.quarantineUnit, ['tests/a.test.ts']);
  assert.deepEqual(split.blockingE2e, e2eTests);
  assert.deepEqual(split.unknown, ['tests/missing.test.ts']);
});

test('a listed e2e file leaves only the active playwright set', () => {
  const split = partitionTests({
    unitTests,
    e2eTests,
    quarantined: ['tests/e2e/guest.spec.ts', DISABLED_E2E],
  });
  assert.deepEqual(split.blockingE2e, ['tests/e2e/capture.spec.ts']);
  assert.deepEqual(split.quarantineE2e, ['tests/e2e/guest.spec.ts', DISABLED_E2E]);
  assert.deepEqual(split.unknown, []);
});

test('an empty list keeps every blocking test', () => {
  const split = partitionTests({ unitTests, e2eTests, quarantined: [] });
  assert.deepEqual(split.blockingUnit, unitTests);
  assert.deepEqual(split.blockingE2e, e2eTests);
  assert.deepEqual(split.quarantineUnit, []);
  assert.deepEqual(split.quarantineE2e, []);
});

test('the committed quarantine list has no tests', () => {
  const entries = parseQuarantine(readFileSync('.github/test-quarantine.txt', 'utf8'));
  assert.deepEqual(entries, []);
  const result = spawnSync(process.execPath, ['scripts/test-lanes.mjs', 'count'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '0 0');
});

test('unit discovery is the top-level node:test files', () => {
  assert.deepEqual(listUnitTests(['e2e', 'b.test.ts', 'a.test.ts', 'note.md']), ['tests/a.test.ts', 'tests/b.test.ts']);
});

test('default e2e names match playwright.config.ts', () => {
  const config = readFileSync('playwright.config.ts', 'utf8');
  for (const file of [...DEFAULT_E2E, DISABLED_E2E]) {
    const base = file.slice('tests/e2e/'.length).replace('.', '\\.');
    assert.match(config, new RegExp(base));
  }
  assert.deepEqual(activeE2eTests({}), DEFAULT_E2E);
  assert.deepEqual(activeE2eTests({ E2E_GUEST_DISABLED: '1' }), [DISABLED_E2E]);
});
