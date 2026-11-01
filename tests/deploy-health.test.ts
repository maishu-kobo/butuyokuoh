import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../src/app/api/health/route';

test('deployment readiness requires a valid release identity and never exposes file contents', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'deploy-health-'));
  t.mock.method(process, 'cwd', () => directory);
  try {
    for (const value of [null, 'invalid private content', 'a'.repeat(40)]) {
      if (value !== null) writeFileSync(join(directory, 'RELEASE_SHA'), value);
      const response = GET();
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.status, value === 'a'.repeat(40) ? 200 : 503);
      assert.deepEqual(await response.json(), value === 'a'.repeat(40)
        ? { ok: true, sha: value } : { ok: false });
    }
  } finally {
    t.mock.restoreAll();
    rmSync(directory, { recursive: true });
  }
});
