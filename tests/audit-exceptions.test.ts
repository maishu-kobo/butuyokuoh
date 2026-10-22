import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  evaluateAudit,
  highAdvisories,
  loadExceptions,
  todayUtc,
} from '../scripts/audit-high.mjs';

const require = createRequire(import.meta.url);
const root = process.cwd();
const exceptionPath = join(root, '.github', 'audit-exceptions.json');

const bracesAdvisory = {
  name: 'braces',
  severity: 'high',
  via: [
    {
      name: 'braces',
      severity: 'high',
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
    },
  ],
};

function report(extra: Record<string, unknown> = {}) {
  return { vulnerabilities: { braces: bracesAdvisory, ...extra } };
}

test('the braces exception has a reason, a real expiry, and no vendored copy', () => {
  assert.equal(existsSync(join(root, 'vendor', 'braces')), false);
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    engines: { node: string };
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    overrides?: Record<string, string>;
  };
  assert.equal(packageJson.engines.node, '>=22.12.0');
  assert.equal(packageJson.dependencies.braces, undefined);
  assert.equal(packageJson.devDependencies.braces, undefined);
  // sharp は Next が引き込む古い任意依存を 0.35.5 に固定する。braces の上書きは入れない。
  assert.deepEqual(packageJson.overrides, { sharp: '0.35.5' });

  const [entry] = loadExceptions(exceptionPath);
  assert.equal(entry.name, 'braces');
  assert.equal(entry.ghsa, 'GHSA-VFJ7-8CJW-P6XM');
  assert.equal(entry.devOnly, true);
  assert.equal(entry.expires, '2027-01-22');
  assert.match(entry.reason, /開発依存/);
  assert.match(entry.reason, /micromatch\/braces#79/);
  assert.ok(entry.expires > '2026-10-22');

  const deployment = readFileSync(join(root, 'docs', 'deployment.md'), 'utf8');
  assert.match(deployment, /22\.12 以上/);
  assert.match(deployment, /develop にマージする前に/);
  assert.match(deployment, /本番環境、本番データベース、秘密情報はいじらない/);
});

test('a current dev-only braces advisory is allowed and anything else is not', () => {
  const exceptions = loadExceptions(exceptionPath);
  assert.deepEqual(evaluateAudit(report(), exceptions, '2026-10-22'), []);
  assert.deepEqual(highAdvisories(report()).map((finding) => finding.ghsa), ['GHSA-VFJ7-8CJW-P6XM']);

  const expired = evaluateAudit(report(), exceptions, '2027-01-22');
  assert.equal(expired.length, 1);
  assert.match(expired[0], /期限切れ/);

  const other = report({
    leftpad: {
      name: 'left-pad',
      severity: 'critical',
      via: [{ name: 'left-pad', severity: 'critical', url: 'https://github.com/advisories/GHSA-1111-2222-3333' }],
    },
  });
  const extra = evaluateAudit(other, exceptions, '2026-10-22');
  assert.equal(extra.length, 1);
  assert.match(extra[0], /left-pad/);

  const transitive = report({
    micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
  });
  assert.deepEqual(evaluateAudit(transitive, exceptions, '2026-10-22'), []);

  const stale = evaluateAudit({ vulnerabilities: {} }, exceptions, '2026-10-22');
  assert.match(stale[0], /もう出ていない/);
});

test('registry braces still expands the patterns the linter uses', () => {
  const braces = require('braces') as { expand: (pattern: string) => string[] };
  const installed = JSON.parse(readFileSync(join(root, 'node_modules', 'braces', 'package.json'), 'utf8')) as {
    version: string;
  };
  assert.equal(installed.version, '3.0.3');
  assert.deepEqual(braces.expand('a{b,c}d'), ['abd', 'acd']);
  assert.deepEqual(braces.expand('src/{lib,app}/*.ts'), ['src/lib/*.ts', 'src/app/*.ts']);
});

test('todayUtc formats the calendar day in UTC', () => {
  assert.equal(todayUtc(new Date('2026-10-22T23:30:00.000Z')), '2026-10-22');
});

test('the high audit gate accepts the current tree', () => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { dev?: boolean; dependencies?: Record<string, string> }>;
  };
  assert.equal(lock.packages['node_modules/braces'].dev, true);
  assert.equal(lock.packages['vendor/braces'], undefined);
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (pkg.dev) continue;
    assert.equal(pkg.dependencies?.braces, undefined, name);
  }
  const result = spawnSync('node', ['scripts/audit-high.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
