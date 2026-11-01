import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('deployment transaction preserves data across failures and interrupted activation', () => {
  const result = spawnSync('python3', ['scripts/deploy/test_engine.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
