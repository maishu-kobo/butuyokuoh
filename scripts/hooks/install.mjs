import { spawnSync, execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const hookPath = '.githooks';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
function setting(scope) {
  const result = spawnSync('git', ['config', ...(scope ? [`--${scope}`] : []), '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || 'Git設定を読めませんでした。');
  return result.status === 0 ? result.stdout.trim() : null;
}

try {
  const root = git('rev-parse', '--show-toplevel');
  const command = process.argv[2];
  const worktreeConfig = spawnSync('git', ['config', '--bool', '--get', 'extensions.worktreeConfig'], { encoding: 'utf8' });
  if (worktreeConfig.status !== 0 && worktreeConfig.status !== 1) throw new Error('worktree設定を読めませんでした。');
  if (worktreeConfig.stdout.trim() === 'true' && setting('worktree') !== null) {
    throw new Error('worktree固有のcore.hooksPathがあります。自動変更せず、現在のフック設定を確認してください。');
  }
  if (command === 'install') {
    const existing = setting();
    const local = setting('local');
    if (local !== null && local !== hookPath) throw new Error('既存のローカルcore.hooksPathを上書きしません。');
    if (existing !== null && existing !== hookPath) throw new Error('既存のcore.hooksPathを上書きしません。現在のフック設定を確認してください。');
    accessSync(join(root, hookPath, 'pre-commit'), constants.X_OK);
    git('config', '--local', 'core.hooksPath', hookPath);
    console.log('このリポジトリでコミット前チェックを有効にしました。.git/hooksは呼ばれません。');
  } else if (command === 'uninstall') {
    const local = setting('local');
    if (local === null) console.log('このリポジトリのフック設定はありません。');
    else if (local !== hookPath) throw new Error('別のcore.hooksPath設定は削除しません。');
    else { git('config', '--local', '--unset', 'core.hooksPath'); console.log('リポジトリのフック設定を解除しました。'); }
  } else throw new Error('install または uninstall を指定してください。');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'フック設定に失敗しました。');
  process.exitCode = 1;
}
