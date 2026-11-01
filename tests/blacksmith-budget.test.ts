import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { chooseRunner, limits, parseUsage, parseStorage } from '../scripts/blacksmith-budget.mjs';

const now = new Date('2026-11-10T12:00:00Z');
const window = { start: '2026-11-01T00:00:00Z', end: now.toISOString() };
const installation = { installation_name: 'maishu-kobo' };
const usage = { window, installation, summary: { billing_minutes: 0 } };
const storage = { window, installation, summary: { estimated_cost_usd: 0, current_usage_gb: 0, billing_data_available: true } };
const env = {
  GITHUB_REPOSITORY: 'maishu-kobo/butuyokuoh',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: 'maishu-kobo/butuyokuoh/.github/workflows/ci.yml@refs/heads/main',
  GITHUB_RUN_NUMBER: '100',
  GITHUB_RUN_ATTEMPT: '1',
  BLACKSMITH_NO_CHARGE_CONFIRMED: '2026-11',
  BLACKSMITH_BUDGET: JSON.stringify({ month: '2026-11', firstRunNumber: 100 }),
};

function options(overrides = {}) {
  return {
    env, now,
    readUsage: async () => usage,
    readStorage: async () => storage,
    ...overrides,
  };
}

describe('Blacksmithの実行前判定', () => {
  it('有効期限内で利用量と回数に余裕がある場合だけBlacksmithを選ぶべき', async () => {
    assert.equal((await chooseRunner(options())).runner, limits.blacksmithRunner);
  });

  it('設定がない場合は外部APIを呼ばずGitHubを選ぶべき', async () => {
    let calls = 0;
    const result = await chooseRunner(options({ env: {}, readUsage: async () => { calls++; return usage; } }));
    assert.equal(result.runner, 'ubuntu-latest');
    assert.equal(calls, 0);
  });

  it('利用量かストレージ情報を取得できなければGitHubを選ぶべき', async () => {
    for (const key of ['readUsage', 'readStorage']) {
      const result = await chooseRunner(options({ [key]: async () => { throw new Error('secret must not be logged'); } }));
      assert.equal(result.runner, 'ubuntu-latest');
      assert.doesNotMatch(JSON.stringify(result), /secret must not be logged/);
    }
  });

  it('次の実行の最大消費分を確保できない場合はGitHubを選ぶべき', async () => {
    for (const amount of [limits.monthlyLimit - limits.reservation + 0.01, limits.monthlyLimit, 3000]) {
      const result = await chooseRunner(options({ readUsage: async () => ({ ...usage, summary: { billing_minutes: amount } }) }));
      assert.equal(result.runner, 'ubuntu-latest');
    }
    const result = await chooseRunner(options({ readUsage: async () => ({ ...usage, summary: { billing_minutes: limits.monthlyLimit - limits.reservation } }) }));
    assert.equal(result.runner, limits.blacksmithRunner);
  });

  it('集計がゼロのままでも月内の割当回数を超えてBlacksmithを選ばないべき', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      chooseRunner(options({ env: { ...env, GITHUB_RUN_NUMBER: String(100 + index) } }))));
    assert.equal(results.filter((result) => result.runner === limits.blacksmithRunner).length, limits.maxRuns);
    assert.ok(limits.maxRuns * limits.reservation <= limits.monthlyLimit);
    assert.ok(limits.monthlyLimit < 3000 / 2);
  });

  it('順序や並列実行にかかわらず異なる実行番号にだけ上限以内の枠を割り当てるべき', async () => {
    await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.integer({ min: 1, max: 200 })), async (numbers) => {
      const results = await Promise.all(numbers.map((number) => chooseRunner(options({
        env: { ...env, GITHUB_RUN_NUMBER: String(number) },
      }))));
      assert.ok(results.filter((result) => result.runner === limits.blacksmithRunner).length <= limits.maxRuns);
    }), { seed: 287, numRuns: 60 });
  });

  it('再実行では元の判定結果にかかわらずGitHubを選ぶべき', async () => {
    for (const attempt of ['2', '3', '0', '-1', '1.0', 'NaN', '']) {
      assert.equal((await chooseRunner(options({ env: { ...env, GITHUB_RUN_ATTEMPT: attempt } }))).runner, 'ubuntu-latest');
    }
  });

  it('PR・fork・他ブランチ・他ワークフロー・他リポジトリではGitHubを選ぶべき', async () => {
    for (const override of [
      { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'pull_request_target' },
      { GITHUB_REF: 'refs/heads/feature/test' }, { GITHUB_REPOSITORY: 'example/other' },
      { GITHUB_WORKFLOW_REF: 'maishu-kobo/butuyokuoh/.github/workflows/other.yml@refs/heads/main' },
    ]) {
      assert.equal((await chooseRunner(options({ env: { ...env, ...override } }))).runner, 'ubuntu-latest');
    }
  });

  it('月替わり・確認期限切れ・月末の実行ではGitHubを選ぶべき', async () => {
    for (const time of ['2026-10-31T23:59:59Z', '2026-11-30T12:00:00Z', '2026-12-01T00:00:00Z']) {
      assert.equal((await chooseRunner(options({ now: new Date(time) }))).runner, 'ubuntu-latest');
    }
    assert.equal((await chooseRunner(options({ env: { ...env, BLACKSMITH_NO_CHARGE_CONFIRMED: 'true' } }))).runner, 'ubuntu-latest');
  });

  it('不正な設定・回数超過はGitHubへ倒すべき', async () => {
    for (const override of [
      { BLACKSMITH_BUDGET: '{invalid' }, { BLACKSMITH_BUDGET: '{}' },
      { BLACKSMITH_BUDGET: JSON.stringify({ month: '2026-11', firstRunNumber: -1 }) },
      { BLACKSMITH_BUDGET: JSON.stringify({ month: '2026-11', firstRunNumber: 1.5 }) },
      { GITHUB_RUN_NUMBER: '99' }, { GITHUB_RUN_NUMBER: '110' },
    ]) {
      assert.equal((await chooseRunner(options({ env: { ...env, ...override } }))).runner, 'ubuntu-latest');
    }
  });

  it('有料ストレージの利用が見つかった場合はGitHubを選ぶべき', async () => {
    for (const override of [{ estimated_cost_usd: 0.01 }, { current_usage_gb: 1 }, { billing_data_available: false }]) {
      assert.equal((await chooseRunner(options({ readStorage: async () => ({ ...storage, summary: { ...storage.summary, ...override } }) }))).runner, 'ubuntu-latest');
    }
  });

  it('どの利用量でも次の最大予約分を含めて内部上限を超えないべき', async () => {
    await fc.assert(fc.asyncProperty(
      fc.double({ min: 0, max: 10000, noNaN: true }), fc.integer({ min: 100, max: 115 }),
      async (minutes, runNumber) => {
        const result = await chooseRunner(options({
          env: { ...env, GITHUB_RUN_NUMBER: String(runNumber) },
          readUsage: async () => ({ ...usage, summary: { billing_minutes: minutes } }),
        }));
        if (result.runner === limits.blacksmithRunner) {
          assert.ok(Math.max(minutes, (runNumber - 100) * limits.reservation) + limits.reservation <= limits.monthlyLimit);
          assert.ok(runNumber < 100 + limits.maxRuns);
        }
      },
    ), { seed: 288, numRuns: 100 });
  });
});

describe('外部の利用量データ', () => {
  it('月初から今回の問い合わせ時刻までの明示的な数値だけを受け入れるべき', () => {
    assert.equal(parseUsage(usage, window), 0);
    assert.equal(parseStorage(storage, window), 0);
    for (const invalid of [null, [], {}, { summary: { billing_minutes: 0 } },
      { ...usage, summary: {} }, { ...usage, summary: { billing_minutes: '0' } },
      { ...usage, summary: { billing_minutes: -1 } }, { ...usage, summary: { billing_minutes: Infinity } },
      { ...usage, window: { ...window, start: '2026-11-02T00:00:00Z' } },
      { ...usage, window: { ...window, end: '2026-11-09T12:00:00Z' } },
      { ...usage, installation: { installation_name: 'another-organization' } },
    ]) assert.throws(() => parseUsage(invalid, window));
  });

  it('集計の欠落をゼロに置き換えないべき', () => {
    for (const value of [null, {}, { ...storage, summary: {} }, { ...storage, summary: { ...storage.summary, estimated_cost_usd: '0' } }]) {
      assert.throws(() => parseStorage(value, window));
    }
  });
});
