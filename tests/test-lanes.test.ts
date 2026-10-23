import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
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

const PROTECTED = [
  'tests/test-lanes.test.ts',
  'tests/bugfix-ssrf.test.ts',
  'tests/regression-auth.test.ts',
  'tests/capture-secrets.test.ts',
];

test('protected tests cannot be removed from the blocking lane', () => {
  const split = partitionTests({
    unitTests: [...unitTests, ...PROTECTED],
    e2eTests,
    quarantined: PROTECTED,
  });
  assert.deepEqual(split.protected, PROTECTED);
  for (const path of PROTECTED) {
    assert.equal(split.blockingUnit.includes(path), true, path);
    assert.equal(split.quarantineUnit.includes(path), false, path);
  }
});

test('the blocking runner rejects protected entries before it runs tests', () => {
  const source = readFileSync('scripts/test-lanes.mjs', 'utf8');
  const start = source.indexOf("command === 'blocking-unit'");
  const end = source.indexOf("command === 'blocking-e2e'");
  const body = source.slice(start, end);
  assert.match(body, /protectedQuarantineEntries/);
  const e2eBody = source.slice(end, source.indexOf("command === 'quarantine'"));
  assert.match(e2eBody, /protectedQuarantineEntries/);
});

test('a discovered spec can be quarantined and a spec outside discovery cannot', () => {
  const discovered = ['tests/e2e/guest.spec.ts', 'tests/e2e/only-in-config.spec.ts'];
  const quarantined = partitionTests({
    unitTests,
    e2eTests: discovered,
    quarantined: ['tests/e2e/only-in-config.spec.ts'],
  });
  assert.deepEqual(quarantined.blockingE2e, ['tests/e2e/guest.spec.ts']);
  assert.deepEqual(quarantined.quarantineE2e, ['tests/e2e/only-in-config.spec.ts']);
  assert.deepEqual(quarantined.unknown, []);

  const outsider = partitionTests({
    unitTests,
    e2eTests: discovered,
    quarantined: ['tests/e2e/disabled.spec.ts'],
  });
  assert.deepEqual(outsider.blockingE2e, discovered);
  assert.deepEqual(outsider.quarantineE2e, []);
  assert.deepEqual(outsider.unknown, ['tests/e2e/disabled.spec.ts']);
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

test('blocking e2e always subtracts from playwright discovery', () => {
  const source = readFileSync('scripts/test-lanes.mjs', 'utf8');
  assert.equal(source.includes('DEFAULT_E2E'), false);
  assert.equal(source.includes('quarantinedE2e.length === 0'), false);
  assert.match(source, /--list/);
  assert.match(source, /--reporter=json/);
  assert.match(source, /selectBlockingE2e/);
});

test('e2e files come from the playwright list report', async () => {
  const mod = await import('../scripts/test-lanes.mjs');
  assert.equal(typeof mod.e2eFilesFromPlaywrightReport, 'function');
  assert.equal(typeof mod.selectBlockingE2e, 'function');
  const discovered = ['tests/e2e/guest.spec.ts', 'tests/e2e/only-in-config.spec.ts'];
  assert.deepEqual(mod.selectBlockingE2e(discovered, []), discovered);
  assert.deepEqual(
    mod.selectBlockingE2e(discovered, ['tests/e2e/guest.spec.ts', 'tests/e2e/disabled.spec.ts']),
    ['tests/e2e/only-in-config.spec.ts'],
  );
  const report = {
    config: { rootDir: '/repo/tests/e2e' },
    suites: [{ file: 'guest.spec.ts' }, { file: 'only-in-config.spec.ts' }],
  };
  assert.deepEqual(mod.e2eFilesFromPlaywrightReport(report, '/repo'), discovered);
});

test('live playwright discovery is the required e2e set', async () => {
  const mod = await import('../scripts/test-lanes.mjs');
  assert.equal(typeof mod.e2eFilesFromPlaywrightReport, 'function');
  const result = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = mod.e2eFilesFromPlaywrightReport(JSON.parse(result.stdout), process.cwd());
  assert.deepEqual(files, [
    'tests/e2e/capture-flow.spec.ts',
    'tests/e2e/capture-hydration.spec.ts',
    'tests/e2e/capture-manual.spec.ts',
    'tests/e2e/capture-photo-group.spec.ts',
    'tests/e2e/capture-photo-pick.spec.ts',
    'tests/e2e/capture.spec.ts',
    'tests/e2e/guest.spec.ts',
  ]);
});

test('a quarantine failure is a failed check', () => {
  const yml = readFileSync('.github/workflows/quarantine.yml', 'utf8');
  assert.equal(yml.includes('continue-on-error'), false);
  assert.match(yml, /name: quarantined tests/);
});
