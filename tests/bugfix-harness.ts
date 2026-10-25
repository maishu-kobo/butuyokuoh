// バグ修正のテスト用。本番の DB は開かない。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CurrentUser } from '../src/lib/auth';

const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-bugfix-'));
process.env.BUTUYOKUOH_DB_PATH = join(directory, 'app.sqlite');
process.env.JWT_SECRET = 'bugfix-only-jwt-secret';
process.env.AUTH_SECRET = 'bugfix-only-auth-secret';
process.env.NEXTAUTH_SECRET = 'bugfix-only-auth-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
delete process.env.GUEST_MODE_ENABLED;

let sequence = 0;

export async function db() {
  const { getDb } = await import('../src/lib/db');
  const database = getDb();
  const file = (database.prepare('PRAGMA database_list').all() as { name: string; file: string }[])
    .find((row) => row.name === 'main')?.file ?? '';
  if (!file.includes('butuyokuoh-bugfix-')) throw new Error(`refusing non-temp database: ${file || '(unset)'}`);
  return database;
}

export async function createMember(label = 'member') {
  const database = await db();
  const email = `${label}-${++sequence}@example.test`;
  const id = Number(database.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(email, label).lastInsertRowid);
  const user = database.prepare('SELECT id, email, name, created_at, account_type FROM users WHERE id = ?').get(id) as CurrentUser;
  if (!user || user.account_type !== 'member') throw new Error('member was not created');
  const { installAuthTestHooks } = await import('../src/lib/auth');
  installAuthTestHooks({ user });
  return user;
}

export async function call(modulePath: string, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const { NextRequest } = await import('next/server');
  const loaded = await import(modulePath) as Record<string, (
    request: InstanceType<typeof NextRequest>,
    context?: { params: Promise<Record<string, string>> },
  ) => Promise<Response>>;
  const request = new NextRequest(`http://127.0.0.1${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await loaded[method](request, params ? { params: Promise.resolve(params) } : undefined);
  const text = await response.text();
  const type = response.headers.get('content-type') || '';
  return { status: response.status, text, json: type.includes('json') && text ? JSON.parse(text) as unknown : undefined };
}
