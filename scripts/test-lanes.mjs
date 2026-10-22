/**
 * 必須レーンと隔離レーンでテストを分ける。
 * 隔離リストは .github/test-quarantine.txt。パスが無いときは必須側が全部走る。
 * 保護したテストはリストに書けない。必須レーンが拒否する。
 * e2e は playwright test --list の結果から、隔離分だけを引く。リストが空でも同じ。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROTECTED_TESTS = [
  'tests/test-lanes.test.ts',
  'tests/bugfix-ssrf.test.ts',
  'tests/regression-auth.test.ts',
  'tests/capture-secrets.test.ts',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quarantinePath = join(root, '.github', 'test-quarantine.txt');

export function parseQuarantine(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    entries.push(line.replace(/^\.\//, ''));
  }
  return entries;
}

export function listUnitTests(names) {
  return names.filter((name) => name.endsWith('.test.ts')).sort().map((name) => `tests/${name}`);
}

export function protectedQuarantineEntries(quarantined) {
  const set = new Set(PROTECTED_TESTS);
  return quarantined.filter((path) => set.has(path));
}

export function selectBlockingE2e(discovered, quarantined) {
  const skip = new Set(quarantined);
  return discovered.filter((path) => !skip.has(path));
}

export function e2eFilesFromPlaywrightReport(report, repoRoot) {
  const rootDir = report && report.config && report.config.rootDir;
  if (!rootDir) return [];
  const files = new Set();
  const walk = (suite) => {
    if (!suite || typeof suite !== 'object') return;
    if (typeof suite.file === 'string' && suite.file) files.add(suite.file);
    for (const spec of suite.specs || []) {
      if (spec && typeof spec.file === 'string' && spec.file) files.add(spec.file);
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of report.suites || []) walk(suite);
  return [...files].map((file) => {
    const abs = isAbsolute(file) ? file : join(rootDir, file);
    return relative(repoRoot, abs).split(sep).join('/');
  }).sort();
}

export function partitionTests({ unitTests, e2eTests, quarantined }) {
  const protectedHits = protectedQuarantineEntries(quarantined);
  const protectedSet = new Set(protectedHits);
  const unit = new Set(unitTests);
  const e2e = new Set(e2eTests);
  const unknown = [];
  const quarantineUnit = [];
  const quarantineE2e = [];
  for (const path of quarantined) {
    if (protectedSet.has(path)) continue;
    if (unit.has(path)) quarantineUnit.push(path);
    else if (e2e.has(path)) quarantineE2e.push(path);
    else unknown.push(path);
  }
  const quarantinedUnit = new Set(quarantineUnit);
  return {
    protected: protectedHits,
    unknown,
    blockingUnit: unitTests.filter((path) => !quarantinedUnit.has(path)),
    blockingE2e: selectBlockingE2e(e2eTests, quarantined),
    quarantineUnit,
    quarantineE2e,
  };
}

function readState(e2eTests = []) {
  const text = readFileSync(quarantinePath, 'utf8');
  const quarantined = parseQuarantine(text);
  const unitTests = listUnitTests(readdirSync(join(root, 'tests')));
  return { quarantined, ...partitionTests({ unitTests, e2eTests, quarantined }) };
}

function discoveredE2eFiles() {
  const playwright = join(root, 'node_modules', '.bin', 'playwright');
  const result = spawnSync(playwright, ['test', '--list', '--reporter=json'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    console.error('playwright test --list が失敗した');
    return null;
  }
  try {
    return e2eFilesFromPlaywrightReport(JSON.parse(result.stdout), root);
  } catch (error) {
    console.error('playwright の一覧を読めなかった');
    console.error(error);
    return null;
  }
}

function rejectProtected(hits) {
  if (hits.length === 0) return true;
  console.error('隔離できないテストがある:');
  for (const path of hits) console.error(`  ${path}`);
  return false;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status === 0;
}

function runBlockingUnit(files) {
  if (files.length === 0) {
    console.error('必須の単体テストが 0 件。隔離リストで全部は外せない。');
    return false;
  }
  return run(process.execPath, ['--import', 'tsx', '--test', ...files]);
}

function runE2e(files) {
  if (files.length === 0) {
    console.error('必須の e2e が 0 件。隔離リストで全部は外せない。');
    return false;
  }
  return run('npx', ['playwright', 'test', ...files]);
}

function runQuarantine(state) {
  let ok = true;
  if (state.unknown.length > 0) {
    console.error('隔離リストに、単体テストでも e2e でもないパスがある:');
    for (const path of state.unknown) console.error(`  ${path}`);
    ok = false;
  }
  if (state.quarantineUnit.length === 0 && state.quarantineE2e.length === 0) {
    console.log('隔離したテストは 0 件。');
    return ok;
  }
  console.log(`隔離した単体 ${state.quarantineUnit.length} 件、e2e ${state.quarantineE2e.length} 件。`);
  if (state.quarantineUnit.length > 0 && !runBlockingUnit(state.quarantineUnit)) ok = false;
  if (state.quarantineE2e.length > 0 && !runE2e(state.quarantineE2e)) ok = false;
  return ok;
}

function main() {
  const command = process.argv[2];
  const state = readState();
  if (command === 'count') {
    const protectedSet = new Set(protectedQuarantineEntries(state.quarantined));
    const unitSet = new Set(state.quarantineUnit);
    let unit = 0;
    let e2e = 0;
    for (const path of state.quarantined) {
      if (protectedSet.has(path)) continue;
      if (unitSet.has(path)) unit += 1;
      else if (path.startsWith('tests/e2e/') && path.endsWith('.spec.ts')) e2e += 1;
    }
    console.log(`${unit} ${e2e}`);
    return;
  }
  if (command === 'blocking-unit') {
    const protectedHits = protectedQuarantineEntries(state.quarantined);
    if (!rejectProtected(protectedHits)) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = runBlockingUnit(state.blockingUnit) ? 0 : 1;
    return;
  }
  if (command === 'blocking-e2e') {
    const protectedHits = protectedQuarantineEntries(state.quarantined);
    if (!rejectProtected(protectedHits)) {
      process.exitCode = 1;
      return;
    }
    const discovered = discoveredE2eFiles();
    if (!discovered) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = runE2e(selectBlockingE2e(discovered, state.quarantined)) ? 0 : 1;
    return;
  }
  if (command === 'quarantine') {
    const protectedHits = protectedQuarantineEntries(state.quarantined);
    if (!rejectProtected(protectedHits)) {
      process.exitCode = 1;
      return;
    }
    const mayHaveE2e = state.quarantined.some((path) => path.startsWith('tests/e2e/') && path.endsWith('.spec.ts'));
    const discovered = mayHaveE2e ? discoveredE2eFiles() : [];
    if (!discovered) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = runQuarantine(readState(discovered)) ? 0 : 1;
    return;
  }
  console.error('使い方: node scripts/test-lanes.mjs count|blocking-unit|blocking-e2e|quarantine');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
