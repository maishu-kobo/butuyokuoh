import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { linkGoogleAccount } from '../src/lib/link-google-account';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      name TEXT,
      account_type TEXT NOT NULL DEFAULT 'member',
      session_generation INTEGER NOT NULL DEFAULT 0,
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
    account_type: string;
  };
}

function countUsers(db: Database.Database) {
  return (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
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
  assert.equal(user.account_type, 'member');
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
  assert.equal(countUsers(db), 0);
});

test('表記が違う未確認のパスワード登録は確認済みGoogleに結び付いてパスワードを残さない', () => {
  const db = createDb();
  const inserted = db
    .prepare('INSERT INTO users (email, password_hash, name, account_type) VALUES (?, ?, ?, ?)')
    .run('victim@example.com', 'attacker-hash', '先取り', 'member');

  const result = linkGoogleAccount(db, {
    email: '  Victim@Example.COM ',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: true, userId: Number(inserted.lastInsertRowid) });
  const user = userById(db, Number(inserted.lastInsertRowid));
  assert.equal(user.password_hash, null);
  assert.equal(user.google_id, 'google-victim');
  assert.equal(user.account_type, 'member');
  assert.equal(countUsers(db), 1);
});

test('大文字のまま残った先取り行は確認済みGoogleで無効化され、別ユーザーを作らない', () => {
  const db = createDb();
  const inserted = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('Victim@Example.com', 'attacker-hash', 'member');

  const result = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: true, userId: Number(inserted.lastInsertRowid) });
  const loginTarget = db.prepare(
    "SELECT id, password_hash, google_id FROM users WHERE LOWER(email) = ? AND account_type = 'member' ORDER BY id LIMIT 1"
  ).get('victim@example.com') as { id: number; password_hash: string | null; google_id: string | null };
  assert.equal(loginTarget.id, Number(inserted.lastInsertRowid));
  assert.equal(loginTarget.password_hash, null);
  assert.equal(loginTarget.google_id, 'google-victim');
  assert.equal(countUsers(db), 1);
});

test('表記ゆれで残った先取り行はどれもパスワードを残さず、Google IDはログイン対象の行だけに付く', () => {
  const db = createDb();
  const older = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('Victim@Example.com', 'older-hash', 'member');
  const newer = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('victim@example.com', 'newer-hash', 'member');

  const result = linkGoogleAccount(db, {
    email: 'VICTIM@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: true, userId: Number(older.lastInsertRowid) });
  const olderUser = userById(db, Number(older.lastInsertRowid));
  const newerUser = userById(db, Number(newer.lastInsertRowid));
  assert.equal(olderUser.password_hash, null);
  assert.equal(olderUser.google_id, 'google-victim');
  assert.equal(newerUser.password_hash, null);
  assert.equal(newerUser.google_id, null);
  assert.equal(countUsers(db), 2);
});

test('既存のGoogle会員がいるとき、表記違いの先取り行は結び付けずパスワードも残さない', () => {
  const db = createDb();
  const preempted = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('Victim@Example.com', 'attacker-hash', 'member');
  const googleUser = db
    .prepare('INSERT INTO users (email, google_id, account_type) VALUES (?, ?, ?)')
    .run('victim@example.com', 'google-victim', 'member');

  const result = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: true, userId: Number(googleUser.lastInsertRowid) });
  const preemptedUser = userById(db, Number(preempted.lastInsertRowid));
  const linked = userById(db, Number(googleUser.lastInsertRowid));
  assert.equal(preemptedUser.google_id, null);
  assert.equal(preemptedUser.password_hash, null);
  assert.equal(linked.google_id, 'google-victim');
  assert.equal(linked.password_hash, null);
  assert.equal(countUsers(db), 2);
});

test('未確認のGoogleメールは表記が違っても先取り行を変えない', () => {
  const db = createDb();
  db.prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)').run(
    'victim@example.com',
    'attacker-hash',
    'member'
  );

  const result = linkGoogleAccount(db, {
    email: 'Victim@Example.com',
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
  assert.equal(countUsers(db), 1);
});

test('ゲスト行にはGoogle IDを付けず、パスワードも消さない', () => {
  const db = createDb();
  db.prepare(
    'INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)'
  ).run('victim@example.com', 'guest-hash', 'guest');

  const result = linkGoogleAccount(db, {
    email: 'Victim@Example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: false, reason: 'account_conflict' });
  const guest = db.prepare('SELECT password_hash, google_id, account_type FROM users').get() as {
    password_hash: string | null;
    google_id: string | null;
    account_type: string;
  };
  assert.equal(guest.account_type, 'guest');
  assert.equal(guest.password_hash, 'guest-hash');
  assert.equal(guest.google_id, null);
  assert.equal(countUsers(db), 1);
});

test('@guest.invalid は会員として作らない', () => {
  const db = createDb();
  const result = linkGoogleAccount(db, {
    email: '  Person@Guest.Invalid ',
    googleId: 'google-guest',
    name: 'ゲスト偽装',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: false, reason: 'rejected_email' });
  assert.equal(countUsers(db), 0);
});

function generation(db: Database.Database, id: number) {
  return (db.prepare('SELECT session_generation FROM users WHERE id = ?').get(id) as {
    session_generation: number;
  }).session_generation;
}

test('パスワードを消す行だけセッション世代を進め、再ログインでは進めない', () => {
  const db = createDb();
  const older = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('Victim@Example.com', 'older-hash', 'member');
  const newer = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('victim@example.com', 'newer-hash', 'member');
  const olderId = Number(older.lastInsertRowid);
  const newerId = Number(newer.lastInsertRowid);

  const unverified = linkGoogleAccount(db, {
    email: 'VICTIM@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: false,
  });
  assert.deepEqual(unverified, { ok: false, reason: 'unverified_email' });
  assert.equal(generation(db, olderId), 0);
  assert.equal(generation(db, newerId), 0);

  const linked = linkGoogleAccount(db, {
    email: 'VICTIM@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });
  assert.deepEqual(linked, { ok: true, userId: olderId });
  assert.equal(generation(db, olderId), 1);
  assert.equal(generation(db, newerId), 1);

  const again = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });
  assert.deepEqual(again, { ok: true, userId: olderId });
  assert.equal(generation(db, olderId), 1);
  assert.equal(generation(db, newerId), 1);
});

test('既にパスワードのないGoogle会員の世代は残し、先取り行だけ進める', () => {
  const db = createDb();
  const preempted = db
    .prepare('INSERT INTO users (email, password_hash, account_type) VALUES (?, ?, ?)')
    .run('Victim@Example.com', 'attacker-hash', 'member');
  const googleUser = db
    .prepare('INSERT INTO users (email, google_id, account_type) VALUES (?, ?, ?)')
    .run('victim@example.com', 'google-victim', 'member');

  const result = linkGoogleAccount(db, {
    email: 'victim@example.com',
    googleId: 'google-victim',
    name: '本人',
    emailVerified: true,
  });

  assert.deepEqual(result, { ok: true, userId: Number(googleUser.lastInsertRowid) });
  assert.equal(generation(db, Number(googleUser.lastInsertRowid)), 0);
  assert.equal(generation(db, Number(preempted.lastInsertRowid)), 1);
  assert.equal(userById(db, Number(preempted.lastInsertRowid)).password_hash, null);
});

test('新規の確認済みGoogleユーザーはメールを小文字で保存する', () => {
  const db = createDb();
  const result = linkGoogleAccount(db, {
    email: '  New.User@Example.COM ',
    googleId: 'google-new-case',
    name: '新規',
    emailVerified: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const user = userById(db, result.userId);
  assert.equal(user.email, 'new.user@example.com');
  assert.equal(user.password_hash, null);
  assert.equal(user.google_id, 'google-new-case');
  assert.equal(user.account_type, 'member');
  assert.equal(countUsers(db), 1);
});
