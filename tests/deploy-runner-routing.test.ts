import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// These two workflow expressions use only boolean/string operators, shared by
// GitHub expressions and JavaScript. Evaluate the actual configuration, including
// a stale successful selector output, instead of duplicating the routing logic.
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const selector = workflow.match(/  select-runner:[\s\S]*?    if: >-\n([\s\S]*?)\n    permissions:/)?.[1];
const runner = workflow.match(/  check:[\s\S]*?    runs-on: >-\n([\s\S]*?)\n    timeout-minutes:/)?.[1];
function evaluate(expression: string | undefined, hostedOnly: boolean, event = 'push', attempt = 1) {
  assert.ok(expression);
  return runInNewContext(expression.trim().replace(/^\$\{\{/, '').replace(/\}\}$/, ''), {
    inputs: { github_hosted_only: hostedOnly },
    github: { event_name: event, ref: 'refs/heads/main', run_attempt: attempt },
    vars: { BLACKSMITH_NO_CHARGE_CONFIRMED: 'configured', BLACKSMITH_BUDGET: 'configured' },
    needs: { 'select-runner': { result: 'success', outputs: { runner: 'blacksmith-4vcpu-ubuntu-2404' } } },
  }, { timeout: 100 });
}

test('deployment CI neither reserves external budget nor reuses an external runner selection', () => {
  assert.equal(evaluate(selector, true), false);
  assert.equal(evaluate(runner, true), 'ubuntu-latest');
  const caller = readFileSync('.github/workflows/deploy-main.yml', 'utf8');
  assert.match(caller, /ci:\n[\s\S]*?with:\n\s+github_hosted_only: true\n/);
});

test('normal main CI retains its existing guarded routing and retry fallback', () => {
  assert.equal(evaluate(selector, false), true);
  assert.equal(evaluate(runner, false), 'blacksmith-4vcpu-ubuntu-2404');
  for (const [event, attempt] of [['pull_request', 1], ['push', 2]] as const) {
    assert.equal(evaluate(selector, false, event, attempt), false);
    assert.equal(evaluate(runner, false, event, attempt), 'ubuntu-latest');
  }
});
