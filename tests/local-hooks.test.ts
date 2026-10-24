import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/hooks/pre-commit.mjs');
const installer = resolve('scripts/hooks/install.mjs');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'butuyokuoh-hooks-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  const git = (...args: string[]) => { const r = run('git', args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
  writeFileSync(join(dir, 'eslint.config.mjs'), "export default [{files:['**/*.js'],rules:{'no-debugger':'error'}}];\n");
  writeFileSync(join(dir, 'package.json'), '{}\n');
  writeFileSync(join(dir, 'file with spaces.js'), 'export const value = 1;\n');
  git('add', '.'); git('commit', '-qm', 'fixture');
  return { dir, run, git, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('pre-commit checks index content without changing partial staging, renamed files or deletes', () => {
  const f = fixture();
  try {
    const path = join(f.dir, 'file with spaces.js');
    writeFileSync(path, 'debugger;\n'); f.git('add', '--', 'file with spaces.js');
    writeFileSync(path, 'export const value = 2;\n');
    const index = f.git('write-tree');
    const failed = f.run(process.execPath, [script]);
    assert.equal(failed.status, 1, failed.stderr); assert.match(failed.stdout, /no-debugger/);
    assert.equal(f.git('write-tree'), index); assert.equal(readFileSync(path, 'utf8'), 'export const value = 2;\n');
    f.git('add', '--', 'file with spaces.js'); writeFileSync(path, 'debugger;\n');
    assert.equal(f.run(process.execPath, [script]).status, 0);
    assert.equal(readFileSync(path, 'utf8'), 'debugger;\n');
    f.git('mv', 'file with spaces.js', 'renamed file.js');
    f.git('add', '--', 'renamed file.js');
    assert.equal(f.run(process.execPath, [script]).status, 1);
    f.git('rm', '-f', '--', 'renamed file.js');
    assert.equal(f.run(process.execPath, [script]).status, 0);
  } finally { f.clean(); }
});

test('pre-commit rejects whitespace and configuration that differs from the index', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'note.txt'), 'trailing space  \n'); f.git('add', '.');
    assert.equal(f.run(process.execPath, [script]).status, 1);
    writeFileSync(join(f.dir, 'note.txt'), 'clean\n'); f.git('add', '.');
    writeFileSync(join(f.dir, 'eslint.config.mjs'), 'export default [];\n');
    const result = f.run(process.execPath, [script]);
    assert.equal(result.status, 1); assert.match(result.stderr, /設定.*ステージ/);
  } finally { f.clean(); }
});

test('hook install is explicit, repository-local and preserves existing hook settings', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, '.githooks')); writeFileSync(join(f.dir, '.githooks/pre-commit'), '#!/bin/sh\nexit 0\n'); chmodSync(join(f.dir, '.githooks/pre-commit'), 0o755);
    f.git('config', '--local', 'core.hooksPath', 'my-hooks');
    assert.equal(f.run(process.execPath, [installer, 'install']).status, 1);
    assert.equal(f.git('config', '--local', '--get', 'core.hooksPath').trim(), 'my-hooks');
    assert.equal(f.run(process.execPath, [installer, 'uninstall']).status, 1);
    f.git('config', '--local', '--unset', 'core.hooksPath');
    assert.equal(f.run(process.execPath, [installer, 'install']).status, 0);
    assert.equal(f.git('config', '--local', '--get', 'core.hooksPath').trim(), '.githooks');
    assert.equal(f.run(process.execPath, [installer, 'install']).status, 0);
    assert.equal(f.run(process.execPath, [installer, 'uninstall']).status, 0);
    assert.equal(f.run('git', ['config', '--local', '--get', 'core.hooksPath']).status, 1);
  } finally { f.clean(); }
});


test('pre-commit refuses a config removed from the index but left in the worktree', () => {
  const f = fixture();
  try {
    f.git('rm', '--cached', 'eslint.config.mjs');
    writeFileSync(join(f.dir, 'eslint.config.mjs'), 'export default [];\n');
    writeFileSync(join(f.dir, 'file with spaces.js'), 'debugger;\n'); f.git('add', '--', 'file with spaces.js');
    const index = f.git('write-tree');
    const result = f.run(process.execPath, [script]);
    assert.equal(result.status, 1); assert.match(result.stderr, /設定.*ステージ/);
    assert.equal(f.git('write-tree'), index);
  } finally { f.clean(); }
});

test('worktree hook overrides cannot hide or replace repository-local settings', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, '.githooks')); writeFileSync(join(f.dir, '.githooks/pre-commit'), '#!/bin/sh\nexit 0\n'); chmodSync(join(f.dir, '.githooks/pre-commit'), 0o755);
    f.git('config', '--local', 'extensions.worktreeConfig', 'true');
    f.git('config', '--local', 'core.hooksPath', 'my-existing-hooks');
    f.git('config', '--worktree', 'core.hooksPath', '.githooks');
    assert.equal(f.run(process.execPath, [installer, 'install']).status, 1);
    assert.equal(f.git('config', '--local', '--get', 'core.hooksPath').trim(), 'my-existing-hooks');
    f.git('config', '--local', 'core.hooksPath', '.githooks');
    assert.equal(f.run(process.execPath, [installer, 'uninstall']).status, 1);
    assert.equal(f.git('config', '--worktree', '--get', 'core.hooksPath').trim(), '.githooks');
    assert.equal(f.git('config', '--local', '--get', 'core.hooksPath').trim(), '.githooks');
  } finally { f.clean(); }
});
