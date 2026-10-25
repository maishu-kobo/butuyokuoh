import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { baselineMap, increasedWarnings, warningCounts } from '../scripts/lint-warnings.mjs';

test('a new lint warning is rejected and an existing warning may shrink', () => {
  const results = [{
    filePath: '/repo/src/a.tsx',
    messages: [
      { severity: 1, ruleId: 'no-img', message: 'img' },
      { severity: 1, ruleId: 'no-img', message: 'img' },
      { severity: 2, ruleId: 'parse', message: 'bad' },
    ],
  }];
  const current = warningCounts(results, '/repo');
  const increased = increasedWarnings(current, baselineMap([
    { file: 'src/a.tsx', ruleId: 'no-img', message: 'img', count: 1 },
  ]));
  assert.equal(increased.length, 1);
  assert.deepEqual(increased[0], {
    file: 'src/a.tsx', ruleId: 'no-img', message: 'img', count: 2, allowed: 1,
  });
  assert.deepEqual(increasedWarnings(current, baselineMap([
    { file: 'src/a.tsx', ruleId: 'no-img', message: 'img', count: 2 },
  ])), []);
  assert.deepEqual(increasedWarnings(warningCounts([{
    filePath: '/repo/src/a.tsx', messages: [],
  }], '/repo'), baselineMap([
    { file: 'src/a.tsx', ruleId: 'no-img', message: 'img', count: 1 },
  ])), []);
});

test('the repository lint warnings do not exceed the committed baseline', () => {
  const result = spawnSync(process.execPath, ['scripts/lint-warnings.mjs', 'check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
