// Pure decision logic only. This module does not authenticate or start a runner.
// Units: platform-adjusted vCPU-minutes, not 2-vCPU-equivalent minutes.
export const limits = Object.freeze({
  blacksmithRunner: 'blacksmith-4vcpu-ubuntu-2404',
  monthlyLimit: 1200,
  reservation: 4 * (20 + 10),
  maxRuns: 10,
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
  const number = Number(env.GITHUB_RUN_NUMBER);
  if (!record(budget) || budget.month !== month ||
      !Number.isSafeInteger(budget.firstRunNumber) || budget.firstRunNumber < 1 ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER || '') || !Number.isSafeInteger(number)) return null;
  const slot = number - budget.firstRunNumber;
  if (slot < 0 || slot >= limits.maxRuns) return null;
  return { slot, window: { start: `${month}-01T00:00:00.000Z`, end: now.toISOString() } };
}

/** A fixed run-number window bounds reservations even if usage is delayed.
 * Every CI run consumes a slot, including GitHub/cancelled runs. Never refund it.
 * The initial usage must be zero and this window must not be reset within a month.
 */
export async function chooseRunner({ env, now, readUsage, readStorage }) {
  try {
    const eligible = eligibility(env, now);
    if (!eligible) return github('disabled-or-ineligible');
    const used = parseUsage(await readUsage(eligible.window), eligible.window);
    const storageCost = parseStorage(await readStorage(eligible.window), eligible.window);
    if (storageCost !== 0) return github('paid-storage-detected');
    const reserved = eligible.slot * limits.reservation;
    if (Math.max(used, reserved) + limits.reservation > limits.monthlyLimit) {
      return github('budget-reserved');
    }
    return { runner: limits.blacksmithRunner, reason: 'within-budget' };
  } catch {
    // Backend error messages can contain credentials or account details.
    return github('usage-unavailable');
  }
}
