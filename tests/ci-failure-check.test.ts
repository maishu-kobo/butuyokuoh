import assert from 'node:assert/strict';
import { test } from 'node:test';

test('deliberate CI failure check for issue 85', () => {
  assert.equal(1, 0, 'intentional failure to prove CI fails');
});
