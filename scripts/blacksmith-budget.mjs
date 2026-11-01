// Pure decision logic only. This module does not authenticate or start a runner.
// Units: platform-adjusted vCPU-minutes, not 2-vCPU-equivalent minutes.
export const limits = Object.freeze({
  blacksmithRunner: 'blacksmith-4vcpu-ubuntu-2404',
  allowanceRatio: 0.8,
  reservation: 4 * (20 + 10),
  maxJobMinutes: 30,
});

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function metric(report, window, key) {
  if (!record(report) || !record(report.window) || !record(report.summary) ||
      !record(report.installation) || report.installation.installation_name !== 'maishu-kobo' ||
      Date.parse(report.window.start) !== Date.parse(window.start) ||
      Date.parse(report.window.end) !== Date.parse(window.end) ||
      !nonnegative(report.summary[key])) {
    throw new Error('unrecognized-usage-report');
  }
  return report.summary[key];
}

// CLI 0.5.3 response shape verified by read-only requests on 2026-11-02 JST.
// Unknown/missing fields must never be interpreted as zero usage.
export function parseUsage(report, window) {
  return metric(report, window, 'billing_minutes');
}

export function parseStorage(report, window) {
  const cost = metric(report, window, 'estimated_cost_usd');
  if (report.summary.billing_data_available !== true ||
      !nonnegative(report.summary.current_usage_gb) ||
      report.summary.current_usage_gb !== 0) throw new Error('storage-unverified');
  return cost;
}

const github = (reason) => ({ runner: 'ubuntu-latest', reason });
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const timestamp = (value) => typeof value === 'string' ? Date.parse(value) : NaN;
const mainPush = (run) => run.event === 'push' && run.head_branch === 'main';

function eligibility(env, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const month = now.toISOString().slice(0, 7);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  if (env.GITHUB_REPOSITORY !== 'maishu-kobo/butuyokuoh' ||
      env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_WORKFLOW_REF !== 'maishu-kobo/butuyokuoh/.github/workflows/ci.yml@refs/heads/main' ||
      env.GITHUB_RUN_ATTEMPT !== '1' || env.BLACKSMITH_NO_CHARGE_CONFIRMED !== month ||
      end - now.getTime() <= 24 * 60 * 60 * 1000) return null;
  const budget = JSON.parse(env.BLACKSMITH_BUDGET || 'null');
  if (!record(budget) || budget.month !== month ||
      ![3000, 6000].includes(budget.freeVcpuMinutes) ||
      !positiveInteger(budget.historyStartRunNumber) ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER || '') || !positiveInteger(Number(env.GITHUB_RUN_NUMBER)) ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '') || !positiveInteger(Number(env.GITHUB_RUN_ID)) ||
      Number(env.GITHUB_RUN_NUMBER) < budget.historyStartRunNumber) return null;
  return { budget, window: { start: `${month}-01T00:00:00.000Z`, end: now.toISOString() } };
}

/** Reconstruct an upper bound independently of delayed provider aggregates.
 * Requires exclusive use of this gated workflow and billing bounded by GitHub job duration.
 * The full main workflow, not just its selector, MUST hold the concurrency lock.
 */
export function measureHistory(history, env, now, anchor) {
  const invalid = () => { throw new Error('history-unverified'); };
  if (!record(history) || !Array.isArray(history.runs) || !Array.isArray(history.jobRuns)) invalid();
  const number = Number(env.GITHUB_RUN_NUMBER);
  const currentId = Number(env.GITHUB_RUN_ID);
  const monthStart = Date.parse(`${now.toISOString().slice(0, 7)}-01T00:00:00Z`);
  const ids = new Set(), numbers = new Set();
  for (const run of history.runs) {
    if (!record(run) || !positiveInteger(run.id) || !positiveInteger(run.run_number) ||
        !positiveInteger(run.run_attempt) || !positiveInteger(run.workflow_id) ||
        run.path !== '.github/workflows/ci.yml' || typeof run.event !== 'string' || typeof run.head_branch !== 'string' ||
        !['completed', 'in_progress', 'queued', 'waiting', 'pending', 'requested'].includes(run.status) ||
        !Number.isFinite(timestamp(run.created_at)) || timestamp(run.created_at) < monthStart || timestamp(run.created_at) > now.getTime() ||
        ids.has(run.id) || numbers.has(run.run_number)) invalid();
    ids.add(run.id); numbers.add(run.run_number);
  }
  const current = history.runs.find((run) => run.id === currentId);
  if (!current || current.run_number !== number || current.run_attempt !== 1 ||
      current.status !== 'in_progress' || !mainPush(current) ||
      history.runs.some((run) => run.workflow_id !== current.workflow_id)) invalid();
  // The anchor detects missing/deleted history; it does NOT limit allowed run count.
  const covered = history.runs.filter((run) => run.run_number >= anchor && run.run_number <= number);
  if (covered.length !== number - anchor + 1) invalid();
  if (history.runs.some((run) => run.id !== currentId && mainPush(run) &&
      (run.status === 'in_progress' || (run.run_number < number && run.run_number >= anchor && run.status !== 'completed')))) invalid();
  const required = covered.filter((run) => run.id !== currentId && mainPush(run));
  if (history.jobRuns.length !== required.length) invalid();
  const groupIds = new Set(), jobIds = new Set();
  let completed = 0, inFlight = 0;
  for (const group of history.jobRuns) {
    if (!record(group) || !Array.isArray(group.jobs) || groupIds.has(group.runId)) invalid();
    groupIds.add(group.runId);
    const run = required.find((item) => item.id === group.runId);
    if (!run || (group.jobs.length === 0 && run.conclusion !== 'cancelled')) invalid();
    for (const job of group.jobs) {
      if (!record(job) || !positiveInteger(job.id) || jobIds.has(job.id) || job.run_id !== run.id ||
          !positiveInteger(job.run_attempt) || job.run_attempt > run.run_attempt ||
          !Array.isArray(job.labels) || !job.labels.every((label) => typeof label === 'string') ||
          !['completed', 'in_progress', 'queued'].includes(job.status)) invalid();
      jobIds.add(job.id);
      if (job.labels.length === 1 && job.labels[0] === 'ubuntu-latest') continue;
      if (job.labels.length !== 1 || job.labels[0] !== limits.blacksmithRunner || job.name !== 'test, types, build') invalid();
      if (job.status === 'queued') { inFlight += limits.reservation; continue; }
      const start = timestamp(job.started_at);
      if (!Number.isFinite(start) || start < monthStart || start < timestamp(run.created_at) || start > now.getTime()) invalid();
      if (job.status === 'in_progress') {
        if (now.getTime() - start > limits.maxJobMinutes * 60_000) invalid();
        inFlight += limits.reservation;
        continue;
      }
      const end = timestamp(job.completed_at);
      if (!Number.isFinite(end) || end < start || end > now.getTime() ||
          end - start > limits.maxJobMinutes * 60_000 || typeof job.conclusion !== 'string') invalid();
      // Round each job up; failure/cancellation and older attempts still consume time.
      completed += Math.max(1, Math.ceil((end - start) / 60_000)) * 4;
    }
  }
  return { completed, inFlight };
}

export async function chooseRunner({ env, now, readUsage, readStorage, readHistory }) {
  try {
    const eligible = eligibility(env, now);
    if (!eligible) return github('disabled-or-ineligible');
    const used = parseUsage(await readUsage(eligible.window), eligible.window);
    const storageCost = parseStorage(await readStorage(eligible.window), eligible.window);
    if (storageCost !== 0) return github('paid-storage-detected');
    const history = await readHistory(eligible.window, eligible.budget.historyStartRunNumber);
    const { completed, inFlight } = measureHistory(history, env, now, eligible.budget.historyStartRunNumber);
    const limit = eligible.budget.freeVcpuMinutes * limits.allowanceRatio;
    if (Math.max(used, completed) + inFlight + limits.reservation > limit) return github('budget-reserved');
    return { runner: limits.blacksmithRunner, reason: 'within-budget' };
  } catch {
    // Backend error messages can contain credentials or account details.
    return github('usage-unavailable');
  }
}
