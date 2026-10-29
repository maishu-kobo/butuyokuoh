import type Database from 'better-sqlite3';
import { createSqliteAiBudget, type AiBudget } from '../../../src/lib/capture/workers-ai';

// One identify() may send two upstream calls before settle. Hold twice the
// per-photo estimate (llama 4 is about 40–100). Gemini estimates are 0.
// The app's 3/minute and 10/day limits stay in createSqliteAiBudget for real users.
// This ledger only enforces the shared 8000-neuron cap.
export const EVAL_NEURON_CAP = 8000;
export const UNKNOWN_CALL_NEURONS = 2000;

export function evaluationReservation(estimatePerPhoto: number): number {
  if (!Number.isFinite(estimatePerPhoto) || estimatePerPhoto <= 0) return 0;
  return Math.ceil(estimatePerPhoto) * 2;
}

export function createEvaluationBudget(
  db: Database.Database,
  accountUsed: number,
  snapshotDay: string,
  observedUsage: () => number,
  reservation = 0,
): AiBudget {
  if (!Number.isFinite(accountUsed) || accountUsed < 0 || accountUsed > EVAL_NEURON_CAP || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDay)) {
    throw new Error('A current account usage snapshot is required');
  }
  if (!Number.isFinite(reservation) || reservation < 0 || reservation > EVAL_NEURON_CAP) {
    throw new Error('A current account usage snapshot is required');
  }
  const shared = createSqliteAiBudget(db);
  const sumDay = db.prepare('SELECT COALESCE(SUM(neurons), 0) AS n FROM capture_ai_usage WHERE day = ?');
  const insert = db.prepare(
    'INSERT INTO capture_ai_usage (user_key, day, at_ms, neurons) VALUES (?, ?, ?, ?)',
  );
  const begin = db.transaction((userId: string, now: number): ReturnType<AiBudget['tryBegin']> => {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== snapshotDay) return { ok: false, reason: 'neurons' };
    const used = Number((sumDay.get(day) as { n: number }).n);
    if (accountUsed + used + reservation > EVAL_NEURON_CAP) return { ok: false, reason: 'neurons' };
    const row = insert.run(userId, day, now, reservation);
    return { ok: true, token: Number(row.lastInsertRowid) };
  });
  return {
    tryBegin(userId, now) { return begin.immediate(userId, now); },
    settle(token) {
      const used = observedUsage();
      shared.settle(token, Number.isFinite(used) && used > 0 ? Math.ceil(used) : reservation);
    },
    trip: (now) => shared.trip(now),
    usedNeurons: (now) => shared.usedNeurons(now),
  };
}
