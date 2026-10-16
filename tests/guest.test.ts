import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/lib/db';
import { startGuest, findGuest, endGuest, cleanupGuests, consumeGuestRate, assertGuestCapacity, GuestError, deleteGuestUser } from '../src/lib/guest';
import { priceCheckItems } from '../src/lib/price-check-items';

process.env.GUEST_MODE_ENABLED = 'true';
const now = Date.now();
const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;

test('separate guest identities, hashed cookie, fixed deadline and demo data', () => {
  const db = openDatabase(':memory:');
  try {
    const a = startGuest(undefined, db, now), b = startGuest(undefined, db, now);
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.user.id, b.user.id);
    assert.equal(a.user.email, null);
    assert.equal(count(db, 'items'), 12);
    assert.equal(count(db, 'categories'), 6);
    assert.equal(count(db, 'comparison_groups'), 4);
    assert.equal(count(db, 'price_history'), 36);
    assert.equal(db.prepare('SELECT token_hash FROM guest_sessions WHERE token_hash = ?').get(a.token), undefined);
    assert.equal(startGuest(a.token, db, now + 1000).user.expiresAt, a.user.expiresAt);
    assert.equal(count(db, 'items'), 12);
    assert.equal(findGuest(a.token, db, now + 24 * 3600_000), null);
    assert.equal(findGuest('bad-token', db, now), null);
  } finally { db.close(); }
});

test('feature flag blocks creation and resumption without deleting data', () => {
  const db = openDatabase(':memory:');
  const a = startGuest(undefined, db, now);
  try {
    process.env.GUEST_MODE_ENABLED = 'false';
    assert.throws(() => startGuest(a.token, db, now), (e: unknown) => e instanceof GuestError && e.status === 503);
    endGuest(a.token, db);
    assert.equal(count(db, 'users'), 0);
  } finally { process.env.GUEST_MODE_ENABLED = 'true'; db.close(); }
});

test('cleanup explicitly removes children with foreign keys off and preserves members', () => {
  const db = openDatabase(':memory:');
  db.pragma('foreign_keys = OFF');
  try {
    const guest = startGuest(undefined, db, now);
    const member = Number(db.prepare("INSERT INTO users(email) VALUES ('member@example.test')").run().lastInsertRowid);
    db.prepare("INSERT INTO items(user_id,name,url) VALUES (?, 'member', 'https://example.test')").run(member);
    const item = (db.prepare('SELECT id FROM items WHERE user_id = ? LIMIT 1').get(guest.user.id) as {id:number}).id;
    db.prepare('INSERT INTO notification_settings(item_id) VALUES (?)').run(item);
    db.prepare('INSERT INTO user_notification_settings(user_id) VALUES (?)').run(guest.user.id);
    assert.equal(deleteGuestUser(member, db), false);
    assert.equal(cleanupGuests(db, now + 24 * 3600_000).deleted, 1);
    for (const table of ['guest_sessions','categories','comparison_groups','price_history','notification_settings','user_notification_settings']) assert.equal(count(db, table), 0, table);
    assert.equal(count(db, 'items'), 1);
    assert.equal(count(db, 'users'), 1);
    assert.equal(cleanupGuests(db, now + 24 * 3600_000).deleted, 0);
    endGuest(guest.token, db);
    assert.equal(count(db, 'users'), 1);
  } finally { db.close(); }
});

test('cleanup rolls back completely on failure; old orphan guests are collected', () => {
  const db = openDatabase(':memory:');
  try {
    const a = startGuest(undefined, db, now);
    db.exec("CREATE TRIGGER refuse_guest_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    assert.throws(() => endGuest(a.token, db));
    assert.equal(count(db, 'items'), 6);
    assert.equal(count(db, 'guest_sessions'), 1);
    db.exec('DROP TRIGGER refuse_guest_delete');
    db.prepare('DELETE FROM guest_sessions').run();
    db.prepare("UPDATE users SET created_at = datetime('now', '-2 days')").run();
    assert.equal(cleanupGuests(db, now).deleted, 1);
    assert.equal(count(db, 'items'), 0);
  } finally { db.close(); }
});

test('rate counter persists across connections and cookie deletion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guest-rate-test-'));
  const filename = join(directory, 'db.sqlite');
  let db = openDatabase(filename);
  try {
    consumeGuestRate('create', 1, db, now);
    db.close(); db = openDatabase(filename);
    assert.throws(() => consumeGuestRate('create', 1, db, now + 1000), (e: unknown) => e instanceof GuestError && e.status === 429 && e.retryAfter === 59);
    consumeGuestRate('create', 1, db, now + 60_000);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('active-session cap and resource/history checks roll back writes atomically', () => {
  const db = openDatabase(':memory:');
  try {
    process.env.GUEST_MAX_ACTIVE = '1';
    const a = startGuest(undefined, db, now);
    assert.throws(() => startGuest(undefined, db, now), (e: unknown) => e instanceof GuestError && e.status === 429);
    assert.equal(count(db, 'users'), 1);
    process.env.GUEST_MAX_HISTORY = '18';
    assert.throws(() => db.transaction(() => {
      db.prepare("INSERT INTO items(user_id,name,url) VALUES (?, 'rollback', 'manual://rollback')").run(a.user.id);
      assertGuestCapacity(a.user, 'price_history', db);
    }).immediate(), (e: unknown) => e instanceof GuestError && e.status === 409);
    assert.equal(count(db, 'items'), 6);
    process.env.GUEST_MAX_ITEMS = '6';
    assert.throws(() => assertGuestCapacity(a.user, 'items', db));
    assertGuestCapacity({ id: a.user.id, account_type: 'member' }, 'items', db);
  } finally { delete process.env.GUEST_MAX_ACTIVE; delete process.env.GUEST_MAX_HISTORY; delete process.env.GUEST_MAX_ITEMS; db.close(); }
});

test('background price checks exclude guests even if a real URL is set', () => {
  const db = openDatabase(':memory:');
  try {
    const a = startGuest(undefined, db, now);
    db.prepare("UPDATE items SET url = 'https://example.test/' || id WHERE user_id = ?").run(a.user.id);
    assert.deepEqual(priceCheckItems(db), []);
    const member = db.prepare("INSERT INTO users(email) VALUES ('member@example.test')").run().lastInsertRowid;
    db.prepare("INSERT INTO items(user_id,name,url) VALUES (?, 'member', 'https://example.test')").run(member);
    assert.equal(priceCheckItems(db).length, 1);
  } finally { db.close(); }
});

test('migration preserves existing members and is repeatable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guest-migration-test-'));
  const filename = join(directory, 'db.sqlite');
  let db = new Database(filename);
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, created_at TEXT DEFAULT (datetime('now'))); INSERT INTO users(email,name) VALUES ('member@example.test','existing');");
  db.close();
  try {
    db = openDatabase(filename); db.close(); db = openDatabase(filename);
    assert.equal((db.prepare('SELECT account_type FROM users').get() as {account_type:string}).account_type, 'member');
    assert.equal(count(db, 'users'), 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
