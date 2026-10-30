import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSqliteAiBudget, createWorkersAiIdentifier } from '../src/lib/capture/workers-ai';
import { createEvaluationBudget, evaluationReservation } from './eval/photo-search/budget';
import { exactProductTop5 } from './eval/photo-search/rubric';

function database() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE capture_ai_usage (id INTEGER PRIMARY KEY, user_key TEXT, day TEXT, at_ms INTEGER, neurons REAL)');
  return db;
}

const now = Date.parse('2026-10-29T00:00:00Z');
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);

test('evaluation reserves shared headroom across models and restarts, and refuses stale usage', (t) => {
  const db = database();
  t.after(() => db.close());
  const shared = createSqliteAiBudget(db);
  const first = createEvaluationBudget(db, 1000, '2026-10-29', () => 3500, 100);
  const slot = first.tryBegin('eval-run-one-a', now);
  assert.equal(slot.ok, true);
  if (!slot.ok) return;
  assert.equal(shared.usedNeurons(now), 100);
  first.settle(slot.token, 0);
  const second = createEvaluationBudget(db, 4501, '2026-10-29', () => 1, 100);
  assert.equal(second.tryBegin('eval-run-two-a', now).ok, false);
  assert.equal(createEvaluationBudget(db, 0, '2026-10-28', () => 1, 100).tryBegin('x', now).ok, false);
});
test('unknown usage keeps the reservation and fractional usage is rounded up', (t) => {
  for (const [observed, expected] of [[NaN, 80], [0, 80], [12.3, 13]]) {
    const db = database();
    t.after(() => db.close());
    const shared = createSqliteAiBudget(db);
    const budget = createEvaluationBudget(db, 0, '2026-10-29', () => observed, 80);
    const slot = budget.tryBegin('eval-run-photo-a', now);
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
  const one = createEvaluationBudget(db, 7900, '2026-10-29', () => 1, 100);
  const two = createEvaluationBudget(db, 7900, '2026-10-29', () => 1, 100);
  assert.equal(one.tryBegin('eval-run-a-a', now).ok, true);
  assert.equal(two.tryBegin('eval-run-b-a', now).ok, false);
  assert.equal(createSqliteAiBudget(db).usedNeurons(now), 100);
});

test('twenty-three photos at 5000 used neurons pass, and the cap still refuses when it is exceeded', (t) => {
  const db = database();
  t.after(() => db.close());
  const reservation = evaluationReservation(Math.round(904 / 23));
  assert.equal(reservation >= 40 && reservation <= 100, true);
  assert.equal(evaluationReservation(0), 0);
  const budget = createEvaluationBudget(db, 5000, '2026-10-29', () => 39, reservation);
  for (let photo = 0; photo < 23; photo += 1) {
    const slot = budget.tryBegin(`eval-llama4-photo-${photo}-a`, now);
    assert.equal(slot.ok, true, `photo ${photo}`);
    if (slot.ok) budget.settle(slot.token, 0);
  }
  for (let extra = 0; extra < 12; extra += 1) {
    const slot = budget.tryBegin('eval-llama4-same-photo-a', now + extra);
    assert.equal(slot.ok, true, `repeat ${extra}`);
    if (slot.ok) budget.settle(slot.token, 0);
  }
  const refused = createEvaluationBudget(db, 7923, '2026-10-29', () => 39, reservation).tryBegin('eval-llama4-over-a', now);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, 'neurons');
});

test('a workers daily cap during an eval stops the following photo', async (t) => {
  const db = database();
  t.after(() => db.close());
  const budget = createEvaluationBudget(db, 1000, '2026-10-29', () => 39, evaluationReservation(39));
  let calls = 0;
  const http = async () => {
    calls += 1;
    return { status: 429, body: JSON.stringify({ errors: [{ code: 3036 }] }) };
  };
  const identifier = createWorkersAiIdentifier({
    accountId: 'a'.repeat(32),
    apiToken: 'test-token-ok',
    userId: 'eval-llama4-mid-a',
    budget,
    now: () => now,
    http,
  });
  const stopped = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(stopped.ok, false);
  if (!stopped.ok) assert.equal(stopped.error.code, 'AI_LIMIT');
  const next = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.error.code, 'AI_LIMIT');
  assert.equal(calls, 1);
});
