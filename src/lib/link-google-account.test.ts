import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { linkGoogleAccount } from './link-google-account';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function userById(db: Database.Database, id: number) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as {
    id: number;
    email: string;
    password_hash: string | null;
    google_id: string | null;
    name: string | null;
  };
}

test('確認済みGoogleログインは先に作られたパスワードを無効化する', () => {
  const db = createDb();
  const inserted = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run('victim@example.com', 'attacker-hash', '先取り');

  const result = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: true, userId: Number(inserted.lastInsertRowid) });
  const user = userById(db, Number(inserted.lastInsertRowid));
  assert.equal(user.password_hash, null);
  assert.equal(user.google_id, 'google-victim');
  assert.equal(user.name, '先取り');
});

test('未確認のGoogleメールでは既存アカウントを変更しない', () => {
  const db = createDb();
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(
    'victim@example.com',
    'attacker-hash'
  );

  const result = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: false,
  });

  assert.deepEqual(result, { ok: false, reason: 'unverified_email' });
  const user = db.prepare('SELECT password_hash, google_id FROM users').get() as {
    password_hash: string | null;
    google_id: string | null;
  };
  assert.equal(user.password_hash, 'attacker-hash');
  assert.equal(user.google_id, null);
});

test('別のGoogleアカウントに結び付いたメールは奪わない', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO users (email, password_hash, google_id) VALUES (?, ?, ?)'
  ).run('victim@example.com', 'real-hash', 'google-real');

  const result = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-attacker',
    name: '攻撃者',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: false, reason: 'account_conflict' });
  const user = db.prepare('SELECT password_hash, google_id FROM users').get() as {
    password_hash: string | null;
    google_id: string | null;
  };
  assert.equal(user.password_hash, 'real-hash');
  assert.equal(user.google_id, 'google-real');
});

test('新規の確認済みGoogleユーザーを作る', () => {
  const db = createDb();

  const result = linkGoogleAccount(db, {
    email: 'new@example.com',
    googleId: 'google-new',
    name: '新規',
    emailVerified: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const user = userById(db, result.userId);
  assert.equal(user.email, 'new@example.com');
  assert.equal(user.password_hash, null);
  assert.equal(user.google_id, 'google-new');
  assert.equal(user.name, '新規');
});

test('同じGoogle IDの再ログインは同じユーザーのままパスワードを残さない', () => {
  const db = createDb();
  const first = linkGoogleAccount(db, {
    email: 'new@example.com',
    googleId: 'google-new',
    name: '新規',
    emailVerified: true,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run('later-hash', first.userId);

  const second = linkGoogleAccount(db, {
    email: 'new@example.com',
    googleId: 'google-new',
    name: null,
    emailVerified: true,
  });

  assert.deepEqual(second, { ok: true, userId: first.userId });
  const user = userById(db, first.userId);
  assert.equal(user.password_hash, null);
  assert.deepEqual(db.prepare('SELECT COUNT(*) as count FROM users').get(), { count: 1 });
});

test('メールもGoogle IDも空なら何も作らない', () => {
  const db = createDb();
  const result = linkGoogleAccount(db, {
    email: '   ',
    googleId: 'google-new',
    name: null,
    emailVerified: true,
  });
  assert.deepEqual(result, { ok: false, reason: 'missing_identity' });
  assert.equal(
    (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count,
    0
  );
});
