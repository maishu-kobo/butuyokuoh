import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { chooseRunner, limits, measureHistory } from '../scripts/blacksmith-budget.mjs';

const now = new Date('2026-11-10T12:00:00Z');
const env = {
  GITHUB_REPOSITORY: 'maishu-kobo/butuyokuoh', GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_NUMBER: '102', GITHUB_RUN_ID: '1002',
  GITHUB_WORKFLOW_REF: 'maishu-kobo/butuyokuoh/.github/workflows/ci.yml@refs/heads/main',
  BLACKSMITH_NO_CHARGE_CONFIRMED: '2026-11',
  BLACKSMITH_BUDGET: JSON.stringify({ month: '2026-11', freeVcpuMinutes: 6000, historyStartRunNumber: 100 }),
};
const run = (number: number, extra = {}) => ({ id: number + 900, run_number: number,
  run_attempt: 1, workflow_id: 50, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main',
  created_at: '2026-11-10T09:00:00Z', status: number === 102 ? 'in_progress' : 'completed', ...extra });
const job = (id: number, runId = 1000, extra = {}) => ({ id, run_id: runId, run_attempt: 1,
  name: 'test, types, build', labels: ['blacksmith-4vcpu-ubuntu-2404'], status: 'completed', conclusion: 'success',
  started_at: '2026-11-10T10:00:00Z', completed_at: '2026-11-10T10:05:00Z', ...extra });
const history = () => ({ runs: [run(102), run(101, { event: 'pull_request', head_branch: 'feature/example' }), run(100)],
  jobRuns: [{ runId: 1000, jobs: [job(1)] }] });
const report = (window: object, summary: object) => ({ window, installation: { installation_name: 'maishu-kobo' }, summary });
async function decide(options: { used?: number; env?: object; history?: object; readUsage?: (window: object) => Promise<object>; readStorage?: (window: object) => Promise<object>; readHistory?: () => Promise<object>; now?: Date } = {}) {
  return chooseRunner({ env: { ...env, ...options.env }, now: options.now || now,
    readUsage: options.readUsage || (async (window: object) => report(window, { billing_minutes: options.used ?? 0 })),
    readStorage: options.readStorage || (async (window: object) => report(window, { estimated_cost_usd: 0, current_usage_gb: 0, billing_data_available: true })),
    readHistory: options.readHistory || (async () => options.history || history()) });
}

describe('80%の利用量判定', () => {
  it('無料枠の80%に次の最大実行分も収まる場合だけBlacksmithを選ぶべき', async () => {
    assert.equal((await decide({ used: 4680 })).runner, limits.blacksmithRunner);
    assert.equal((await decide({ used: 4680.01 })).runner, 'ubuntu-latest');
    const budget = { month: '2026-11', freeVcpuMinutes: 3000, historyStartRunNumber: 100 };
    assert.equal((await decide({ used: 2280, env: { BLACKSMITH_BUDGET: JSON.stringify(budget) } })).runner, limits.blacksmithRunner);
    assert.equal((await decide({ used: 2281, env: { BLACKSMITH_BUDGET: JSON.stringify(budget) } })).runner, 'ubuntu-latest');
  });
  it('10回を超えても実使用量に余裕があれば継続し、GitHubのPRは予算を消費しないべき', async () => {
    const runs = Array.from({ length: 52 }, (_, i) => run(100 + i, { status: i === 51 ? 'in_progress' : 'completed', event: i === 51 ? 'push' : 'pull_request' }));
    assert.equal((await decide({ env: { GITHUB_RUN_NUMBER: '151', GITHUB_RUN_ID: '1051' }, history: { runs, jobRuns: [] } })).runner, limits.blacksmithRunner);
  });
  it('集計が遅れた完了分と、実行中・待機中の最大予約を含めるべき', async () => {
    const h = history();
    h.jobRuns[0].jobs.push(job(2, 1000, { status: 'in_progress', conclusion: null, started_at: '2026-11-10T11:50:00Z', completed_at: null }));
    h.jobRuns[0].jobs.push(job(3, 1000, { status: 'queued', conclusion: null, started_at: null, completed_at: null }));
    assert.deepEqual(measureHistory(h, env, now, 100), { completed: 20, inFlight: 240 });
    assert.equal((await decide({ used: 4440, history: h })).runner, limits.blacksmithRunner);
    assert.equal((await decide({ used: 4441, history: h })).runner, 'ubuntu-latest');
    h.jobRuns[0].jobs = Array.from({ length: 50 }, (_, i) => job(i + 10, 1000, { completed_at: '2026-11-10T10:24:00Z' }));
    assert.equal((await decide({ used: 0, history: h })).runner, 'ubuntu-latest');
  });
  it('完了分を最大時間で固定せず、分単位切り上げの実時間へ戻すべき', () => {
    const h = history(); h.runs[2].run_attempt = 2;
    h.jobRuns[0].jobs = [job(1, 1000, { conclusion: 'failure' }), job(2, 1000, { run_attempt: 2, conclusion: 'cancelled', completed_at: '2026-11-10T10:00:01Z' })];
    assert.deepEqual(measureHistory(h, env, now, 100), { completed: 24, inFlight: 0 });
  });
  it('同じ時点で別のmain判定が進行中ならBlacksmithを選ばないべき', async () => {
    const h = history(); h.runs[2].status = 'in_progress';
    assert.equal((await decide({ history: h })).runner, 'ubuntu-latest');
  });
  it('利用量・ストレージ・実行履歴のいずれかを取得できなければGitHubへ戻るべき', async () => {
    for (const key of ['readUsage', 'readStorage', 'readHistory']) {
      assert.equal((await decide({ [key]: async () => { throw new Error('synthetic-sensitive-error'); } })).runner, 'ubuntu-latest');
    }
  });
  it('取得失敗の理由は段階ごとの固定値だけを返し、外部のエラー文を公開しないべき', async () => {
    const stages = [
      ['readUsage', 'usage-unavailable'],
      ['readStorage', 'storage-unavailable'],
      ['readHistory', 'history-unavailable'],
    ] as const;
    await fc.assert(fc.asyncProperty(fc.string(), fc.constantFrom(...stages), async (message, [stage, reason]) => {
      assert.deepEqual(await decide({ [stage]: async () => { throw new Error(message); } }),
        { runner: 'ubuntu-latest', reason });
    }), { seed: 28782, numRuns: 100 });
  });
  it('取得成功後の不正な応答は検証段階を区別してGitHubへ戻るべき', async () => {
    assert.deepEqual(await decide({ readUsage: async () => ({}) }),
      { runner: 'ubuntu-latest', reason: 'unrecognized-usage-report' });
    assert.deepEqual(await decide({ readStorage: async () => ({}) }),
      { runner: 'ubuntu-latest', reason: 'storage-unverified' });
    assert.deepEqual(await decide({ history: { runs: [], jobRuns: [] } }),
      { runner: 'ubuntu-latest', reason: 'history-unverified' });
  });
  it('秒精度のAPI応答と一致する期間を要求し、現在より未来の利用量を要求しないべき', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 999 }), async (milliseconds) => {
      const read = async (window: object) => {
        assert.equal((window as { end: string }).end, now.toISOString());
        return report({ ...window, end: '2026-11-10T12:00:00Z' }, { billing_minutes: 0 });
      };
      const result = await decide({ now: new Date(now.getTime() + milliseconds), readUsage: read });
      assert.equal(result.runner, limits.blacksmithRunner);
    }), { seed: 28783, numRuns: 100 });
  });
  it('履歴の欠落・重複・対象不一致を0として扱わないべき', async () => {
    const variants = [
      { ...history(), runs: [run(102), run(100)] },
      { ...history(), runs: [run(102), run(101), run(101)] },
      { ...history(), jobRuns: [] },
      { ...history(), jobRuns: [{ runId: 1000, jobs: [job(1), job(1)] }] },
      { ...history(), runs: [run(102, { id: 99 }), run(101), run(100)] },
      { ...history(), jobRuns: [{ runId: 1000, jobs: [job(1, 999)] }] },
      { ...history(), jobRuns: [{ runId: 1000, jobs: [job(1, 1000, { labels: ['blacksmith-32vcpu-ubuntu-2404'] })] }] },
      { ...history(), jobRuns: [{ runId: 1000, jobs: [job(1, 1000, { completed_at: null })] }] },
      { ...history(), jobRuns: [{ runId: 1000, jobs: [job(1, 1000, { completed_at: '2026-11-10T11:00:00Z' })] }] },
    ];
    for (const h of variants) assert.equal((await decide({ history: h })).runner, 'ubuntu-latest');
  });
  it('不正な無料枠・旧設定・確認期限切れ・月末はGitHubに戻りAPIを呼ばないべき', async () => {
    let calls = 0;
    const readUsage = async () => { calls++; throw new Error('must not run'); };
    for (const budget of ['invalid', '{}', '{"month":"2026-11","firstRunNumber":100}', JSON.stringify({ month: '2026-11', freeVcpuMinutes: 60000, historyStartRunNumber: 100 })]) {
      assert.equal((await decide({ env: { BLACKSMITH_BUDGET: budget }, readUsage })).runner, 'ubuntu-latest');
    }
    for (const extra of [{ BLACKSMITH_NO_CHARGE_CONFIRMED: '' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/develop' }, { GITHUB_REPOSITORY: 'someone/fork' }, { GITHUB_WORKFLOW_REF: 'another.yml@refs/heads/main' }]) {
      assert.equal((await decide({ env: extra, readUsage })).runner, 'ubuntu-latest');
    }
    assert.equal((await decide({ now: new Date('2026-11-30T12:00:00Z'), readUsage })).runner, 'ubuntu-latest');
    assert.equal((await decide({ now: new Date('2026-12-02T12:00:00Z'), readUsage })).runner, 'ubuntu-latest');
    assert.equal(calls, 0);
  });
  it('請求明細欠落・有料ストレージ・期間や単位不明を許可しないべき', async () => {
    for (const summary of [{ estimated_cost_usd: 0, current_usage_gb: 0, billing_data_available: false }, { estimated_cost_usd: 1, current_usage_gb: 0, billing_data_available: true }, { estimated_cost_usd: 0, current_usage_gb: 1, billing_data_available: true }]) {
      assert.equal((await decide({ readStorage: async (window: object) => report(window, summary) })).runner, 'ubuntu-latest');
    }
    for (const summary of [{}, { billing_minutes: -1 }, { billing_minutes: '0' }, { billing_minutes: Infinity }]) {
      assert.equal((await decide({ readUsage: async (window: object) => report(window, summary) })).runner, 'ubuntu-latest');
    }
    assert.equal((await decide({ readUsage: async () => report({}, { billing_minutes: 0 }) })).runner, 'ubuntu-latest');
  });
  it('利用量がどう変わっても、実行中と次の予約を含む80%超えを許可しないべき', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 8 }), async (used, active) => {
      const h = history(); h.jobRuns[0].jobs.push(...Array.from({ length: active }, (_, i) => job(i + 2, 1000, { status: 'queued', conclusion: null, started_at: null, completed_at: null })));
      const result = await decide({ used, history: h });
      assert.equal(result.runner === limits.blacksmithRunner, Math.max(used, 20) + active * 120 + 120 <= 4800);
    }), { seed: 28780, numRuns: 100 });
  });
  it('任意の短い完了時間では実時間に比例し、回数だけの固定消費にならないべき', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 1200 }), { minLength: 1, maxLength: 80 }), (seconds) => {
      const h = history();
      h.jobRuns[0].jobs = seconds.map((duration, i) => job(i + 1, 1000, { completed_at: new Date(Date.parse('2026-11-10T10:00:00Z') + duration * 1000).toISOString() }));
      assert.equal(measureHistory(h, env, now, 100).completed, seconds.reduce((sum, value) => sum + Math.ceil(value / 60) * 4, 0));
    }), { seed: 28781, numRuns: 100 });
  });
});
