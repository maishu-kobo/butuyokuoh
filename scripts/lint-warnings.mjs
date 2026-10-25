/**
 * 既存の lint 警告を増やさない。
 * 基準は .github/lint-warning-baseline.json。減る分は通す。エラーは別で落とす。
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function warningCounts(results, repoRoot) {
  const counts = new Map();
  for (const file of results) {
    const filePath = typeof file.filePath === 'string' ? file.filePath : '';
    const rel = relative(repoRoot, filePath).split(sep).join('/');
    for (const message of file.messages || []) {
      if (message.severity !== 1) continue;
      const key = JSON.stringify([rel, message.ruleId ?? '', message.message]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

export function baselineMap(entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(JSON.stringify([entry.file, entry.ruleId, entry.message]), entry.count);
  }
  return counts;
}

export function increasedWarnings(current, baseline) {
  const increased = [];
  for (const [key, count] of current) {
    const allowed = baseline.get(key) || 0;
    if (count <= allowed) continue;
    const [file, ruleId, message] = JSON.parse(key);
    increased.push({ file, ruleId, message, count, allowed });
  }
  return increased.sort((a, b) => a.file.localeCompare(b.file) || a.ruleId.localeCompare(b.ruleId) || a.message.localeCompare(b.message));
}

function check() {
  const baseline = baselineMap(JSON.parse(readFileSync(join(root, '.github', 'lint-warning-baseline.json'), 'utf8')));
  const eslint = spawnSync(process.execPath, [join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), '-f', 'json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (eslint.error) throw eslint.error;
  if (eslint.status !== 0 && eslint.status !== 1) {
    if (eslint.stderr) console.error(eslint.stderr);
    return eslint.status || 1;
  }
  let results;
  try {
    results = JSON.parse(eslint.stdout);
  } catch (error) {
    console.error('eslint の JSON を読めなかった');
    console.error(error);
    return 1;
  }
  const errors = results.reduce((count, file) => count + (file.errorCount || 0), 0);
  if (errors > 0) {
    console.error(`eslint errors: ${errors}`);
    return 1;
  }
  const increased = increasedWarnings(warningCounts(results, root), baseline);
  if (increased.length === 0) {
    console.log('lint 警告は基準を超えていません。');
    return 0;
  }
  console.error('新しい lint 警告があります:');
  for (const row of increased) {
    console.error(`  ${row.file} ${row.ruleId} ${row.count} > ${row.allowed}: ${row.message}`);
  }
  return 1;
}

function main() {
  if (process.argv[2] !== 'check') {
    console.error('使い方: node scripts/lint-warnings.mjs check');
    process.exitCode = 2;
    return;
  }
  process.exitCode = check();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
