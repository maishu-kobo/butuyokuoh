// 特性テスト用。本番の DB と環境変数は使わない。
// このファイルを、db.ts を読むどの import よりも先に読むこと。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CurrentUser } from '../src/lib/auth';

const directory = mkdtempSync(join(tmpdir(), 'butuyokuoh-regression-'));
const dbPath = join(directory, 'app.sqlite');
if (dbPath.includes(`${join('data', 'butuyokuoh.db')}`)) {
  throw new Error('refusing to use the application database');
}

process.env.BUTUYOKUOH_DB_PATH = dbPath;
process.env.JWT_SECRET = 'regression-only-jwt-secret';
process.env.AUTH_SECRET = 'regression-only-auth-secret';
process.env.NEXTAUTH_SECRET = 'regression-only-auth-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
delete process.env.GUEST_MODE_ENABLED;

export type ApiResult = {
  status: number;
  text: string;
  bytes: Uint8Array;
  json: unknown;
  headers: Headers;
};

export async function db() {
  const { getDb } = await import('../src/lib/db');
  const database = getDb();
  const rows = database.prepare('PRAGMA database_list').all() as { name: string; file: string }[];
  const file = rows.find((row) => row.name === 'main')?.file ?? '';
  if (!file.includes('butuyokuoh-regression-')) {
    throw new Error(`refusing non-temp database: ${file || '(unset)'}`);
  }
  return database;
}

let sequence = 0;

export async function createMember(label = 'member') {
  const database = await db();
  const email = `${label}-${++sequence}@example.test`;
  const id = Number(database.prepare('INSERT INTO users (email, name) VALUES (?, ?)').run(email, label).lastInsertRowid);
  const user = database.prepare(
    'SELECT id, email, name, created_at, account_type FROM users WHERE id = ?',
  ).get(id) as CurrentUser;
  if (!user || user.account_type !== 'member') throw new Error('member was not created');
  await setTestUser(user);
  return user;
}

export async function setTestUser(user: CurrentUser | null) {
  const { installAuthTestHooks } = await import('../src/lib/auth');
  installAuthTestHooks({ user });
}

export async function cookieSink() {
  const saved: {
    name?: string;
    value?: string;
    options?: { httpOnly?: boolean; secure?: boolean; sameSite?: string; maxAge?: number; path?: string };
    deleted?: boolean;
  } = {};
  const { installAuthTestHooks } = await import('../src/lib/auth');
  installAuthTestHooks({
    cookies: {
      set(name, value, options) {
        saved.name = name;
        saved.value = value;
        saved.options = options;
        saved.deleted = false;
      },
      delete(name) {
        saved.name = name;
        saved.deleted = true;
        saved.value = undefined;
      },
    },
  });
  return saved;
}

export async function call(
  modulePath: string,
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
  headers?: Record<string, string>,
  requestUrl?: string,
): Promise<ApiResult> {
  const { NextRequest } = await import('next/server');
  const loaded = await import(modulePath) as Record<string, (
    request: InstanceType<typeof NextRequest>,
    context?: { params: Promise<Record<string, string>> },
  ) => Promise<Response>>;
  const handler = loaded[method];
  if (!handler) throw new Error(`${method} is not exported from ${modulePath}`);
  const requestHeaders = new Headers(body === undefined ? undefined : { 'content-type': 'application/json' });
  for (const [key, value] of Object.entries(headers ?? {})) requestHeaders.set(key, value);
  const request = new NextRequest(requestUrl ?? `http://127.0.0.1${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    text,
    bytes,
    json: type.includes('json') && text ? JSON.parse(text) : undefined,
    headers: response.headers,
  };
}
