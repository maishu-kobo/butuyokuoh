import type Database from 'better-sqlite3';
import { createSqliteAiBudget, type AiBudget } from '../../../src/lib/capture/workers-ai';

// Two upstream attempts may be made per identification. Reserve before either starts.
export const EVALUATION_RESERVATION = 4000;
export const UNKNOWN_CALL_NEURONS = 2000;
const CAP = 8000;

export function createEvaluationBudget(
  db: Database.Database,
  accountUsed: number,
  snapshotDay: string,
  observedUsage: () => number,
): AiBudget {
  if (!Number.isFinite(accountUsed) || accountUsed < 0 || accountUsed > CAP || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDay)) {
    throw new Error('A current account usage snapshot is required');
  }
  const shared = createSqliteAiBudget(db);
  const begin = db.transaction((now: number): ReturnType<AiBudget['tryBegin']> => {
      if (new Date(now).toISOString().slice(0, 10) !== snapshotDay ||
          accountUsed + shared.usedNeurons(now) + EVALUATION_RESERVATION > CAP) {
        return { ok: false, reason: 'neurons' };
      }
      const result = shared.tryBegin('photo-evaluation', now);
      if (result.ok) shared.settle(result.token, EVALUATION_RESERVATION);
      return result;
  });
  return {
    tryBegin(_user, now) { return begin.immediate(now); },
    settle(token) {
      const used = observedUsage();
      shared.settle(token, Number.isFinite(used) && used > 0 ? Math.ceil(used) : EVALUATION_RESERVATION);
    },
    trip: (now) => shared.trip(now),
    usedNeurons: (now) => shared.usedNeurons(now),
  };
}
