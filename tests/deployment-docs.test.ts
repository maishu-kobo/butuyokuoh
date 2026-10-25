import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deployment = readFileSync(new URL('../docs/deployment.md', import.meta.url), 'utf8');
const database = readFileSync(new URL('../docs/database.md', import.meta.url), 'utf8');
const readiness = readFileSync(new URL('../docs/release-readiness.md', import.meta.url), 'utf8');

function section(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  assert.equal(start >= 0, true, heading);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

test('the update procedure installs outside the live app directory', () => {
  const update = section(deployment, '## 更新デプロイ');
  assert.equal(update.includes('### ブランチの昇格'), true);
  assert.equal(update.includes('CAPTURE_SECRETS_FILE'), true);
  assert.equal(update.includes('22.12'), true);
  assert.equal(update.includes('npm rebuild better-sqlite3'), true);
  assert.equal(update.includes('.backup'), true);
  assert.equal(update.includes('butuyokuoh-next'), true);
  assert.equal(update.includes('git pull && npm install'), false);

  const blocks = [...update.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
  const installBlocks = blocks.filter((block) => block.includes('npm install'));
  assert.equal(installBlocks.length > 0, true);
  for (const block of installBlocks) {
    assert.equal(block.includes('butuyokuoh-next'), true);
    assert.equal(/^cd \/home\/exedev\/butuyokuoh$/m.test(block), false);
  }
});

test('backup instructions use sqlite .backup and not a file copy', () => {
  assert.equal(deployment.includes('cp data/butuyokuoh.db'), false);
  assert.equal(database.includes('cp data/butuyokuoh.db'), false);
  const routine = section(database, '## バックアップ');
  assert.equal(routine.includes('.backup'), true);
  assert.equal(routine.includes('cp data/butuyokuoh.db'), false);
});

test('the release readiness header matches main after the promotion', () => {
  assert.equal(readiness.startsWith('# feature/photo-capture を develop に入れる前の確認\n'), false);
  assert.equal(readiness.startsWith('# main に入った写真登録の確認メモ\n'), true);
  assert.equal(readiness.includes('288596e8b11d05139bafe91ce841d793bdb00787'), true);
});
