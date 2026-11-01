import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGuard } from '../scripts/blacksmith-usage.mjs';

const now = new Date('2026-11-10T12:00:00Z');

async function scenario(mode: string, token = 'synthetic-unit-test-secret') {
  const directory = mkdtempSync(path.join(tmpdir(), 'blacksmith-guard-test-'));
  const binary = path.join(directory, 'cli');
  const calls = path.join(directory, 'calls.jsonl');
  const output = path.join(directory, 'output');
  const summary = path.join(directory, 'summary');
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (${JSON.stringify(mode)} === 'error') {
  process.stderr.write('synthetic-unit-test-secret'); process.exit(1);
}
if (args[0] === 'auth') {
  const input = fs.readFileSync(0, 'utf8');
  if (input.trim() !== 'synthetic-unit-test-secret') process.exit(2);
  process.exit(0);
}
if (${JSON.stringify(mode)} === 'invalid-json') { process.stdout.write('not json'); process.exit(0); }
const window = {start: args[args.indexOf('--start-time') + 1], end: args[args.indexOf('--end-time') + 1]};
const summary = args.includes('storage')
  ? {estimated_cost_usd: 0, current_usage_gb: 0, billing_data_available: ${mode !== 'unavailable-ledger'}}
  : {billing_minutes: 0};
process.stdout.write(JSON.stringify({window, installation: {installation_name: 'maishu-kobo'}, summary}));
`, { mode: 0o700 });
  try {
    const result = await runGuard({
      NODE_ENV: 'test',
      GITHUB_REPOSITORY: 'maishu-kobo/butuyokuoh', GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_NUMBER: '100',
      GITHUB_WORKFLOW_REF: 'maishu-kobo/butuyokuoh/.github/workflows/ci.yml@refs/heads/main',
      BLACKSMITH_NO_CHARGE_CONFIRMED: '2026-11',
      BLACKSMITH_BUDGET: JSON.stringify({ month: '2026-11', firstRunNumber: 100 }),
      BLACKSMITH_BINARY: binary, BLACKSMITH_ORG_TOKEN: token,
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
    }, now);
    return { result, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8'),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it('公式CLIとの境界ではトークンを引数や出力に含めず組織全体の月初からの利用量を取得するべき', async () => {
  const result = await scenario('success');
  assert.equal(result.result.runner, 'blacksmith-4vcpu-ubuntu-2404');
  assert.match(result.calls, /"auth","login","--api-token","-"/);
  assert.match(result.calls, /"usage","storage"/);
  assert.match(result.calls, /"--start-time","2026-11-01T00:00:00.000Z"/);
  assert.doesNotMatch(result.calls, /--repo|--runner-label/);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-unit-test-secret/);
});

it('認証失敗・JSON破損・請求データ欠落ではGitHub出力を保ち秘密を表示しないべき', async () => {
  for (const mode of ['error', 'invalid-json', 'unavailable-ledger']) {
    const result = await scenario(mode);
    assert.equal(result.result.runner, 'ubuntu-latest');
    assert.doesNotMatch(result.output, /runner=blacksmith/);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-unit-test-secret/);
  }
});

it('トークンがない場合はCLIを一度も起動せずGitHubを選ぶべき', async () => {
  const result = await scenario('success', '');
  assert.equal(result.result.runner, 'ubuntu-latest');
  assert.equal(result.calls, '');
});
