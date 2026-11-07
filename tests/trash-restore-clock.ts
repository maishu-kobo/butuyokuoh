// ゴミ箱復元テスト用の固定時計（REVIEW.md: 時計を固定する）。
// JS の Date と、一時 DB 上の datetime() / unixepoch() の 'now' を同じ時刻に止める。
// 本番コードと共通ハーネス（regression-harness.ts）は触らない。
import Database from 'better-sqlite3';
import { mock } from 'node:test';

export const FIXED_NOW = '2026-11-07T00:00:00.000Z';
/** この時計のもとで SQLite の datetime('now') が返す値 */
export const FIXED_NOW_SQLITE = '2026-11-07 00:00:00';

type SqlValue = number | bigint | string | Buffer | null;

const FROZEN_FUNCTIONS = ['datetime', 'unixepoch'] as const;

/**
 * Date を FIXED_NOW で止め、connection の datetime() / unixepoch() を上書きする。
 * 上書きした関数は、最初の引数が 'now'（または引数なし）のときだけ FIXED_NOW に差し替え、
 * 修飾子・NULL・固定の日時文字列はそのまま、別の :memory: 接続の組み込み実装へ委譲する。
 * SQLite の日時変換の意味は組み込みのまま。列の DEFAULT (datetime('now')) にも効く。
 * 戻り値を after() で呼ぶと、補助接続を閉じて Date を戻す。
 */
export function installFrozenClock(connection: Database.Database): () => void {
  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW) });
  const builtin = new Database(':memory:');
  const statements = new Map<string, Database.Statement>();
  for (const name of FROZEN_FUNCTIONS) {
    connection.function(name, { varargs: true }, (...args: SqlValue[]) => {
      const frozen = args.length === 0 || (typeof args[0] === 'string' && args[0].toLowerCase() === 'now')
        ? [FIXED_NOW, ...args.slice(1)]
        : args;
      const key = `${name}/${frozen.length}`;
      let statement = statements.get(key);
      if (!statement) {
        statement = builtin.prepare(`SELECT ${name}(${frozen.map(() => '?').join(', ')})`).pluck();
        statements.set(key, statement);
      }
      return statement.get(...frozen) as SqlValue;
    });
  }
  return () => {
    statements.clear();
    builtin.close();
    mock.timers.reset();
  };
}
