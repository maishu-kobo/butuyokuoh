import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_BYTES,
  assessBrowserCache,
  browserKind,
  parseInstallLocations,
} from '../scripts/verify-playwright-browsers.mjs';

const sample = `
Chrome for Testing 156.0.8078.4 (playwright chromium v1248)
  Install location:    /cache/chromium-1248
  Download url:        https://cdn.playwright.dev/chrome.zip

Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248)
  Install location:    /cache/chromium_headless_shell-1248

FFmpeg (playwright ffmpeg v1013)
  Install location:    /cache/ffmpeg-1013
`;

function ioFor(present: Record<string, number>) {
  return {
    exists: (path: string) => Object.prototype.hasOwnProperty.call(present, path),
    size: (path: string) => present[path] ?? 0,
    sha256: (path: string) => `hash:${path}`,
    version: (path: string) => ({ ok: present[`${path}#version`] !== 0, output: 'Chrome 156' }),
  };
}

test('dry-run output lists install locations', () => {
  assert.deepEqual(parseInstallLocations(sample), [
    '/cache/chromium-1248',
    '/cache/chromium_headless_shell-1248',
    '/cache/ffmpeg-1013',
  ]);
  assert.equal(browserKind('/cache/chromium-1248'), 'chromium');
  assert.equal(browserKind('/cache/chromium_headless_shell-1248'), 'chromium-headless-shell');
  assert.equal(browserKind('/cache/ffmpeg-1013'), 'ffmpeg');
});

test('a complete cache passes and reports checksums', () => {
  const present: Record<string, number> = {
    '/cache/chromium-1248/INSTALLATION_COMPLETE': 1,
    '/cache/chromium-1248/chrome-linux64/chrome': MIN_BYTES.chromium,
    '/cache/chromium_headless_shell-1248/INSTALLATION_COMPLETE': 1,
    '/cache/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell': MIN_BYTES['chromium-headless-shell'],
    '/cache/ffmpeg-1013/INSTALLATION_COMPLETE': 1,
    '/cache/ffmpeg-1013/ffmpeg-linux': MIN_BYTES.ffmpeg,
  };
  const result = assessBrowserCache(parseInstallLocations(sample), ioFor(present));
  assert.deepEqual(result.errors, []);
  assert.equal(result.checks.length, 3);
  assert.match(result.checks[0].hash, /^hash:/);
});

test('a missing marker or a tiny binary fails loudly', () => {
  const present: Record<string, number> = {
    '/cache/chromium-1248/chrome-linux64/chrome': 10,
    '/cache/chromium_headless_shell-1248/INSTALLATION_COMPLETE': 1,
    '/cache/ffmpeg-1013/INSTALLATION_COMPLETE': 1,
    '/cache/ffmpeg-1013/ffmpeg-linux': MIN_BYTES.ffmpeg,
  };
  const result = assessBrowserCache(parseInstallLocations(sample), ioFor(present));
  assert.ok(result.errors.some((error) => error.includes('INSTALLATION_COMPLETE')));
  assert.ok(result.errors.some((error) => error.includes('小さすぎる')));
  assert.ok(result.errors.some((error) => error.includes('実行ファイルが無い')));
});

test('a browser that does not print a version fails', () => {
  const present: Record<string, number> = {
    '/cache/chromium-1248/INSTALLATION_COMPLETE': 1,
    '/cache/chromium-1248/chrome-linux64/chrome': MIN_BYTES.chromium,
    '/cache/chromium-1248/chrome-linux64/chrome#version': 0,
  };
  const result = assessBrowserCache(['/cache/chromium-1248'], ioFor(present));
  assert.ok(result.errors.some((error) => error.includes('バージョン確認に失敗')));
});
