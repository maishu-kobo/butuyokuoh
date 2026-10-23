// 返事に付くヘッダを見る。設定ファイルのソース文字列は読まない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PATHS = [
  '/',
  '/icons/icon-192.png',
  '/api/auth/csrf',
  '/api/auth/signin/google',
  '/api/auth/callback/google',
  '/api/upload',
  '/uploads/photo.jpg',
];

type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

test('next config header rules stay report-only and cover documents, auth, upload, and images', async () => {
  const production = await loadRules('production');
  const development = await loadRules('development');
  for (const requestPath of PATHS) {
    assertContract(applyRules(production, requestPath), 'production', requestPath);
    assertContract(applyRules(development, requestPath), 'development', requestPath);
  }
});

test('a next dev server sends those headers on documents, auth, upload, and images', { timeout: 180_000 }, async () => {
  const server = await startNextDev();
  try {
    for (const requestPath of PATHS) {
      const response = await fetch(new URL(requestPath, server.origin), { redirect: 'manual' });
      assertContract(response.headers, 'development', requestPath);
      if (requestPath === '/' || requestPath === '/icons/icon-192.png' || requestPath === '/api/auth/csrf') {
        assert.equal(response.status, 200, requestPath);
      }
    }
  } finally {
    await server.stop();
  }
});

function assertContract(headers: Headers, mode: 'production' | 'development', label: string) {
  assert.equal(headers.get('x-content-type-options'), 'nosniff', label);
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin', label);
  assert.equal(headers.get('x-frame-options'), 'DENY', label);
  assert.equal(headers.get('content-security-policy'), null, label);
  const csp = headers.get('content-security-policy-report-only');
  assert.equal(typeof csp, 'string', label);
  assert.equal(csp!.includes('*'), false, label);
  const directives = parsePolicy(csp!);
  assert.deepEqual([...directives.keys()].sort(), [
    'base-uri',
    'connect-src',
    'default-src',
    'font-src',
    'form-action',
    'frame-ancestors',
    'img-src',
    'manifest-src',
    'object-src',
    'script-src',
    'style-src',
  ], label);
  assert.deepEqual(directives.get('default-src'), ["'self'"], label);
  assert.deepEqual(directives.get('base-uri'), ["'self'"], label);
  assert.deepEqual(directives.get('object-src'), ["'none'"], label);
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"], label);
  assert.deepEqual(directives.get('form-action'), ["'self'"], label);
  assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"], label);
  assert.deepEqual(directives.get('img-src'), ["'self'", 'data:', 'blob:', 'https:'], label);
  assert.deepEqual(directives.get('font-src'), ["'self'"], label);
  assert.deepEqual(directives.get('connect-src'), ["'self'"], label);
  assert.deepEqual(directives.get('manifest-src'), ["'self'"], label);
  const script = ["'self'", "'unsafe-inline'"];
  if (mode === 'development') script.push("'unsafe-eval'");
  assert.deepEqual(directives.get('script-src'), script, label);
}

function parsePolicy(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    directives.set(name, sources);
  }
  return directives;
}

function applyRules(rules: HeaderRule[], requestPath: string): Headers {
  const headers = new Headers();
  for (const rule of rules) {
    if (!getPathMatch(rule.source)(requestPath)) continue;
    for (const header of rule.headers) headers.set(header.key, header.value);
  }
  return headers;
}

function loadRules(nodeEnv: string): Promise<HeaderRule[]> {
  const configUrl = pathToFileURL(path.join(root, 'next.config.ts')).href;
  const script = `
    import nextConfig from ${JSON.stringify(configUrl)};
    if (typeof nextConfig.headers !== 'function') {
      console.error('headers() is missing');
      process.exit(2);
    }
    const rules = await nextConfig.headers();
    process.stdout.write(JSON.stringify(rules));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: nodeEnv },
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'failed to read header rules');
  return JSON.parse(result.stdout);
}

async function startNextDev(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'butuyokuoh-headers-'));
  const nextBin = path.join(root, 'node_modules', '.bin', 'next');
  const child = spawn(nextBin, ['dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      BUTUYOKUOH_DB_PATH: path.join(dataDir, 'app.db'),
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const append = (chunk: Buffer) => {
    log = (log + chunk.toString('utf8')).slice(-4000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const stop = () => stopChild(child);
  try {
    await waitForHttp(origin, child, () => log);
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, stop };
}

async function waitForHttp(origin: string, child: ChildProcess, readLog: () => string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError = 'server did not accept a connection';
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try {
      const response = await fetch(new URL('/icons/icon-192.png', origin), { redirect: 'manual' });
      if (response.status === 200) return;
      lastError = `icon status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${lastError}\n${readLog()}`);
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.pid == null || child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('no port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
