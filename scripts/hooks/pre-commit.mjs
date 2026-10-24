import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

async function main() {
  // Read only: do not stash, fix, write files, or alter the index.
  execFileSync('git', ['diff', '--cached', '--check'], { stdio: 'inherit' });
  if (git('ls-files', '--unmerged', '-z')) throw new Error('競合を解消してからコミットしてください。');
  // ESLint loads configuration and installed plugins from the worktree. Refuse
  // a different configuration rather than silently linting with unstaged rules.
  const configPaths = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((extension) => `eslint.config.${extension}`)
    .concat(['tsconfig.json', 'package.json', 'package-lock.json']);
  for (const path of configPaths) {
    const index = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { encoding: 'utf8' });
    if (index.status !== 0 && index.status !== 1) throw new Error('ステージの設定を読めませんでした。');
    let file;
    try { file = lstatSync(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((index.status === 0) !== Boolean(file) || (file && !file.isFile())) {
      throw new Error('検査設定の存在または形式がステージ内容と異なります。設定を確認してください。');
    }
  }
  if (git('diff', '--name-only', '-z', '--', ...configPaths)) {
    throw new Error('検査設定がステージ内容と異なります。設定をステージするか、未ステージの設定変更を戻してください。');
  }
  const paths = git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR')
    .split('\0').filter((path) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path));
  if (paths.length === 0) return;
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: git('rev-parse', '--show-toplevel').trim(), fix: false });
  const results = [];
  for (const filePath of paths) {
    const staged = git('show', `:${filePath}`);
    results.push(...await eslint.lintText(staged, { filePath, warnIgnored: false }));
  }
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) process.stdout.write(output);
  if (results.some((result) => result.errorCount > 0)) process.exitCode = 1;
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : 'コミット前の検査に失敗しました。');
  process.exitCode = 1;
}
