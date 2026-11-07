import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('@eslint/eslintrc'))('js-yaml');

const workflowDir = '.github/workflows';
const workflowFiles = readdirSync(workflowDir).filter((name) => name.endsWith('.yml'));
const workflows = Object.fromEntries(
  workflowFiles.map((name) => [name, load(readFileSync(join(workflowDir, name), 'utf8'))]),
);

function collectRunsOn(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRunsOn(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'runs-on') {
        if (typeof value === 'string') out.push(value);
        else out.push(JSON.stringify(value));
      } else {
        collectRunsOn(value, out);
      }
    }
  }
  return out;
}

function stripYamlComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) return '';
      const inSingle = (line.match(/'/g) || []).length % 2 === 1;
      const inDouble = (line.match(/"/g) || []).length % 2 === 1;
      if (inSingle || inDouble) return line;
      const hash = line.indexOf(' #');
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join('\n');
}

test('every executable workflow job uses GitHub-hosted ubuntu-24.04 only', () => {
  for (const [name, workflow] of Object.entries(workflows)) {
    const executable = stripYamlComments(readFileSync(join(workflowDir, name), 'utf8'));
    assert.doesNotMatch(executable, /blacksmith/i, `${name} must not use Blacksmith in executable YAML`);
    assert.doesNotMatch(executable, /BLACKSMITH_/, `${name} must not reference Blacksmith vars/secrets`);
    assert.doesNotMatch(executable, /blacksmith-cli\.sh/, `${name} must not call Blacksmith CLI`);
    assert.doesNotMatch(executable, /github_hosted_only/, `${name} must not keep runner-selection input`);
    assert.doesNotMatch(executable, /select-runner|Select CI runner/, `${name} must not keep runner selection`);
    for (const runsOn of collectRunsOn(workflow)) {
      assert.equal(runsOn, 'ubuntu-24.04', `${name} runs-on=${runsOn}`);
    }
  }
});

test('deploy-main reusable CI path stays GitHub-hosted without runner selection', () => {
  const deploy = workflows['deploy-main.yml'] as {
    jobs: { ci: { permissions?: Record<string, string>; with?: unknown; uses: string } };
  };
  assert.equal(deploy.jobs.ci.uses, './.github/workflows/ci.yml');
  assert.equal(deploy.jobs.ci.with, undefined);
  assert.deepEqual(deploy.jobs.ci.permissions, { contents: 'read' });

  const ci = workflows['ci.yml'] as {
    on: { workflow_call?: { inputs?: unknown } };
    jobs: Record<string, { name?: string; 'runs-on'?: string; needs?: unknown }>;
  };
  assert.equal(ci.on.workflow_call?.inputs, undefined);
  assert.equal(ci.jobs['select-runner'], undefined);
  assert.equal(ci.jobs.check.name, 'test, types, build');
  assert.equal(ci.jobs.check['runs-on'], 'ubuntu-24.04');
  assert.equal(ci.jobs.check.needs, undefined);
  assert.equal(ci.jobs.audit.name, 'npm audit');
  assert.equal(ci.jobs.audit['runs-on'], 'ubuntu-24.04');
});
