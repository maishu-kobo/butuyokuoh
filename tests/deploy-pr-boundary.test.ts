import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// ESLint already depends on this YAML parser; do not add a second parser version.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint'))('js-yaml');
const source = readFileSync('.github/workflows/deploy-main.yml', 'utf8');
const workflow = load(source);

test('main PRs run the same CodeQL caller as main pushes for comparable analyses', () => {
  for (const branch of workflow.on.push.branches) {
    assert.ok(workflow.on.pull_request.branches.includes(branch), `missing PR comparison for ${branch}`);
  }
  assert.equal(workflow.jobs.security.uses, './.github/workflows/codeql.yml');
  assert.equal(workflow.jobs.security.if, undefined, 'analysis must run for both event types');
  assert.ok(workflow.jobs.deploy.needs.includes('security'));
});

test('only enabled main push or manual dispatch can enter the production credential job', () => {
  // This expression uses only string equality and boolean operators, which have
  // the same result here in Actions and JS. Evaluate the actual job condition.
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
