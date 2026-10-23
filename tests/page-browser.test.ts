// 起動したプロセスの引数と、レンダラの seccomp を見る。ソースの文字列は読まない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { platform } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { launchPageBrowser } from '../src/lib/page-browser';

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

test('取得用ブラウザはサンドボックス付きで起動し、価格の文字を読む', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><span id="price">¥1,280</span>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server has no port');
  const browser = await launchPageBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
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
  } finally {
    await browser.close();
    server.close();
  }
});
