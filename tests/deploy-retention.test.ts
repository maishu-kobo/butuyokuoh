import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('release retention keeps three generations without deleting shared data', () => {
  const result = spawnSync('python3', ['scripts/deploy/test_retention.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
