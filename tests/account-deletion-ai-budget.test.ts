import './upload-test-directory';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/lib/db';
import { deleteMemberAccount } from '../src/lib/delete-member-account';
import { AI_NEURON_DAILY_CAP, AI_NEURONS_WHEN_USAGE_MISSING, createSqliteAiBudget } from '../src/lib/capture/workers-ai';

const NOW = Date.UTC(2026, 9, 25, 1);
function member(db: ReturnType<typeof openDatabase>, email: string): number {
  return Number(db.prepare("INSERT INTO users (email, account_type) VALUES (?, 'member')").run(email).lastInsertRowid);
}

test('withdrawal removes personal AI usage identifiers but preserves the global daily cap after reopening', () => {
  let db = openDatabase('withdrawn-budget.db');
  try {
    const owner = member(db, 'withdrawn@example.test');
    const other = member(db, 'other@example.test');
    const budget = createSqliteAiBudget(db);
    const reservation = budget.tryBegin(String(owner), NOW);
    assert.equal(reservation.ok, true);
    if (!reservation.ok) return;
    budget.settle(reservation.token, AI_NEURON_DAILY_CAP);
    assert.deepEqual(budget.tryBegin(String(other), NOW), { ok: false, reason: 'neurons' });
    assert.equal(deleteMemberAccount(owner, db), true);
    assert.equal(db.prepare('SELECT 1 FROM capture_ai_usage WHERE user_key = ?').get(String(owner)), undefined);
    const anonymous = db.prepare('SELECT user_key, at_ms FROM capture_ai_usage').get() as { user_key: string; at_ms: number };
    assert.equal(anonymous.at_ms, 0);
    assert.equal(/^[0-9]+$/.test(anonymous.user_key), false);
    db.close();
    db = openDatabase('withdrawn-budget.db');
    const reopened = createSqliteAiBudget(db);
    assert.equal(reopened.usedNeurons(NOW), AI_NEURON_DAILY_CAP);
    assert.deepEqual(reopened.tryBegin(String(other), NOW), { ok: false, reason: 'neurons' });
    assert.equal(reopened.usedNeurons(NOW + 86_400_000), 0);
    assert.equal(reopened.tryBegin(String(other), NOW + 86_400_000).ok, true);
  } finally { db.close(); }
});

test('withdrawal preserves in-flight reservations and settlement without altering another member', () => {
  const db = openDatabase(':memory:');
  try {
    const owner = member(db, 'pending@example.test');
    const other = member(db, 'remaining@example.test');
    const budget = createSqliteAiBudget(db);
    const pending = budget.tryBegin(String(owner), NOW);
    const remaining = budget.tryBegin(String(other), NOW);
    assert.equal(pending.ok, true);
    assert.equal(remaining.ok, true);
    if (!pending.ok || !remaining.ok) return;
    budget.settle(remaining.token, 25);
    assert.equal(deleteMemberAccount(owner, db), true);
    assert.equal(budget.usedNeurons(NOW), AI_NEURONS_WHEN_USAGE_MISSING + 25);
    budget.settle(pending.token, 123);
    assert.equal(budget.usedNeurons(NOW), 148);
    assert.deepEqual(db.prepare('SELECT user_key, at_ms, neurons FROM capture_ai_usage WHERE id = ?').get(remaining.token), { user_key: String(other), at_ms: NOW, neurons: 25 });
    assert.equal(deleteMemberAccount(owner, db), false);
    assert.equal(budget.usedNeurons(NOW), 148);
  } finally { db.close(); }
});
