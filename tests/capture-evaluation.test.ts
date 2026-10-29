import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSqliteAiBudget } from '../src/lib/capture/workers-ai';
import { createEvaluationBudget } from './eval/photo-search/budget';
import { exactProductTop5 } from './eval/photo-search/rubric';

function database() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE capture_ai_usage (id INTEGER PRIMARY KEY, user_key TEXT, day TEXT, at_ms INTEGER, neurons REAL)');
  return db;
}

const now = Date.parse('2026-10-29T00:00:00Z');
test('evaluation reserves shared headroom across models and restarts, and refuses stale usage', (t) => {
  const db = database();
  t.after(() => db.close());
  const shared = createSqliteAiBudget(db);
  const first = createEvaluationBudget(db, 1000, '2026-10-29', () => 3500);
  const slot = first.tryBegin('one', now);
  assert.equal(slot.ok, true);
  if (!slot.ok) return;
  assert.equal(shared.usedNeurons(now), 4000);
  first.settle(slot.token, 0);
  const second = createEvaluationBudget(db, 1000, '2026-10-29', () => 1);
  assert.equal(second.tryBegin('different-photo', now).ok, false);
  assert.equal(createEvaluationBudget(db, 0, '2026-10-28', () => 1).tryBegin('x', now).ok, false);
});
test('unknown usage keeps the reservation and fractional usage is rounded up', (t) => {
  for (const [observed, expected] of [[NaN, 4000], [0, 4000], [12.3, 13]]) {
    const db = database();
    t.after(() => db.close());
    const shared = createSqliteAiBudget(db);
    const budget = createEvaluationBudget(db, 0, '2026-10-29', () => observed);
    const slot = budget.tryBegin('x', now);
    assert.equal(slot.ok, true);
    if (slot.ok) budget.settle(slot.token, 0);
    assert.equal(shared.usedNeurons(now), expected);
  }
});
test('exact-product scoring is unscored without truth and does not reward similar titles', () => {
  assert.equal(exactProductTop5(['似た黒いバッグ'], undefined), null);
  assert.equal(exactProductTop5(['似た黒いバッグ'], ['7897722AA4V1000']), false);
  assert.equal(exactProductTop5(['正解 7897722AA4V1000'], ['7897722AA4V1000']), true);
  assert.equal(exactProductTop5(['a','b','c','d','e','7897722AA4V1000'], ['7897722AA4V1000']), false);
});


test('account headroom and the full reservation are read and written inside one immediate transaction', (t) => {
  const db = database();
  t.after(() => db.close());
  db.function('assert_transaction', () => { assert.equal(db.inTransaction, true); return 1; });
  db.exec(`CREATE TRIGGER reserve_inside_transaction BEFORE INSERT ON capture_ai_usage
    BEGIN SELECT assert_transaction(); END;
    CREATE TRIGGER update_inside_transaction BEFORE UPDATE ON capture_ai_usage
    BEGIN SELECT assert_transaction(); END;`);
  const one = createEvaluationBudget(db, 2000, '2026-10-29', () => 1);
  const two = createEvaluationBudget(db, 2000, '2026-10-29', () => 1);
  assert.equal(one.tryBegin('a', now).ok, true);
  assert.equal(two.tryBegin('b', now).ok, false);
  assert.equal(createSqliteAiBudget(db).usedNeurons(now), 4000);
});
