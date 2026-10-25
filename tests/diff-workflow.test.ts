import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 差分ハーネスが比べる挙動と、ハーネス自身。ここを変えた PR では比較を起動する。
const REQUIRED = [
  'src/lib/db.ts',
  'src/auth.ts',
  'src/lib/auth.ts',
  'src/app/api/items/**',
  'src/app/api/auth/login/**',
  'src/lib/scraper.ts',
  'src/lib/member-fetch.ts',
  'src/lib/http-url.ts',
  'src/lib/photo-spend.ts',
  'src/lib/product-html.ts',
  'src/lib/amazon-product.ts',
  'src/lib/html-encoding.ts',
  'src/lib/url-validator.ts',
  'src/lib/email.ts',
  'src/lib/guest.ts',
  'src/lib/guest-scraper.ts',
  'src/lib/api-access.ts',
  'src/lib/price-check-items.ts',
  'src/lib/cookie-policy.ts',
  'scripts/diff-harness/**',
  '.github/workflows/diff-behavior.yml',
  'package.json',
];

function pullRequestPaths(source: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === '  pull_request:');
  assert.notEqual(start, -1, 'pull_request trigger');
  const pathsAt = lines.findIndex((line, index) => index > start && line === '    paths:');
  if (pathsAt < 0) return [];
  const paths: string[] = [];
  for (const line of lines.slice(pathsAt + 1)) {
    const match = line.match(/^      - (.+)$/);
    if (!match) break;
    paths.push(match[1].trim());
  }
  return paths;
}

test('differential workflow runs when compared behavior or the harness changes', () => {
  const source = readFileSync(new URL('../.github/workflows/diff-behavior.yml', import.meta.url), 'utf8');
  assert.equal(source.split('\n').some((line) => line.trim() === 'pull_request_target:'), false);
  assert.match(source, /^ {2}workflow_dispatch:/m);
  const paths = pullRequestPaths(source);
  const missing = REQUIRED.filter((path) => !paths.includes(path));
  assert.deepEqual(missing, []);
});
