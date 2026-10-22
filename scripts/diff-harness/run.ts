// origin/develop を正として、今の HEAD と同じ入力を一時 SQLite で比べる。
// 本番の data/butuyokuoh.db は開かない。外部 API も呼ばない。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSnapshots, formatReport, loadApprovals, type Snapshot } from './compare';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(harnessDir, '../..');
const PASSWORD = 'secret1';

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function fetchDevelop() {
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: repoRoot, encoding: 'utf8' });
  const args = ['fetch', '--no-tags', 'origin', 'develop:refs/remotes/origin/develop'];
  if (shallow.stdout.trim() === 'true') args.splice(2, 0, '--depth=1');
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status === 0) return;
  const existing = spawnSync('git', ['rev-parse', '--verify', 'origin/develop'], { cwd: repoRoot, encoding: 'utf8' });
  if (existing.status !== 0) {
    throw new Error(`git fetch origin develop failed\n${result.stderr || result.stdout}`);
  }
}

function copyHarness(destRoot: string) {
  cpSync(harnessDir, path.join(destRoot, 'scripts/diff-harness'), { recursive: true });
  const configPath = path.join(destRoot, 'tsconfig.json');
  const config = readFileSync(configPath, 'utf8');
  const paths = '"@/*": ["./src/*"]';
  if (!config.includes(paths)) throw new Error(`tsconfig paths not found in ${destRoot}`);
  const aliased = config.replace(paths, `${paths},
      "next-auth": ["./scripts/diff-harness/mocks/next-auth.mjs"],
      "next/headers": ["./scripts/diff-harness/mocks/next-headers.mjs"],
      "puppeteer": ["./scripts/diff-harness/mocks/puppeteer.mjs"]`);
  writeFileSync(configPath, aliased);
}

function install(dir: string) {
  const dest = path.join(dir, 'node_modules');
  const local = path.join(repoRoot, 'node_modules');
  const sameLock = readFileSync(path.join(dir, 'package-lock.json')).equals(readFileSync(path.join(repoRoot, 'package-lock.json')));
  if (sameLock && existsSync(path.join(local, 'tsx/dist/loader.mjs'))) {
    symlinkSync(local, dest, 'dir');
    return;
  }
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: dir,
    env: {
      ...process.env,
      PUPPETEER_SKIP_DOWNLOAD: 'true',
      PUPPETEER_SKIP_CHROME_DOWNLOAD: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`npm ci failed in ${dir}`);
}

function passwordHash(): string {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const bcrypt = require('bcryptjs') as { hashSync: (password: string, rounds: number) => string };
  return bcrypt.hashSync(PASSWORD, 10);
}

function runSide(dir: string, dbFile: string, root: string, side: string, sha: string, hash: string): Snapshot {
  const output = path.join(root, `${side}.json`);
  const loader = path.join(dir, 'node_modules/tsx/dist/loader.mjs');
  if (!existsSync(loader)) throw new Error(`tsx loader is missing in ${dir}`);
  const env = { ...process.env };
  for (const key of [
    'GUEST_MODE_ENABLED', 'BUTUYOKUOH_DB_PATH', 'CAPTURE_SECRETS_FILE',
    'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'YAHOO_SHOPPING_APP_ID',
    'RAKUTEN_APP_ID', 'RAKUTEN_ACCESS_KEY', 'AMAZON_ASSOCIATE_TAG',
  ]) delete env[key];
  env.BUTUYOKUOH_DB_PATH = dbFile;
  env.DIFF_TMP_ROOT = root;
  env.DIFF_PASSWORD_HASH = hash;
  env.JWT_SECRET = 'diff-harness-jwt-secret';
  env.AUTH_SECRET = 'diff-harness-auth-secret';
  env.NEXTAUTH_SECRET = 'diff-harness-auth-secret';
  env.NEXTAUTH_URL = 'http://127.0.0.1:3000';
  env.AUTH_URL = 'http://127.0.0.1:3000';
  env.GOOGLE_CLIENT_ID = 'diff-harness-google-client';
  env.GOOGLE_CLIENT_SECRET = 'diff-harness-google-secret';
  env.NODE_ENV = 'test';
  env.NEXT_TELEMETRY_DISABLED = '1';
  if (env.BUTUYOKUOH_DB_PATH.includes(`${path.sep}data${path.sep}butuyokuoh.db`)) {
    throw new Error('refusing production database');
  }
  const result = spawnSync(process.execPath, [
    '--require', path.join(dir, 'scripts/diff-harness/block-network.cjs'),
    '--import', loader,
    path.join(dir, 'scripts/diff-harness/driver.ts'),
    output,
    side,
    sha,
  ], { cwd: dir, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${side} driver failed`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return JSON.parse(readFileSync(output, 'utf8')) as Snapshot;
}

function assertOffline(snapshot: Snapshot) {
  if (snapshot.network.sockets !== 0 || snapshot.network.spawns.length > 0) {
    throw new Error(`${snapshot.side} tried to use the network or start a process\n${JSON.stringify(snapshot.network, null, 2)}`);
  }
}

function baselineSanity(snapshot: Snapshot) {
  const expect = (id: string, status: number) => {
    const step = snapshot.steps[id];
    if (!step || step.status !== status) {
      throw new Error(`baseline ${id} returned ${step?.status ?? step?.threw ?? 'nothing'}, expected ${status}`);
    }
  };
  expect('auth.login.success', 200);
  expect('items.create.amazon', 201);
  expect('items.create.rakuten', 201);
  expect('items.create.generic', 201);
  expect('items.create.short', 201);
  expect('items.list', 200);
  const refreshed = snapshot.steps['items.refresh.amazon.changed']?.json;
  const price = refreshed && typeof refreshed === 'object' && 'current_price' in refreshed
    ? (refreshed as { current_price: unknown }).current_price
    : null;
  if (price !== 980) throw new Error(`baseline did not apply the recorded price drop (${String(price)})`);
}

function main() {
  fetchDevelop();
  const baselineSha = git(['rev-parse', 'origin/develop']);
  const candidateSha = git(['rev-parse', 'HEAD']);
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'butuyokuoh-diff-')));
  const baselineDir = path.join(root, 'baseline');
  const candidateDir = path.join(root, 'candidate');
  try {
    git(['worktree', 'add', '--detach', baselineDir, baselineSha]);
    git(['worktree', 'add', '--detach', candidateDir, candidateSha]);
    copyHarness(baselineDir);
    copyHarness(candidateDir);
    install(baselineDir);
    install(candidateDir);
    const hash = passwordHash();
    const baseline = runSide(baselineDir, path.join(root, 'baseline.sqlite'), root, 'baseline', baselineSha, hash);
    const candidate = runSide(candidateDir, path.join(root, 'candidate.sqlite'), root, 'candidate', candidateSha, hash);
    assertOffline(baseline);
    assertOffline(candidate);
    baselineSanity(baseline);
    const report = compareSnapshots(baseline, candidate, loadApprovals(path.join(harnessDir, 'approved-changes.json')));
    const text = formatReport(report);
    // 共有の一時ディレクトリへ固定名で書くと、他のユーザーから読める。結果は標準出力だけにする。
    console.log(text);
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    for (const dir of [baselineDir, candidateDir]) {
      spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: repoRoot, encoding: 'utf8' });
    }
    rmSync(root, { recursive: true, force: true });
  }
}

main();
