// 起動したプロセスの引数と、レンダラの seccomp を見る。ソースの文字列は読まない。
// 起動が失敗したときは、失敗を残したまま待ち受けを閉じ、プロセスが終わる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { launchPageBrowser } from '../src/lib/page-browser';
import { withPricePage } from './page-browser-session';

function cmdline(pid: number): string[] {
  return readFileSync(`/proc/${pid}/cmdline`).toString().split('\0').filter(Boolean);
}

function descendantPids(pid: number): number[] {
  const found: number[] = [];
  const walk = (current: number) => {
    found.push(current);
    let text = '';
    try {
      text = readFileSync(`/proc/${current}/task/${current}/children`, 'utf8');
    } catch {
      return;
    }
    for (const child of text.trim().split(/\s+/).filter(Boolean)) walk(Number(child));
  };
  walk(pid);
  return found;
}

function seccompMode(pid: number): number {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const line = status.split('\n').find((row) => row.startsWith('Seccomp:'));
  return Number(line?.split(/\s+/)[1]);
}

function launchedArgs(child: ChildProcess): string[] {
  const pid = child.pid;
  if (platform() === 'linux' && pid !== undefined) return cmdline(pid);
  return child.spawnargs ?? [];
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// exit はパイプの最後の出力より先に届く。close のあとで stdout と stderr を読む。
async function exitedChild(child: ChildProcess, waitMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdout === null || stderr === null) throw new Error('child stdio is not a pipe');
  let out = '';
  let err = '';
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  stdout.on('data', (chunk: string) => { out += chunk; });
  stderr.on('data', (chunk: string) => { err += chunk; });
  const streamsClosed = Promise.all([once(stdout, 'close'), once(stderr, 'close')]);
  const code = await Promise.race([
    once(child, 'exit').then(([status]) => status),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);
  if (code === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  await streamsClosed;
  return { code, stdout: out, stderr: err };
}

test('起動に失敗してもサーバを閉じてプロセスが終わる', { timeout: 10_000 }, async () => {
  const sessionFile = fileURLToPath(new URL('./page-browser-session.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', sessionFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const { code, stdout, stderr } = await exitedChild(child, 3_000);
  const port = Number(stdout.match(/listening (\d+)/)?.[1]);
  assert.equal(code, 1, `process left running\nstdout=${stdout}\nstderr=${stderr}`);
  assert.match(`${stdout}\n${stderr}`, /launch failed/);
  assert.equal(Number.isInteger(port) && port > 0, true, stdout);
  assert.equal(await portAccepts(port), false);
});

test('取得用ブラウザはサンドボックス付きで起動し、価格の文字を読む', { timeout: 30_000 }, async (t) => {
  await withPricePage(launchPageBrowser, async (browser, port) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    assert.equal(await page.$eval('#price', (el) => el.textContent), '¥1,280');

    const child = browser.process();
    assert.ok(child);
    const args = launchedArgs(child);
    assert.equal(args.includes('--no-sandbox'), false, args.join('\n'));
    assert.equal(args.includes('--disable-setuid-sandbox'), false, args.join('\n'));
    if (platform() === 'linux') {
      assert.equal(typeof child.pid, 'number');
      const modes = descendantPids(child.pid as number).map(seccompMode);
      assert.equal(modes.includes(2), true, modes.join(','));
    }
  }, {
    registerCleanup: (close) => { t.after(close); },
  });
});
