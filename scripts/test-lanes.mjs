/**
 * 必須レーンと隔離レーンでテストを分ける。
 * 隔離リストは .github/test-quarantine.txt。パスが無いときは必須側が全部走る。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_E2E = [
  'tests/e2e/guest.spec.ts',
  'tests/e2e/capture.spec.ts',
  'tests/e2e/capture-photo-pick.spec.ts',
  'tests/e2e/capture-photo-group.spec.ts',
  'tests/e2e/capture-flow.spec.ts',
  'tests/e2e/capture-manual.spec.ts',
];

export const DISABLED_E2E = 'tests/e2e/disabled.spec.ts';

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

/**
 * @param {{ E2E_GUEST_DISABLED?: string }} [env]
 */
export function activeE2eTests(env = process.env) {
  return env.E2E_GUEST_DISABLED ? [DISABLED_E2E] : DEFAULT_E2E;
}

export function knownE2eTests() {
  return [...DEFAULT_E2E, DISABLED_E2E];
}

export function partitionTests({ unitTests, e2eTests, quarantined }) {
  const unit = new Set(unitTests);
  const knownE2e = new Set(knownE2eTests());
  const activeE2e = new Set(e2eTests);
  const unknown = [];
  const quarantineUnit = [];
  const quarantineE2e = [];
  for (const path of quarantined) {
    if (unit.has(path)) quarantineUnit.push(path);
    else if (knownE2e.has(path)) quarantineE2e.push(path);
    else unknown.push(path);
  }
  const quarantinedUnit = new Set(quarantineUnit);
  const quarantinedE2e = new Set(quarantineE2e);
  return {
    unknown,
    blockingUnit: unitTests.filter((path) => !quarantinedUnit.has(path)),
    blockingE2e: e2eTests.filter((path) => !quarantinedE2e.has(path)),
    quarantineUnit,
    quarantineE2e: quarantineE2e.filter((path) => activeE2e.has(path) || knownE2e.has(path)),
  };
}

function readState() {
  const text = readFileSync(quarantinePath, 'utf8');
  const quarantined = parseQuarantine(text);
  const unitTests = listUnitTests(readdirSync(join(root, 'tests')));
  const e2eTests = activeE2eTests();
  return { quarantined, ...partitionTests({ unitTests, e2eTests, quarantined }) };
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

function runBlockingE2e(files, quarantinedE2e) {
  if (quarantinedE2e.length === 0) return run('npx', ['playwright', 'test']);
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
  if (state.quarantineE2e.length > 0 && !run('npx', ['playwright', 'test', ...state.quarantineE2e])) ok = false;
  return ok;
}

function main() {
  const command = process.argv[2];
  const state = readState();
  if (command === 'count') {
    console.log(`${state.quarantineUnit.length} ${state.quarantineE2e.length}`);
    return;
  }
  if (command === 'blocking-unit') {
    process.exitCode = runBlockingUnit(state.blockingUnit) ? 0 : 1;
    return;
  }
  if (command === 'blocking-e2e') {
    process.exitCode = runBlockingE2e(state.blockingE2e, state.quarantineE2e) ? 0 : 1;
    return;
  }
  if (command === 'quarantine') {
    process.exitCode = runQuarantine(state) ? 0 : 1;
    return;
  }
  console.error('使い方: node scripts/test-lanes.mjs count|blocking-unit|blocking-e2e|quarantine');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
