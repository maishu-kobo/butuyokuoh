import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// @eslint/eslintrc owns this parser in the existing ESLint dependency tree.
// Resolve from that package so the test does not depend on root-level hoisting.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('@eslint/eslintrc'))('js-yaml');
const source = readFileSync('.github/workflows/deploy-main.yml', 'utf8');
const workflow = load(source);
const codeql = load(readFileSync('.github/workflows/codeql.yml', 'utf8'));
const codeqlMain = load(readFileSync('.github/workflows/codeql-main.yml', 'utf8'));

test('main and its PRs share codeql.yml configuration; deploy-main security runs only off PRs', () => {
  for (const branch of workflow.on.push.branches) {
    assert.ok(workflow.on.pull_request.branches.includes(branch), `missing PR comparison for ${branch}`);
  }
  assert.ok(codeql.on.pull_request.branches.includes('main'));
  assert.equal(workflow.jobs.security.uses, './.github/workflows/codeql.yml');
  assert.match(String(workflow.jobs.security.if), /github\.event_name\s*!=\s*'pull_request'/);
  for (const name of ['ci', 'browser', 'secrets-scan', 'quarantine', 'security'] as const) {
    assert.match(String(workflow.jobs[name].if), /github\.event_name\s*!=\s*'pull_request'/, name);
  }
  assert.equal(codeqlMain.on.pull_request, undefined);
  assert.equal(codeqlMain.on.push, undefined);
  assert.ok(codeqlMain.on.schedule);
  assert.deepEqual([...workflow.jobs.deploy.needs].sort(), ['browser', 'ci', 'quarantine', 'secrets-scan', 'security']);
});

test('only enabled main push or manual dispatch can enter the production credential job', () => {
  // Evaluate the actual job condition over these lowercase fixtures. Actions
  // compares strings case-insensitively, so this is not a general interpreter.
  // The deployment client separately enforces exact event/ref/repository values.
  for (const event of ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target', 'workflow_run', 'schedule']) {
    for (const ref of ['refs/heads/main', 'refs/heads/develop', 'refs/heads/feature/auto-deploy', 'refs/pull/1/merge']) {
      for (const repository of ['maishu-kobo/butuyokuoh', 'fork/butuyokuoh']) {
        for (const enabled of ['true', 'false', '']) {
          const allowed = runInNewContext(workflow.jobs.deploy.if.trim(), {
            github: { event_name: event, ref, repository },
            vars: { AUTO_DEPLOY_ENABLED: enabled },
          }, { timeout: 100 });
          const expected = ['push', 'workflow_dispatch'].includes(event)
            && ref === 'refs/heads/main' && repository === 'maishu-kobo/butuyokuoh' && enabled === 'true';
          assert.equal(allowed, expected, JSON.stringify({ event, ref, repository, enabled }));
        }
      }
    }
  }
  assert.equal(workflow.jobs.deploy.environment.name, 'production');
  for (const [name, job] of Object.entries(workflow.jobs) as [string, Record<string, unknown>][]) {
    if (name === 'deploy') continue;
    assert.equal(job.environment, undefined, `${name} must not access production`);
    assert.equal(job.secrets, undefined, `${name} must not inherit deployment secrets`);
    assert.equal(JSON.stringify(job).includes('secrets.'), false);
  }
  assert.equal(workflow.on.pull_request_target, undefined);
});
