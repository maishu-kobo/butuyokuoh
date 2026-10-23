/**
 * キャッシュした Playwright ブラウザが、この版のインストール先に実在するか確かめる。
 * `playwright install --dry-run` は欠けると失敗しないので、印と実行ファイルとバージョンで落とす。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const MIN_BYTES = {
  chromium: 50_000_000,
  'chromium-headless-shell': 20_000_000,
  ffmpeg: 500_000,
  // 起動スクリプト。本体は同梱の libwebkitgtk で、--version が通れば揃っている。
  webkit: 1_000,
};

const EXECUTABLES = {
  chromium: ['chrome-linux64', 'chrome'],
  'chromium-headless-shell': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ffmpeg: ['ffmpeg-linux'],
  webkit: ['pw_run.sh'],
};

export function parseInstallLocations(stdout) {
  const locations = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = line.match(/^\s*Install location:\s+(\S+)\s*$/);
    if (match) locations.push(match[1]);
  }
  return locations;
}

export function browserKind(location) {
  const base = location.split('/').filter(Boolean).pop() || '';
  if (base.startsWith('chromium_headless_shell-')) return 'chromium-headless-shell';
  if (base.startsWith('chromium-')) return 'chromium';
  if (base.startsWith('ffmpeg-')) return 'ffmpeg';
  if (base.startsWith('webkit-')) return 'webkit';
  return null;
}

export function executablePath(location) {
  const kind = browserKind(location);
  if (!kind) return null;
  return join(location, ...EXECUTABLES[kind]);
}

function versionArgs(kind) {
  return kind === 'ffmpeg' ? ['-version'] : ['--version'];
}

export function assessBrowserCache(locations, io) {
  const errors = [];
  const checks = [];
  if (locations.length === 0) errors.push('playwright install --dry-run が Install location を出さなかった');
  for (const location of locations) {
    if (location === '<system>') {
      errors.push('Install location が <system>。キャッシュしたブラウザではない');
      continue;
    }
    const kind = browserKind(location);
    if (!kind) {
      errors.push(`未知のインストール先: ${location}`);
      continue;
    }
    const marker = join(location, 'INSTALLATION_COMPLETE');
    if (!io.exists(marker)) errors.push(`INSTALLATION_COMPLETE が無い: ${marker}`);
    const exe = executablePath(location);
    if (!io.exists(exe)) {
      errors.push(`実行ファイルが無い: ${exe}`);
      continue;
    }
    const bytes = io.size(exe);
    if (bytes < MIN_BYTES[kind]) errors.push(`実行ファイルが小さすぎる (${bytes} bytes): ${exe}`);
    const hash = io.sha256(exe);
    const version = io.version(exe, kind);
    checks.push({ exe, hash, version });
    if (!version.ok) errors.push(`バージョン確認に失敗: ${exe}\n${version.output}`);
  }
  return { errors, checks };
}

function liveIo() {
  return {
    exists: existsSync,
    size: (path) => statSync(path).size,
    sha256: (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
    version: (path, kind) => {
      const result = spawnSync(path, versionArgs(kind), { encoding: 'utf8', timeout: 30_000 });
      const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`;
      return { ok: result.status === 0 && output.trim().length > 0, output: output.trim() };
    },
  };
}

function main() {
  const playwright = join(root, 'node_modules', '.bin', 'playwright');
  const dry = spawnSync(playwright, ['install', 'chromium', 'webkit', '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (dry.stdout) process.stdout.write(dry.stdout);
  if (dry.stderr) process.stderr.write(dry.stderr);
  if (dry.status !== 0) {
    process.exitCode = dry.status || 1;
    return;
  }
  const locations = parseInstallLocations(dry.stdout || '');
  const { errors, checks } = assessBrowserCache(locations, liveIo());
  for (const check of checks) {
    console.log(`sha256 ${check.hash}  ${check.exe}`);
    if (check.version.output) console.log(check.version.output.split('\n')[0]);
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
