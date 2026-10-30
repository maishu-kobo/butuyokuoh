import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deployment = readFileSync(new URL('../docs/deployment.md', import.meta.url), 'utf8');
const database = readFileSync(new URL('../docs/database.md', import.meta.url), 'utf8');

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

test('the swap guards data, stops the guest oneshot, and waits before rollback', () => {
  const update = section(deployment, '## 更新デプロイ');
  const blocks = [...update.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
  const swap = blocks.find((block) => block.includes('npm install'));
  const rollback = blocks.find((block) => block.includes('butuyokuoh-failed'));
  if (swap === undefined || rollback === undefined) {
    throw new Error('missing procedure block');
  }

  const guard = swap.indexOf('test ! -e "$PREV.new"');
  const dataMove = swap.indexOf('mv "$APP/data" "$NEXT/data"');
  assert.equal(guard >= 0 && dataMove > guard, true);

  const guestStop = 'systemctl stop butuyokuoh-guest-cleanup.service';
  assert.equal(swap.indexOf(guestStop) >= 0 && swap.indexOf(guestStop) < dataMove, true);
  const rollbackMove = rollback.indexOf('mv /home/exedev/butuyokuoh/data /home/exedev/butuyokuoh.prev/data');
  assert.equal(rollback.indexOf(guestStop) >= 0 && rollback.indexOf(guestStop) < rollbackMove, true);
  assert.equal(rollback.includes('systemctl start butuyokuoh-guest-cleanup.timer'), true);

  const start = swap.indexOf('sudo systemctl start butuyokuoh\n');
  const loop = swap.indexOf('for _ in $(seq 1 30); do');
  const probe = swap.indexOf('if curl -fsS http://localhost:8000 >/dev/null; then');
  const decided = swap.indexOf('test "$ready" = 1');
  assert.equal(start >= 0 && loop > start && probe > loop && decided > probe, true);
  assert.equal(/^\s*curl -fsS http:\/\/localhost:8000 >\/dev\/null$/m.test(swap), false);
});
