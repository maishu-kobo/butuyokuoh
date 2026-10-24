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
import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer';
import { launchPageBrowser } from '../src/lib/page-browser';
import { withPricePage } from './page-browser-session';

const FALLBACK_WARNING = 'Chrome のサンドボックスが使えない（No usable sandbox!）ため、--no-sandbox で一度だけ起動し直します';
const UNSANDBOXED = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

function sandboxLaunchError(): Error {
  return new Error([
    'Failed to launch the browser process:  Code: 1',
    '',
    'stderr:',
    '[1024:1024:FATAL] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor, see https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md.',
    '',
    'TROUBLESHOOTING: https://pptr.dev/troubleshooting',
    '',
  ].join('\n'));
}

function assertSandboxEnvUntouched(): void {
  assert.equal(process.env.PUPPETEER_DANGEROUS_NO_SANDBOX, undefined);
}

async function captureWarn<T>(run: (warnings: unknown[][]) => Promise<T>): Promise<T> {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    return await run(warnings);
  } finally {
    console.warn = original;
  }
}

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

test('サンドボックスで起動できたときは --no-sandbox を付けず、警告しない', async () => {
  assertSandboxEnvUntouched();
  await captureWarn(async (warnings) => {
    const calls: LaunchOptions[] = [];
    const browser = { process: () => null } as Browser;
    const opened = await launchPageBrowser({
      launch: async (options) => {
        calls.push(options);
        assertSandboxEnvUntouched();
        return browser;
      },
    });
    assert.equal(opened, browser);
    assert.deepEqual(calls, [{ headless: true }]);
    assert.equal(calls[0]?.args?.includes('--no-sandbox') ?? false, false);
    assert.equal(calls[0]?.args?.includes('--disable-setuid-sandbox') ?? false, false);
    assert.deepEqual(warnings, []);
  });
  assertSandboxEnvUntouched();
});

test('No usable sandbox! のときだけ --no-sandbox で一度だけ起動し直し、警告を1行出す', async () => {
  assertSandboxEnvUntouched();
  await captureWarn(async (warnings) => {
    const calls: LaunchOptions[] = [];
    const browser = { process: () => null } as Browser;
    const first = sandboxLaunchError();
    let opened: Browser | undefined;
    let thrown: unknown;
    try {
      opened = await launchPageBrowser({
        launch: async (options) => {
          calls.push(options);
          assertSandboxEnvUntouched();
          if (calls.length === 1) throw first;
          return browser;
        },
      });
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown, undefined, thrown instanceof Error ? thrown.message : String(thrown));
    assert.equal(opened, browser);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { headless: true });
    assert.equal(calls[0]?.args?.includes('--no-sandbox') ?? false, false);
    assert.deepEqual(calls[1], UNSANDBOXED);
    assert.equal(FALLBACK_WARNING.includes('\n'), false);
    assert.deepEqual(warnings, [[FALLBACK_WARNING]]);
  });
  assertSandboxEnvUntouched();
});

test('フォールバックの起動も No usable sandbox! なら、もう一度は外さない', async () => {
  assertSandboxEnvUntouched();
  await captureWarn(async (warnings) => {
    const calls: LaunchOptions[] = [];
    const second = sandboxLaunchError();
    let thrown: unknown;
    try {
      await launchPageBrowser({
        launch: async (options) => {
          calls.push(options);
          assertSandboxEnvUntouched();
          throw calls.length === 1 ? sandboxLaunchError() : second;
        },
      });
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown, second);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { headless: true });
    assert.deepEqual(calls[1], UNSANDBOXED);
    assert.deepEqual(warnings, [[FALLBACK_WARNING]]);
  });
  assertSandboxEnvUntouched();
});

test('別の起動エラーではサンドボックスを外して再試行しない', async () => {
  const messages = [
    'Failed to launch the browser process: Code: 1\n\nstderr:\nspawn ENOENT\n',
    'The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I\'m aborting now.',
    'No usable sandbox',
  ];
  for (const message of messages) {
    assertSandboxEnvUntouched();
    await captureWarn(async (warnings) => {
      const calls: LaunchOptions[] = [];
      const expected = new Error(message);
      let thrown: unknown;
      try {
        await launchPageBrowser({
          launch: async (options) => {
            calls.push(options);
            assertSandboxEnvUntouched();
            throw expected;
          },
        });
      } catch (error) {
        thrown = error;
      }
      assert.equal(thrown, expected, message);
      assert.equal(calls.length, 1, message);
      assert.deepEqual(calls[0], { headless: true }, message);
      assert.equal(calls[0]?.args?.includes('--no-sandbox') ?? false, false, message);
      assert.deepEqual(warnings, [], message);
    });
    assertSandboxEnvUntouched();
  }
});

test('No usable sandbox! のあとでも価格の文字を読む', { timeout: 30_000 }, async (t) => {
  assertSandboxEnvUntouched();
  await captureWarn(async (warnings) => {
    const calls: LaunchOptions[] = [];
    await withPricePage(async () => launchPageBrowser({
      launch: async (options) => {
        calls.push(options);
        assertSandboxEnvUntouched();
        if (calls.length === 1) throw sandboxLaunchError();
        return puppeteer.launch(options);
      },
    }), async (browser, port) => {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      assert.equal(await page.$eval('#price', (el) => el.textContent), '¥1,280');
      const child = browser.process();
      assert.ok(child);
      const args = launchedArgs(child);
      assert.equal(args.includes('--no-sandbox'), true, args.join('\n'));
      assert.equal(args.includes('--disable-setuid-sandbox'), true, args.join('\n'));
    }, {
      registerCleanup: (close) => { t.after(close); },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { headless: true });
    assert.equal(calls[0]?.args?.includes('--no-sandbox') ?? false, false);
    assert.deepEqual(calls[1], UNSANDBOXED);
    assert.equal(FALLBACK_WARNING.includes('\n'), false);
    assert.deepEqual(warnings, [[FALLBACK_WARNING]]);
  });
  assertSandboxEnvUntouched();
});
