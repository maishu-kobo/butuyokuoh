// develop と candidate の各 worktree で同じ手順を実行する。
// このファイルより前に block-network.cjs と register-hooks.mjs を入れること。
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Row = Record<string, unknown>;
type Fixtures = {
  routes: Record<string, { status: number; location?: string; body?: string; contentType?: string }>;
  bodies: Record<string, string>;
};
type CookieEvent = { op: string; name: string; value?: string; options?: unknown };
type CookieJar = { events: CookieEvent[] };
type Authorize = (credentials: { email?: string; password?: string }) => Promise<{
  id?: string;
  email?: string | null;
  name?: string | null;
  sessionGeneration?: number;
} | null>;
type SignInUser = { id?: string; email?: string | null; name?: string | null };
type SignIn = (args: {
  user: SignInUser;
  account?: { provider?: string; providerAccountId?: string } | null;
  profile?: { email?: string; email_verified?: boolean };
}) => Promise<boolean | string>;
type CapturedAuth = {
  callbacks?: { signIn?: SignIn };
  providers?: unknown[];
};
type Step = Record<string, unknown>;

declare global {
  var __DIFF_FIXTURES: Fixtures;
  var __DIFF_NETWORK_LOG: string[];
  var __DIFF_PUPPETEER_LOG: string[];
  var __DIFF_SOCKETS: number;
  var __DIFF_SPAWNS: string[];
  var __DIFF_COOKIE_JAR: CookieJar;
  var __DIFF_NEXTAUTH_CONFIG: CapturedAuth | undefined;
}

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'secret1';
const OWNER_EMAIL = 'owner@example.test';

// 確認済みの新規・連携・再ログインは email_verified: true。
// 未確認は、まだ居ないメールと、パスワードがある会員の両方で拒否される。
export const googleScenarios = [
  ['auth.google.new', 'Fresh@Example.TEST', 'フレッシュ', 'sub-fresh', true],
  ['auth.google.link', 'Linked@Example.TEST', '別名', 'sub-linked', true],
  ['auth.google.existing', 'already@example.test', '既存', 'sub-already', true],
  ['auth.google.guest-email', 'Bot@guest.invalid', 'bot', 'sub-guest', true],
  ['auth.google.blank-email', '  ', 'blank', 'sub-blank', true],
  ['auth.google.unverified', 'Unverified@Example.TEST', '未確認', 'sub-unverified', false],
  ['auth.google.unverified-existing', 'Taken@Example.TEST', '別名', 'sub-taken', false],
  ['auth.google.repeat', 'fresh@example.test', 'フレッシュ', 'sub-fresh', true],
] as const;
const AMAZON = 'https://www.amazon.co.jp/dp/B0TESTKEY1';
const RAKUTEN = 'https://item.rakuten.co.jp/shop/mouse';
const GENERIC = 'https://shop.example.com/items/book';
const SHORT = 'https://amzn.to/keyboard';

const itemsPath = '../../src/app/api/items/route.ts';
const previewPath = '../../src/app/api/items/preview/route.ts';
const refreshPath = '../../src/app/api/items/[id]/refresh/route.ts';
const loginPath = '../../src/app/api/auth/login/route.ts';

async function main() {
  const output = process.argv[2];
  const side = process.argv[3];
  const sha = process.argv[4];
  if (!output || !side || !sha) throw new Error('usage: driver.ts <output> <side> <sha>');
  const dbFile = assertTempDatabase(process.env.BUTUYOKUOH_DB_PATH, process.env.DIFF_TMP_ROOT);
  const hash = process.env.DIFF_PASSWORD_HASH || '';
  if (!hash.startsWith('$2')) throw new Error('DIFF_PASSWORD_HASH is required');

  const fixtures = JSON.parse(readFileSync(path.join(harnessDir, 'fixtures.json'), 'utf8')) as Fixtures;
  globalThis.__DIFF_FIXTURES = fixtures;

  const { getDb } = await import('../../src/lib/db');
  const database = getDb();
  const opened = (database.prepare('PRAGMA database_list').all() as { name: string; file: string }[])
    .find((row) => row.name === 'main')?.file;
  if (!opened || path.resolve(opened) !== dbFile) {
    throw new Error(`refusing database ${opened || '(unset)'}`);
  }

  database.prepare(
    'INSERT INTO users (email, name, password_hash, account_type, google_id) VALUES (?, ?, ?, ?, ?)',
  ).run('owner@example.test', 'オーナー', hash, 'member', null);
  database.prepare(
    'INSERT INTO users (email, name, password_hash, account_type, google_id) VALUES (?, ?, ?, ?, ?)',
  ).run('linked@example.test', 'リンク', hash, 'member', null);
  database.prepare(
    'INSERT INTO users (email, name, password_hash, account_type, google_id) VALUES (?, ?, ?, ?, ?)',
  ).run('already@example.test', '既存', null, 'member', 'sub-already');
  database.prepare(
    'INSERT INTO users (email, name, password_hash, account_type, google_id) VALUES (?, ?, ?, ?, ?)',
  ).run('taken@example.test', '先取り', hash, 'member', null);

  await import('../../src/auth');
  const steps: Record<string, Step> = {};

  await step(steps, 'items.list.logged-out', () => call(itemsPath, 'GET', '/api/items'));
  await step(steps, 'items.preview.logged-out', () => call(previewPath, 'POST', '/api/items/preview', { url: AMAZON }));
  await step(steps, 'items.refresh.logged-out', () => call(refreshPath, 'POST', '/api/items/1/refresh', undefined, { id: '1' }));

  await step(steps, 'auth.login.wrong-type', () => call(loginPath, 'POST', '/api/auth/login', { email: 1, password: PASSWORD }));
  await step(steps, 'auth.login.empty', () => call(loginPath, 'POST', '/api/auth/login', { email: '', password: '' }));
  await step(steps, 'auth.login.wrong-password', () => call(loginPath, 'POST', '/api/auth/login', { email: 'owner@example.test', password: 'nope12' }));
  await step(steps, 'auth.login.unknown', () => call(loginPath, 'POST', '/api/auth/login', { email: 'missing@example.test', password: PASSWORD }));
  await step(steps, 'auth.login.google-only', () => call(loginPath, 'POST', '/api/auth/login', { email: 'already@example.test', password: PASSWORD }));
  await step(steps, 'auth.login.success', () => call(loginPath, 'POST', '/api/auth/login', { email: '  Owner@Example.TEST ', password: PASSWORD }));

  await step(steps, 'auth.credentials.success', () => credentials({ email: 'owner@example.test', password: PASSWORD }));
  await step(steps, 'auth.credentials.wrong-case', () => credentials({ email: 'Owner@Example.TEST', password: PASSWORD }));
  await step(steps, 'auth.credentials.wrong-password', () => credentials({ email: 'owner@example.test', password: 'nope12' }));
  await step(steps, 'auth.credentials.google-only', () => credentials({ email: 'already@example.test', password: PASSWORD }));

  await step(steps, 'items.preview.amazon', () => call(previewPath, 'POST', '/api/items/preview', { url: AMAZON }));
  await step(steps, 'items.preview.rakuten', () => call(previewPath, 'POST', '/api/items/preview', { url: RAKUTEN }));
  await step(steps, 'items.preview.generic', () => call(previewPath, 'POST', '/api/items/preview', { url: GENERIC }));
  await step(steps, 'items.preview.short', () => call(previewPath, 'POST', '/api/items/preview', { url: SHORT }));

  await step(steps, 'items.create.amazon', () => call(itemsPath, 'POST', '/api/items', { url: AMAZON, priority: 1, notes: '赤軸', quantity: 1 }));
  await step(steps, 'items.create.rakuten', () => call(itemsPath, 'POST', '/api/items', { url: RAKUTEN, priority: 2, quantity: 1 }));
  await step(steps, 'items.create.generic', () => call(itemsPath, 'POST', '/api/items', { url: GENERIC, priority: 3, quantity: 2, notes: '文庫' }));
  await step(steps, 'items.create.short', () => call(itemsPath, 'POST', '/api/items', { url: SHORT, priority: 4 }));
  await step(steps, 'items.create.duplicate', () => call(itemsPath, 'POST', '/api/items', { url: AMAZON }));
  await step(steps, 'items.create.missing-url', () => call(itemsPath, 'POST', '/api/items', {}));
  await step(steps, 'items.list', () => call(itemsPath, 'GET', '/api/items'));

  const amazonId = createdId(steps, 'items.create.amazon');
  const rakutenId = createdId(steps, 'items.create.rakuten');
  await step(steps, 'items.refresh.amazon.same', () => refresh(amazonId));
  fixtures.bodies.amazon = fixtures.bodies.amazon.replace('¥1,280', '¥980');
  await step(steps, 'items.refresh.amazon.changed', () => refresh(amazonId));
  await step(steps, 'items.refresh.rakuten.same', () => refresh(rakutenId));
  await step(steps, 'items.refresh.missing', () => call(refreshPath, 'POST', '/api/items/999999/refresh', undefined, { id: '999999' }));
  await step(steps, 'items.list.after-refresh', () => call(itemsPath, 'GET', '/api/items'));

  await step(steps, 'items.create.not-a-url', () => call(itemsPath, 'POST', '/api/items', { url: 'not-a-url' }));
  await step(steps, 'items.create.javascript-url', () => call(itemsPath, 'POST', '/api/items', { url: 'javascript:alert(1)' }));
  await step(steps, 'items.list.after-invalid', () => call(itemsPath, 'GET', '/api/items'));

  for (const [id, email, name, providerAccountId, emailVerified] of googleScenarios) {
    await step(steps, id, () => google(email, name, providerAccountId, emailVerified));
  }

  const snapshot = {
    side,
    sha,
    steps,
    db: dump(database),
    network: {
      requests: globalThis.__DIFF_NETWORK_LOG,
      puppeteer: globalThis.__DIFF_PUPPETEER_LOG,
      sockets: globalThis.__DIFF_SOCKETS,
      spawns: globalThis.__DIFF_SPAWNS,
    },
  };
  writeFileSync(output, JSON.stringify(snapshot));
}

function assertTempDatabase(file: string | undefined, root: string | undefined): string {
  if (!file || !root) throw new Error('BUTUYOKUOH_DB_PATH and DIFF_TMP_ROOT are required');
  const temporary = realpathSync(root);
  const resolved = path.resolve(file);
  const parent = realpathSync(path.dirname(resolved));
  const full = path.join(parent, path.basename(resolved));
  const production = `${path.sep}data${path.sep}butuyokuoh.db`;
  if (!full.startsWith(`${temporary}${path.sep}`) || full.includes(production) || path.basename(full) === 'butuyokuoh.db') {
    throw new Error(`refusing database path ${full}`);
  }
  return full;
}

async function step(steps: Record<string, Step>, id: string, run: () => Promise<Step>) {
  const jar = globalThis.__DIFF_COOKIE_JAR;
  const from = jar.events.length;
  try {
    const result = await run();
    steps[id] = { ...result, cookies: cookiesSince(jar, from) };
  } catch (error) {
    steps[id] = { threw: error instanceof Error ? error.message : String(error), cookies: cookiesSince(jar, from) };
  }
}

function cookiesSince(jar: CookieJar, from: number) {
  return jar.events.slice(from).map((event) => ({
    op: event.op,
    name: event.name,
    value: event.value ?? null,
    options: event.options ?? null,
  }));
}

async function call(modulePath: string, method: string, urlPath: string, body?: unknown, params?: Record<string, string>): Promise<Step> {
  const { NextRequest } = await import('next/server');
  const loaded = await import(modulePath) as Record<string, (
    request: InstanceType<typeof NextRequest>,
    context?: { params: Promise<Record<string, string>> },
  ) => Promise<Response>>;
  const handler = loaded[method];
  if (!handler) throw new Error(`${method} is not exported from ${modulePath}`);
  const request = new NextRequest(`http://127.0.0.1${urlPath}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, params ? { params: Promise.resolve(params) } : undefined);
  const text = await response.text();
  const type = response.headers.get('content-type') || '';
  const cacheControl = response.headers.get('cache-control');
  if (type.includes('json') && text) {
    try {
      return { status: response.status, json: JSON.parse(text) as unknown, cacheControl };
    } catch {
      return { status: response.status, text, cacheControl };
    }
  }
  return { status: response.status, text, cacheControl };
}

function createdId(steps: Record<string, Step>, id: string): number | null {
  const json = steps[id]?.json;
  if (!json || typeof json !== 'object' || !('id' in json)) return null;
  const value = (json as { id: unknown }).id;
  return typeof value === 'number' ? value : null;
}

async function refresh(id: number | null): Promise<Step> {
  if (id === null) return { skipped: true };
  return call(refreshPath, 'POST', `/api/items/${id}/refresh`, undefined, { id: String(id) });
}

async function credentials(input: { email: string; password: string }): Promise<Step> {
  const authorize = await findAuthorize(globalThis.__DIFF_NEXTAUTH_CONFIG);
  if (!authorize) return { available: false };
  const user = await authorize(input);
  return {
    available: true,
    user: user ? {
      id: user.id ?? null,
      email: user.email ?? null,
      name: user.name ?? null,
      ...(typeof user.sessionGeneration === 'number' ? { sessionGeneration: user.sessionGeneration } : {}),
    } : null,
  };
}

export async function google(
  email: string,
  name: string,
  providerAccountId: string,
  emailVerified = true,
): Promise<Step> {
  const signIn = globalThis.__DIFF_NEXTAUTH_CONFIG?.callbacks?.signIn;
  if (!signIn) return { available: false };
  const user: SignInUser = { email, name };
  const allowed = await signIn({
    user,
    account: { provider: 'google', providerAccountId },
    profile: { email, email_verified: emailVerified },
  });
  return { allowed, assignedUserId: user.id ?? null };
}

// provider.authorize は常に null を返す入れ物で、実装は options の中にある。
// 関数ソースの verifyPassword では confirmVerifiedPassword を見つけられない。
// 用意したオーナーの正しいパスワードだけ会員を返し、違うパスワードと空入力は null の関数を authorize とする。
const authorizeCache = new WeakMap<object, Authorize | null>();

export async function findAuthorize(config: CapturedAuth | undefined): Promise<Authorize | null> {
  if (!config) return null;
  const cached = authorizeCache.get(config);
  if (cached !== undefined) return cached;
  const matches: Authorize[] = [];
  for (const fn of collectFunctions(config.providers || [])) {
    if (await acceptsOwnerPassword(fn)) matches.push(fn);
  }
  // 同じ戻り値の関数が二つあると、wrong-case や google-only を別の関数で見てしまう。
  const found = matches.length === 1 ? matches[0] : null;
  authorizeCache.set(config, found);
  return found;
}

function collectFunctions(roots: unknown[]): Authorize[] {
  const found: Authorize[] = [];
  const seen = new Set<unknown>();
  const stack = [...roots];
  while (stack.length) {
    const current = stack.pop();
    if (current == null || seen.has(current)) continue;
    if (typeof current === 'function') {
      seen.add(current);
      found.push(current as Authorize);
      continue;
    }
    if (typeof current !== 'object') continue;
    seen.add(current);
    for (const value of Object.values(current as Row)) {
      if (typeof value === 'function' || (value && typeof value === 'object')) stack.push(value);
    }
  }
  return found;
}

async function acceptsOwnerPassword(fn: Authorize): Promise<boolean> {
  try {
    const ok = await fn({ email: OWNER_EMAIL, password: PASSWORD });
    const wrong = await fn({ email: OWNER_EMAIL, password: 'nope12' });
    const empty = await fn({});
    if (!ok || typeof ok !== 'object') return false;
    if (ok.email !== OWNER_EMAIL || ok.id == null || ok.id === '') return false;
    return wrong === null && empty === null;
  } catch {
    return false;
  }
}

function dump(database: { prepare: (sql: string) => { all: () => unknown[] } }) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as { name: string }[];
  const columns: Record<string, string[]> = {};
  const rows: Record<string, Row[]> = {};
  for (const table of tables) {
    const name = identifier(table.name);
    columns[table.name] = (database.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((column) => column.name);
    rows[table.name] = database.prepare(`SELECT * FROM ${name}`).all() as Row[];
  }
  const indexes = (database.prepare(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_stat%' ORDER BY name",
  ).all() as { name: string; tbl_name: string; sql: string | null }[]).map((index) => ({
    name: index.name,
    table: index.tbl_name,
    sql: index.sql,
  }));
  return { columns, rows, indexes };
}

function identifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unexpected table name ${name}`);
  return `"${name}"`;
}

function ranAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (ranAsScript()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
