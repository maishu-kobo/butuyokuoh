/* eslint-disable @typescript-eslint/no-require-imports -- このファイルは Worker が CommonJS として読む。tsx 経由で同じ削除関数を呼ぶ。 */
require('tsx/cjs');
const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../src/lib/db.ts');
const { cleanupGuests, endGuest } = require('../src/lib/guest.ts');

const gate = new Int32Array(workerData.gate);
const db = openDatabase(workerData.filename);
try {
  Atomics.add(gate, 0, 1);
  Atomics.notify(gate, 0);
  while (Atomics.load(gate, 1) === 0) Atomics.wait(gate, 1, 0, 1000);
  if (workerData.op === 'cleanup') cleanupGuests(db, workerData.now);
  else endGuest(workerData.token, db);
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : 'failed' });
  process.exitCode = 1;
} finally {
  db.close();
}
