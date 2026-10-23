import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('production e2e skips the hydration harness page', () => {
  const source = readFileSync('tests/e2e/capture-hydration.spec.ts', 'utf8');
  const bodies = source.split(/(?:^|\n)test\('/).slice(1);
  const harness = bodies.filter((body) => body.includes("'/capture-hydration'"));
  assert.equal(harness.length, 2);
  for (const body of harness) {
    assert.match(body, /test\.skip\(Boolean\(process\.env\.E2E_PRODUCTION\), '本番ビルドには検証ページが無い'\)/);
  }
  const home = bodies.filter((body) => body.includes("goto('/')"));
  assert.equal(home.length, 1);
  assert.doesNotMatch(home[0], /E2E_PRODUCTION/);
});
