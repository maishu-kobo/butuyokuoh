// GitHub-only, read-only requests. Never use provider credentials or response URLs.
const root = 'https://api.github.com/repos/maishu-kobo/butuyokuoh/actions';

export async function readHistory(env, window, anchor, fetchImpl = globalThis.fetch) {
  if (!env.GITHUB_TOKEN) throw new Error('github-authentication-unavailable');
  async function pages(path, query, field) {
    const rows = [], ids = new Set();
    let expected;
    for (let page = 1; page <= 10; page++) {
      const url = `${root}/${path}?${new URLSearchParams({ ...query, per_page: '100', page: String(page) })}`;
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10' },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('github-history-unavailable');
      const data = await response.json();
      // GitHub search is capped at 1,000 results. A potentially truncated set is not a ledger.
      if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count >= 1000 ||
          !Array.isArray(data[field]) || data[field].length > 100 ||
          (expected !== undefined && expected !== data.total_count)) throw new Error('github-history-incomplete');
      expected = data.total_count;
      for (const row of data[field]) {
        if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) throw new Error('github-history-incomplete');
        ids.add(row.id); rows.push(row);
      }
      if (rows.length === expected) return rows;
      if (rows.length > expected || data[field].length !== 100) throw new Error('github-history-incomplete');
    }
    throw new Error('github-history-incomplete');
  }
  // reusable ci は deploy-main の run に載る。単体 ci.yml の履歴は使わない。
  const runs = await pages('workflows/deploy-main.yml/runs', { created: `${window.start}..${window.end}` }, 'workflow_runs');
  const jobRuns = [];
  for (const run of runs) {
    // Exclusive runner/workflow scope is an activation prerequisite. PRs cannot use it.
    if (run.run_number >= anchor && run.run_number < Number(env.GITHUB_RUN_NUMBER) &&
        run.event === 'push' && run.head_branch === 'main') {
      const jobs = await pages(`runs/${run.id}/jobs`, { filter: 'all' }, 'jobs');
      jobRuns.push({ runId: run.id, jobs });
    }
  }
  return { runs, jobRuns };
}
