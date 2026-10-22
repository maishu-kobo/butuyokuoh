import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { deleteExpiredCaptureCandidates, getDb } from './db';
import { seedDemoData } from './demo-data';

export const GUEST_COOKIE = 'butuyokuoh_guest';
export const guestEnabled = () => process.env.GUEST_MODE_ENABLED === 'true';

export function guestLimit(name: string, fallback: number): number {
  const value = process.env[`GUEST_${name}`];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid GUEST_${name}`);
  return parsed;
}

export class GuestError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

export interface GuestUser {
  id: number;
  account_type: 'guest';
  email: null;
  name: string;
  created_at: string;
  expiresAt: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function findGuest(token: string | undefined, db = getDb(), now = Date.now()): GuestUser | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare(`SELECT u.id, u.created_at, s.expires_at FROM guest_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.account_type = 'guest'`)
    .get(hashToken(token), now) as { id: number; created_at: string; expires_at: number } | undefined;
  return row ? { id: row.id, account_type: 'guest', email: null, name: 'ゲスト',
    created_at: row.created_at, expiresAt: new Date(row.expires_at).toISOString() } : null;
}

export function consumeGuestRate(bucket: string, limit: number, db = getDb(), now = Date.now()) {
  db.transaction(() => {
    const row = db.prepare('SELECT count, resets_at FROM guest_rate_limits WHERE bucket = ?')
      .get(bucket) as { count: number; resets_at: number } | undefined;
    if (row && row.resets_at > now && row.count >= limit) {
      throw new GuestError(429, 'GUEST_RATE_LIMITED', '操作が集中しています。少し待ってからお試しください。',
        Math.max(1, Math.ceil((row.resets_at - now) / 1000)));
    }
    if (!row || row.resets_at <= now) {
      db.prepare(`INSERT INTO guest_rate_limits VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET count = 1, resets_at = excluded.resets_at`).run(bucket, now + 60_000);
    } else {
      db.prepare('UPDATE guest_rate_limits SET count = count + 1 WHERE bucket = ?').run(bucket);
    }
  }).immediate();
}

export function startGuest(existingToken?: string, db = getDb(), now = Date.now()) {
  if (!guestEnabled()) throw new GuestError(503, 'GUEST_MODE_DISABLED', '現在ゲスト体験は利用できません。');
  for (const [setting, fallback, seedCount] of [['MAX_ITEMS', 50, 6], ['MAX_CATEGORIES', 20, 3], ['MAX_GROUPS', 10, 2], ['MAX_HISTORY', 500, 18]] as const) {
    if (guestLimit(setting, fallback) < seedCount) throw new Error(`GUEST_${setting} must accommodate demo data (${seedCount})`);
  }
  const existing = findGuest(existingToken, db, now);
  if (existing) return { user: existing, token: existingToken!, created: false };
  // 作成に失敗した要求も数える。Cookieを消しても共有カウンタは残る。
  consumeGuestRate('create', guestLimit('CREATES_PER_MINUTE', 30), db, now);
  return db.transaction(() => {
    const active = db.prepare('SELECT COUNT(*) AS count FROM guest_sessions WHERE expires_at > ?')
      .get(now) as { count: number };
    if (active.count >= guestLimit('MAX_ACTIVE', 500)) {
      throw new GuestError(429, 'GUEST_CAPACITY_REACHED', 'ただいま体験が混み合っています。後ほどお試しください。', 60);
    }
    const token = randomBytes(32).toString('hex');
    const expires = now + guestLimit('TTL_HOURS', 24) * 3_600_000;
    const result = db.prepare("INSERT INTO users (email, name, account_type) VALUES (?, 'ゲスト', 'guest')")
      .run(`guest-${randomUUID()}@guest.invalid`);
    const id = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO guest_sessions VALUES (?, ?, ?, ?)').run(hashToken(token), id, now, expires);
    seedDemoData(db, id, now);
    return { user: findGuest(token, db, now)!, token, created: true };
  }).immediate();
}

export function deleteGuestUser(id: number, db = getDb()): boolean {
  return db.transaction(() => {
    if (!db.prepare("SELECT id FROM users WHERE id = ? AND account_type = 'guest'").get(id)) return false;
    db.prepare('DELETE FROM capture_candidates WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM captures WHERE user_id = ?').run(id);
    for (const table of ['price_history', 'notification_settings']) {
      db.prepare(`DELETE FROM ${table} WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)`).run(id);
    }
    for (const table of ['items', 'user_notification_settings', 'categories', 'comparison_groups', 'guest_sessions']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id);
    }
    db.prepare('DELETE FROM guest_rate_limits WHERE bucket IN (?, ?)').run(`write:${id}`, `scrape:${id}`);
    db.prepare("DELETE FROM users WHERE id = ? AND account_type = 'guest'").run(id);
    return true;
  }).immediate();
}

export function endGuest(token: string | undefined, db = getDb()) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  const session = db.prepare('SELECT user_id FROM guest_sessions WHERE token_hash = ?')
    .get(hashToken(token)) as { user_id: number } | undefined;
  if (session) deleteGuestUser(session.user_id, db);
}

export function cleanupGuests(db = getDb(), now = Date.now(), batchSize = 100) {
  const candidates = db.prepare(`SELECT u.id FROM users u LEFT JOIN guest_sessions s ON s.user_id = u.id
    WHERE u.account_type = 'guest' AND (s.expires_at <= ? OR
      (s.user_id IS NULL AND unixepoch(u.created_at) * 1000 <= ?)) LIMIT ?`)
    .all(now, now - guestLimit('TTL_HOURS', 24) * 3_600_000, batchSize) as { id: number }[];
  let deleted = 0;
  for (const { id } of candidates) if (deleteGuestUser(id, db)) deleted++;
  deleteExpiredCaptureCandidates(db, now);
  db.prepare('DELETE FROM guest_rate_limits WHERE resets_at <= ?').run(now);
  return { deleted, remainingBatch: candidates.length === batchSize };
}

export type GuestResource = 'items' | 'categories' | 'comparison_groups' | 'price_history';

// 呼び出し元の書き込みと同じ同期トランザクション内で使用する。
export function assertGuestCapacity(user: { id: number; account_type?: string }, resource: GuestResource, db = getDb()) {
  if (user.account_type !== 'guest') return;
  const settings: Record<GuestResource, [string, number]> = {
    items: ['MAX_ITEMS', 50], categories: ['MAX_CATEGORIES', 20],
    comparison_groups: ['MAX_GROUPS', 10], price_history: ['MAX_HISTORY', 500],
  };
  const query = resource === 'price_history'
    ? 'SELECT COUNT(*) AS count FROM price_history WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)'
    : `SELECT COUNT(*) AS count FROM ${resource} WHERE user_id = ?`;
  const { count } = db.prepare(query).get(user.id) as { count: number };
  const [name, fallback] = settings[resource];
  if (count >= guestLimit(name, fallback)) {
    throw new GuestError(409, 'GUEST_LIMIT_REACHED', 'ゲスト体験の保存件数の上限です。不要なデータを削除してください。');
  }
}

// A network request may outlive a session or race with ending the demo.
export function assertGuestSessionActive(user: { id: number; account_type?: string }, db = getDb()) {
  if (user.account_type === 'guest' && (!guestEnabled() || !db.prepare(
    'SELECT user_id FROM guest_sessions WHERE user_id = ? AND expires_at > ?'
  ).get(user.id, Date.now()))) {
    throw new GuestError(401, 'SESSION_REQUIRED', 'セッションが終了しました。ログイン画面から入り直してください');
  }
}
