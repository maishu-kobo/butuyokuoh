import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('deployment client rejects untrusted events and tracks remote execution across SSH disconnects', () => {
  const result = spawnSync('python3', ['scripts/deploy/test_client.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
