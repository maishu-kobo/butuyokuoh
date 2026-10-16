import { loadEnvConfig } from '@next/env';

async function main() {
  // Match the web application's DB path/TTL when launched from systemd.
  loadEnvConfig(process.cwd());
  const { getDb } = await import('../src/lib/db');
  const { cleanupGuests, guestLimit } = await import('../src/lib/guest');
  const db = getDb();
  try {
    const now = Date.now();
    if (process.argv.includes('--dry-run')) {
      const result = db.prepare(`SELECT COUNT(*) AS eligible FROM users u LEFT JOIN guest_sessions s ON s.user_id = u.id
        WHERE u.account_type = 'guest' AND (s.expires_at <= ? OR (s.user_id IS NULL AND unixepoch(u.created_at) * 1000 <= ?))`)
        .get(now, now - guestLimit('TTL_HOURS', 24) * 3_600_000);
      console.log(JSON.stringify({ dryRun: true, ...result as object }));
      return;
    }
    let deleted = 0;
    for (let batch = 0; batch < 1000; batch++) {
      const result = cleanupGuests(db, now);
      deleted += result.deleted;
      if (!result.remainingBatch) { console.log(JSON.stringify({ deleted })); return; }
    }
    throw new Error('Cleanup batch limit reached; rerun cleanup-guests');
  } finally { db.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Cleanup failed'); process.exitCode = 1; });
