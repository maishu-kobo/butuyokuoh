import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readHistory } from '../scripts/blacksmith-history.mjs';

const env = { GITHUB_TOKEN: 'synthetic-github-token', GITHUB_RUN_ID: '1002', GITHUB_RUN_NUMBER: '102' };
const window = { start: '2026-11-01T00:00:00.000Z', end: '2026-11-10T12:00:00.000Z' };
const run = (number: number, extra = {}) => ({ id: number + 900, run_number: number, event: 'push', head_branch: 'main', ...extra });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

it('GitHub公式APIだけへ読み取りトークンを送り、過去attemptを含めて必要なmain履歴を取得するべき', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, options) => {
    const url = String(input);
    assert.ok(options);
    calls.push(url);
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer synthetic-github-token');
    assert.equal(options.redirect, 'error');
    if (url.includes('/runs?')) return response({ total_count: 3, workflow_runs: [run(102), run(101, { event: 'pull_request' }), run(100)] });
    assert.match(url, /\/runs\/1000\/jobs\?/);
    assert.equal(new URL(url).searchParams.get('filter'), 'all');
    return response({ total_count: 2, jobs: [{ id: 1, run_attempt: 1 }, { id: 2, run_attempt: 2 }] });
  };
  const actual = await readHistory(env, window, 100, fakeFetch);
  assert.equal(actual.runs.length, 3);
  assert.equal(actual.jobRuns.length, 1);
  assert.equal(actual.jobRuns[0].jobs.length, 2);
  assert.equal(calls.length, 2);
});

it('全ページを回収し、PRの実行回数はBlacksmith予算の予約にしないべき', async () => {
  let pages = 0;
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    pages++;
    assert.match(url, /\/runs\?/);
    const page = Number(new URL(url).searchParams.get('page'));
    return response({ total_count: 101, workflow_runs: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => run(page === 1 ? 200 - i : 100, { event: 'pull_request' })) });
  };
  const actual = await readHistory({ ...env, GITHUB_RUN_NUMBER: '200', GITHUB_RUN_ID: '1100' }, window, 100, fakeFetch);
  assert.equal(actual.runs.length, 101);
  assert.deepEqual(actual.jobRuns, []);
  assert.equal(pages, 2);
});

it('ページ欠落・重複・件数変動・API上限・取得エラーを部分的な履歴として使わないべき', async () => {
  for (const mode of ['short', 'duplicate', 'changed', 'truncated', 'status', 'json', 'network']) {
    const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
      const page = Number(new URL(url).searchParams.get('page'));
      if (mode === 'network') throw new Error('synthetic-sensitive-error');
      if (mode === 'status') return response({ token: 'synthetic-sensitive-error' }, 403);
      if (mode === 'json') return new Response('invalid json');
      if (mode === 'truncated') return response({ total_count: 1000, workflow_runs: [] });
      if (mode === 'short') return response({ total_count: 5, workflow_runs: [run(100)] });
      return response({ total_count: mode === 'changed' && page === 2 ? 102 : 101,
        workflow_runs: page === 1 ? Array.from({ length: 100 }, (_, i) => run(200 - i, { event: 'pull_request' })) : [run(200)] });
    };
    await assert.rejects(readHistory(env, window, 100, fakeFetch));
  }
});

it('認証がない場合はAPIを呼ばないべき', async () => {
  await assert.rejects(readHistory({ ...env, GITHUB_TOKEN: '' }, window, 100, async () => { assert.fail('must not call'); }));
});
