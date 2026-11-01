import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { filesForLane, laneOfSpec } from '../scripts/e2e-lanes.mjs';
import { e2eFilesFromPlaywrightReport } from '../scripts/test-lanes.mjs';

function walkTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walkTestFiles(path));
    else if (name.endsWith('.test.ts')) found.push(path.split('\\').join('/'));
  }
  return found;
}

test('unit tests stay in tests/*.test.ts so npm test and the blocking lane both run them', () => {
  const found = walkTestFiles('tests').sort();
  const top = readdirSync('tests').filter((name) => name.endsWith('.test.ts')).map((name) => `tests/${name}`).sort();
  assert.deepEqual(found, top);
});

test('every e2e spec is in one lane and the default lane is exactly what playwright lists', () => {
  const names = readdirSync('tests/e2e').filter((name) => name.endsWith('.spec.ts'));
  for (const name of names) assert.equal(typeof laneOfSpec(name), 'string', name);
  const listedCommand = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], { encoding: 'utf8' });
  assert.equal(listedCommand.status, 0, listedCommand.stderr);
  const listed = e2eFilesFromPlaywrightReport(JSON.parse(listedCommand.stdout), process.cwd())
    .map((file) => file.split('/').pop())
    .sort();
  assert.deepEqual(listed, filesForLane(names, 'default'));
});
