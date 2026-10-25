import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, formatReport, loadApprovals, type Snapshot } from '../scripts/diff-harness/compare';
import { findAuthorize, google } from '../scripts/diff-harness/driver';

const approvalsPath = new URL('../scripts/diff-harness/approved-changes.json', import.meta.url);
const HASH = `$2b$10$${ 'a'.repeat(53)}`;

test('authorize is chosen by accepting the owner password and rejecting a wrong one', async () => {
  async function realAuthorize(credentials: { email?: string; password?: string }) {
    if (credentials.email === 'owner@example.test' && credentials.password === 'secret1') {
      return { id: '7', email: 'owner@example.test', name: 'オーナー' };
    }
    return null;
  }
  async function decoy() {
    const marker = 'verifyPassword';
    void marker;
    return { id: 'decoy', email: 'owner@example.test', name: 'decoy' };
  }
  const found = await findAuthorize({
    providers: [{
      authorize: () => null,
      options: { trap: decoy, authorize: realAuthorize },
    }],
  });
  assert.equal(found, realAuthorize);
});

test('two functions that both accept the owner password are not used as authorize', async () => {
  async function accept(credentials: { email?: string; password?: string }) {
    if (credentials.email === 'owner@example.test' && credentials.password === 'secret1') {
      return { id: '7', email: 'owner@example.test', name: 'オーナー' };
    }
    return null;
  }
  async function alsoAccept(credentials: { email?: string; password?: string }) {
    return accept(credentials);
  }
  const found = await findAuthorize({
    providers: [{ options: { authorize: accept, also: alsoAccept } }],
  });
  assert.equal(found, null);
});

test('google sign-in passes a verified profile, and an unverified one stays unverified', async () => {
  const seen: Array<{ profile?: { email?: string; email_verified?: boolean } }> = [];
  globalThis.__DIFF_NEXTAUTH_CONFIG = {
    callbacks: {
      signIn: async (args) => {
        seen.push(args as { profile?: { email?: string; email_verified?: boolean } });
        const profile = (args as { profile?: { email_verified?: boolean } }).profile;
        return profile?.email_verified === true;
      },
    },
  };
  const verified = await google('Fresh@Example.TEST', 'フレッシュ', 'sub-fresh');
  const unverified = await google('Unverified@Example.TEST', '未確認', 'sub-unverified', false);
  assert.equal(verified.allowed, true);
  assert.deepEqual(seen[0]?.profile, { email: 'Fresh@Example.TEST', email_verified: true });
  assert.equal(unverified.allowed, false);
  assert.deepEqual(seen[1]?.profile, { email: 'Unverified@Example.TEST', email_verified: false });
});

test('approved changes name the session generation and verified-link differences, in that dependency order', () => {
  const rules = loadApprovals(approvalsPath.pathname);
  const ids = rules.map((rule) => rule.id);
  const retired = ids.indexOf('verified-link-retires-password');
  const column = ids.indexOf('session-generation-column');
  const existing = ids.indexOf('unverified-existing-rejected');
  const credentials = ids.indexOf('credentials-session-generation');
  const token = ids.indexOf('session-generation-token');
  assert.ok(retired >= 0 && column > retired, 'session_generation column is approved after the link bump');
  assert.ok(existing >= 0 && column > existing, 'existing unverified rejection is checked before the column is removed');
  assert.ok(credentials >= 0 && token > credentials, 'credentials generation is checked before every 0 is stripped');
  assert.ok(ids.includes('unverified-google-rejected'));
  for (const rule of rules) {
    if (!REQUIRED_APPROVALS.includes(rule.id)) continue;
    assert.equal(typeof rule.reason, 'string');
    assert.ok(rule.reason.trim().length > 0, rule.id);
  }
});

test('the takeover snapshot matches develop once the recorded approvals are applied', () => {
  const report = compareSnapshots(baselineSnapshot(), candidateSnapshot(), loadApprovals(approvalsPath.pathname));
  assert.equal(report.ok, true, formatReport(report));
  const applied = new Map(report.approvals.map((entry) => [entry.id, entry.applied]));
  for (const id of REQUIRED_APPROVALS) assert.ok((applied.get(id) ?? 0) >= 1, id);
});

test('matching develop is not enough when a required takeover difference disappears', () => {
  const report = compareSnapshots(baselineSnapshot(), baselineSnapshot(), loadApprovals(approvalsPath.pathname));
  assert.equal(report.ok, false);
  const paths = report.unexpected.map((entry) => entry.path);
  for (const id of REQUIRED_APPROVALS) {
    assert.ok(paths.includes(`approvals.${id}.required`), id);
  }
});

test('an unverified profile that links an existing password user stays unexpected', () => {
  const stolen = candidateSnapshot();
  const taken = stolen.db.rows.users.find((row) => row.email === 'taken@example.test');
  assert.ok(taken);
  taken.google_id = 'sub-taken';
  taken.password_hash = null;
  taken.session_generation = 1;
  stolen.steps['auth.google.unverified-existing'] = {
    allowed: true,
    assignedUserId: '8',
    cookies: [],
  };
  const report = compareSnapshots(baselineSnapshot(), stolen, loadApprovals(approvalsPath.pathname));
  assert.equal(report.ok, false);
  assert.ok(report.unexpected.some((entry) => entry.path.includes('unverified-existing-rejected')));
});

test('a linked generation other than 1, or a token generation other than 0, stays unexpected', () => {
  const rules = loadApprovals(approvalsPath.pathname);
  const bumped = candidateSnapshot();
  const linked = bumped.db.rows.users.find((row) => row.email === 'linked@example.test');
  assert.ok(linked);
  linked.session_generation = 2;
  const wrongGeneration = compareSnapshots(baselineSnapshot(), bumped, rules);
  assert.equal(wrongGeneration.ok, false);

  const baseline = baselineSnapshot();
  const candidate = baselineSnapshot();
  delete baseline.steps['auth.google.unverified'];
  delete candidate.steps['auth.google.unverified'];
  baseline.db.rows.users = baseline.db.rows.users.filter((row) => row.email !== 'unverified@example.test');
  candidate.db.rows.users = candidate.db.rows.users.filter((row) => row.email !== 'unverified@example.test');
  const token = unsignedJwt({ userId: 1, email: 'owner@example.test', sessionGeneration: 1 });
  const step = candidate.steps['auth.login.success'];
  assert.ok(step);
  step.json = { token };
  step.cookies = [{ op: 'set', name: 'auth', value: token, options: null }];
  const wrongToken = compareSnapshots(baseline, candidate, rules);
  assert.equal(wrongToken.ok, false);
  assert.ok(wrongToken.unexpected.some((entry) => entry.path.includes('sessionGeneration')));
});

const REQUIRED_APPROVALS = [
  'verified-link-retires-password',
  'unverified-existing-rejected',
  'session-generation-column',
  'credentials-session-generation',
  'session-generation-token',
  'unverified-google-rejected',
];

function unsignedJwt(payload: Record<string, unknown>): string {
  return `hdr.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

function user(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    email: 'owner@example.test',
    password_hash: HASH,
    google_id: null,
    name: 'オーナー',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    account_type: 'member',
    ...partial,
  };
}

function baselineSnapshot(): Snapshot {
  const token = unsignedJwt({ userId: 1, email: 'owner@example.test' });
  return {
    side: 'baseline',
    sha: 'baseline',
    steps: {
      'auth.login.success': {
        status: 200,
        json: { token },
        cookies: [{ op: 'set', name: 'auth', value: token, options: null }],
      },
      'auth.credentials.success': {
        available: true,
        user: { id: '1', email: 'owner@example.test', name: 'オーナー' },
      },
      'auth.google.unverified': {
        allowed: true,
        assignedUserId: '9',
        cookies: [],
      },
      'auth.google.unverified-existing': {
        allowed: true,
        assignedUserId: '8',
        cookies: [],
      },
    },
    db: {
      columns: {
        users: ['id', 'email', 'password_hash', 'google_id', 'name', 'created_at', 'updated_at', 'account_type'],
      },
      rows: {
        users: [
          user({ id: 1, email: 'owner@example.test', name: 'オーナー' }),
          user({ id: 2, email: 'linked@example.test', name: 'リンク', google_id: 'sub-linked' }),
          user({ id: 3, email: 'already@example.test', name: '既存', password_hash: null, google_id: 'sub-already' }),
          user({ id: 4, email: 'fresh@example.test', name: 'フレッシュ', password_hash: null, google_id: 'sub-fresh' }),
          user({ id: 8, email: 'taken@example.test', name: '先取り', google_id: 'sub-taken' }),
          user({ id: 9, email: 'unverified@example.test', name: '未確認', password_hash: null, google_id: 'sub-unverified' }),
        ],
      },
      indexes: [],
    },
    network: { requests: [], puppeteer: [], sockets: 0, spawns: [] },
  };
}

function candidateSnapshot(): Snapshot {
  const token = unsignedJwt({ userId: 1, email: 'owner@example.test', sessionGeneration: 0 });
  const snapshot = baselineSnapshot();
  snapshot.side = 'candidate';
  snapshot.sha = 'candidate';
  snapshot.db.columns.users = [...snapshot.db.columns.users, 'session_generation'];
  snapshot.db.rows.users = snapshot.db.rows.users
    .filter((row) => row.email !== 'unverified@example.test')
    .map((row) => ({
      ...row,
      session_generation: row.email === 'linked@example.test' ? 1 : 0,
      password_hash: row.email === 'linked@example.test' ? null : row.password_hash,
      google_id: row.email === 'taken@example.test' ? null : row.google_id,
    }));
  const success = snapshot.steps['auth.credentials.success'];
  if (success?.user) success.user = { ...success.user, sessionGeneration: 0 };
  snapshot.steps['auth.login.success'] = {
    status: 200,
    json: { token },
    cookies: [{ op: 'set', name: 'auth', value: token, options: null }],
  };
  snapshot.steps['auth.google.unverified'] = {
    allowed: false,
    assignedUserId: null,
    cookies: [],
  };
  snapshot.steps['auth.google.unverified-existing'] = {
    allowed: false,
    assignedUserId: null,
    cookies: [],
  };
  return snapshot;
}


test('required security behavior remains mandatory after develop already contains it', () => {
  const rules = loadApprovals(approvalsPath.pathname);
  const report = compareSnapshots(candidateSnapshot(), candidateSnapshot(), rules);
  assert.equal(report.ok, true, formatReport(report));
  assert.match(formatReport(report), /維持/);
});

test('identical insecure snapshots still fail each required invariant', () => {
  const mutations: Array<[string, (snapshot: Snapshot) => void]> = [
    ['verified-link-retires-password', (snapshot) => { snapshot.db.rows.users.find((row) => row.email === 'linked@example.test')!.password_hash = HASH; }],
    ['verified-link-retires-password', (snapshot) => { snapshot.db.rows.users.find((row) => row.email === 'linked@example.test')!.session_generation = 0; }],
    ['unverified-existing-rejected', (snapshot) => { snapshot.steps['auth.google.unverified-existing'].allowed = true; }],
    ['unverified-existing-rejected', (snapshot) => { snapshot.db.rows.users.find((row) => row.email === 'taken@example.test')!.google_id = 'sub-taken'; }],
    ['session-generation-column', (snapshot) => { snapshot.db.columns.users = snapshot.db.columns.users.filter((column) => column !== 'session_generation'); }],
    ['session-generation-column', (snapshot) => { delete snapshot.db.rows.users[0].session_generation; }],
    ['credentials-session-generation', (snapshot) => { delete snapshot.steps['auth.credentials.success'].user!.sessionGeneration; }],
    ['session-generation-token', (snapshot) => { snapshot.steps['auth.login.success'].json = { token: unsignedJwt({ userId: 1, email: 'owner@example.test' }) }; }],
    ['session-generation-token', (snapshot) => { snapshot.steps['auth.login.success'].cookies = []; }],
    ['unverified-google-rejected', (snapshot) => { snapshot.steps['auth.google.unverified'].allowed = true; }],
    ['unverified-google-rejected', (snapshot) => { snapshot.db.rows.users.push(user({ id: 9, email: 'unverified@example.test', google_id: 'sub-unverified', session_generation: 0 })); }],
  ];
  const rules = loadApprovals(approvalsPath.pathname);
  for (const [id, mutate] of mutations) {
    const snapshot = candidateSnapshot();
    mutate(snapshot);
    const report = compareSnapshots(snapshot, snapshot, rules);
    assert.equal(report.ok, false, id);
    assert.ok(report.unexpected.some((entry) => entry.path === `approvals.${id}.required`), id);
  }
});
