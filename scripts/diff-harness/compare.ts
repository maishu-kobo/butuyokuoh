import { readFileSync } from 'node:fs';

type Row = Record<string, unknown>;

export type Step = {
  status?: number;
  json?: unknown;
  text?: string;
  cacheControl?: string | null;
  cookies?: unknown;
  threw?: string;
  skipped?: boolean;
  allowed?: boolean | string | null;
  assignedUserId?: string | null;
  available?: boolean;
  user?: { id?: string | null; email?: string | null; name?: string | null; sessionGeneration?: number } | null;
};

export type Snapshot = {
  side: string;
  sha: string;
  steps: Record<string, Step>;
  db: {
    columns: Record<string, string[]>;
    rows: Record<string, Row[]>;
    indexes: { name: string; table: string; sql: string | null }[];
  };
  network: {
    requests: string[];
    puppeteer: string[];
    sockets: number;
    spawns: string[];
  };
};

type ColumnRule = { table: string; column: string; value: unknown };
type FieldRule = { field: string; equals: unknown };
type RejectedUrl = { step: string; url: string; status: number; error: string };
type PasswordRetired = { email: string; generation: number };
type RejectedUnverifiedGoogle = { step: string; email: string; googleId: string };
type RejectedUnverifiedExisting = { step: string; email: string; googleId: string };
type CredentialsGeneration = { step: string; generation: number };
type ChangeRule = {
  id: string;
  reason: string;
  required?: boolean;
  tablesAdded?: string[];
  requireEmpty?: boolean;
  columnsAdded?: ColumnRule[];
  indexesAdded?: string[];
  responseFieldsAdded?: FieldRule[];
  rejectedUrls?: RejectedUrl[];
  passwordRetired?: PasswordRetired[];
  rejectedUnverifiedGoogle?: RejectedUnverifiedGoogle[];
  rejectedUnverifiedExisting?: RejectedUnverifiedExisting[];
  credentialsGeneration?: CredentialsGeneration[];
};

export type Approval = {
  id: string;
  reason: string;
  applied: number;
  retained?: boolean;
  detail: string;
};

export type Difference = {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  baseline?: unknown;
  candidate?: unknown;
};

export type Report = {
  ok: boolean;
  baselineSha: string;
  candidateSha: string;
  approvals: Approval[];
  unexpected: Difference[];
};

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ID_FIELDS = new Set([
  'id', 'user_id', 'item_id', 'userId', 'assignedUserId',
  'category_id', 'comparison_group_id', 'budget_item_id', 'capture_id',
]);

export function loadApprovals(file: string): ChangeRule[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { changes: ChangeRule[] };
  return parsed.changes;
}

export function compareSnapshots(baseline: Snapshot, candidate: Snapshot, rules: ChangeRule[]): Report {
  const left = normalize(structuredClone(baseline));
  const right = normalize(structuredClone(candidate));
  // 承認適用はスナップショットを加工するため、不変条件は加工前に検査する。
  const retained = new Set(rules.filter((rule) => rule.required
    && requiredBehaviorPresent(left, rule, rules)
    && requiredBehaviorPresent(right, rule, rules)).map((rule) => rule.id));
  const validCandidate = new Set(rules.filter((rule) => rule.required
    && requiredBehaviorPresent(right, rule, rules)).map((rule) => rule.id));
  const approvals = applyApprovals(left, right, rules);
  const unexpected: Difference[] = [];
  collect(left, right, '', unexpected);
  for (const approval of approvals) {
    const rule = rules.find((item) => item.id === approval.id);
    if (!rule?.required) continue;
    if (validCandidate.has(rule.id) && approval.applied > 0) continue;
    if (retained.has(rule.id)) {
      approval.retained = true;
      approval.detail = 'baseline と candidate の両方で必須の安全な動作を確認した';
      continue;
    }
    unexpected.push({
      path: `approvals.${approval.id}.required`,
      kind: 'removed',
      baseline: '必須の安全な動作が候補で確認できる必要がある',
    });
  }
  const noise = new Set(['side', 'sha']);
  return {
    ok: unexpected.filter((entry) => !noise.has(entry.path)).length === 0,
    baselineSha: baseline.sha,
    candidateSha: candidate.sha,
    approvals,
    unexpected: unexpected.filter((entry) => !noise.has(entry.path)),
  };
}

export function formatReport(report: Report): string {
  const lines = [
    report.ok ? '差分: 合格' : '差分: 不合格',
    `baseline (origin/develop): ${report.baselineSha}`,
    `candidate (HEAD): ${report.candidateSha}`,
    '',
    `承認 ${report.approvals.length} 件`,
  ];
  for (const approval of report.approvals) {
    lines.push(`- [${approval.applied > 0 ? '適用' : approval.retained ? '維持' : '該当なし'}] ${approval.id} (${approval.applied})`);
    lines.push(`  理由: ${approval.reason}`);
    lines.push(`  内容: ${approval.detail}`);
  }
  lines.push('', `想定外 ${report.unexpected.length} 件`);
  if (report.unexpected.length === 0) {
    lines.push('- なし');
  }
  report.unexpected.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.path} [${entry.kind}]`);
    if (entry.kind !== 'added') lines.push(`  baseline: ${show(entry.baseline)}`);
    if (entry.kind !== 'removed') lines.push(`  candidate: ${show(entry.candidate)}`);
  });
  return lines.join('\n');
}

// required は差分の有無ではなく、driver の固定シナリオの結果を保証する。
// 未対応の必須ルールは通さない。追加時はその不変条件と回帰テストも追加する。
function requiredBehaviorPresent(snapshot: Snapshot, rule: ChangeRule, rules: ChangeRule[]): boolean {
  const users = snapshot.db.rows.users || [];
  const rejected = (step: string) => snapshot.steps[step]?.allowed === false
    && snapshot.steps[step]?.assignedUserId === null;
  switch (rule.id) {
    case 'verified-link-retires-password':
      return Boolean(rule.passwordRetired?.length) && rule.passwordRetired!.every((entry) => {
        const user = onlyUser(users, entry.email);
        return user?.password_hash === null && user.session_generation === entry.generation;
      });
    case 'unverified-existing-rejected':
      return Boolean(rule.rejectedUnverifiedExisting?.length) && rule.rejectedUnverifiedExisting!.every((entry) => {
        const user = onlyUser(users, entry.email);
        return rejected(entry.step) && user?.google_id === null
          && user.password_hash === PASSWORD_HASH && user.session_generation === 0;
      });
    case 'session-generation-column': {
      const retired = rules.flatMap((entry) => entry.passwordRetired || []);
      return Boolean(rule.columnsAdded?.length) && rule.columnsAdded!.every((entry) =>
        entry.table === 'users' && entry.column === 'session_generation'
        && snapshot.db.columns.users?.includes(entry.column) && users.length > 0
        && users.every((user) => user[entry.column] ===
          (retired.find((linked) => linked.email === user.email)?.generation ?? entry.value)));
    }
    case 'credentials-session-generation':
      return Boolean(rule.credentialsGeneration?.length) && rule.credentialsGeneration!.every((entry) => {
        const step = snapshot.steps[entry.step];
        return step?.available === true && step.user?.sessionGeneration === entry.generation;
      });
    case 'session-generation-token': {
      const step = snapshot.steps['auth.login.success'];
      const token = isPlain(step?.json) ? step.json.token : null;
      const cookies = Array.isArray(step?.cookies)
        ? step.cookies.filter((cookie) => isPlain(cookie) && cookie.op === 'set' && cookie.name === 'auth') : [];
      return step?.status === 200 && isPlain(token) && cookies.length === 1
        && isPlain(cookies[0].value) && Boolean(rule.responseFieldsAdded?.length)
        && rule.responseFieldsAdded!.every((field) => same(token[field.field], field.equals)
          && same(cookies[0].value[field.field], field.equals));
    }
    case 'unverified-google-rejected':
      return Boolean(rule.rejectedUnverifiedGoogle?.length) && rule.rejectedUnverifiedGoogle!.every((entry) =>
        rejected(entry.step) && !users.some((user) => user.email === entry.email || user.google_id === entry.googleId));
    default:
      return false;
  }
}

function normalize(snapshot: Snapshot): Snapshot {
  rewriteJwt(snapshot);
  const users = new Map<number, string>();
  for (const row of snapshot.db.rows.users || []) {
    users.set(Number(row.id), `user:${String(row.email)}`);
  }
  const items = new Map<number, string>();
  for (const row of snapshot.db.rows.items || []) {
    items.set(Number(row.id), `item:${String(row.url)}`);
  }
  if (snapshot.db.rows.price_history) {
    snapshot.db.rows.price_history = sequenceHistory(snapshot.db.rows.price_history);
  }
  snapshot.db.rows = mapValues(snapshot.db.rows, (rows) => rows.map((row) => rewriteIds(row, users, items) as Row));
  snapshot.steps = rewriteIds(snapshot.steps, users, items) as Snapshot['steps'];
  replaceScalars(snapshot);
  for (const [table, rows] of Object.entries(snapshot.db.rows)) {
    snapshot.db.rows[table] = rows.sort((a, b) => stable(sortKey(table, a)).localeCompare(stable(sortKey(table, b))));
  }
  for (const [table, columns] of Object.entries(snapshot.db.columns)) {
    snapshot.db.columns[table] = [...columns].sort();
  }
  snapshot.db.indexes = snapshot.db.indexes
    .map((index) => ({ ...index, sql: index.sql ? index.sql.replace(/\s+/g, ' ').trim() : null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.table.localeCompare(b.table));
  return snapshot;
}

function sequenceHistory(rows: Row[]): Row[] {
  const ordered = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  const counts = new Map<number, number>();
  return ordered.map((row) => {
    const itemId = Number(row.item_id);
    const sequence = counts.get(itemId) ?? 0;
    counts.set(itemId, sequence + 1);
    return { ...row, sequence };
  });
}

function sortKey(table: string, row: Row): unknown[] {
  if (table === 'users') return [row.email, row.google_id];
  if (table === 'items') return [row.url];
  if (table === 'price_history') return [row.item_id, row.sequence, row.price];
  return [row.email, row.name, row.url, row.id];
}

function rewriteIds(value: unknown, users: Map<number, string>, items: Map<number, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => rewriteIds(entry, users, items));
  if (!isPlain(value)) return value;
  const next: Row = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    next[key] = ID_FIELDS.has(key) ? labelFor(key, child, value, users, items) : rewriteIds(child, users, items);
  }
  if ('sequence' in value && 'item_id' in value) delete next.id;
  return next;
}

function labelFor(
  field: string,
  value: unknown,
  parent: Row,
  users: Map<number, string>,
  items: Map<number, string>,
): unknown {
  const id = asId(value);
  if (id === null) return value;
  if (field === 'user_id' || field === 'userId' || field === 'assignedUserId') return users.get(id) ?? value;
  if (field === 'item_id') return items.get(id) ?? value;
  if (field === 'id' && 'url' in parent) return items.get(id) ?? value;
  if (field === 'id' && 'email' in parent) return users.get(id) ?? value;
  return value;
}

function asId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function rewriteJwt(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const decoded = typeof entry === 'string' ? decodeJwt(entry) : null;
      if (decoded) value[index] = decoded;
      else rewriteJwt(entry);
    });
    return;
  }
  if (!isPlain(value)) return;
  for (const key of Object.keys(value)) {
    const child = value[key];
    const decoded = typeof child === 'string' ? decodeJwt(child) : null;
    if (decoded) value[key] = decoded;
    else rewriteJwt(child);
  }
}

function decodeJwt(token: string): Row | null {
  if (!JWT.test(token)) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Row;
    delete payload.iat;
    delete payload.exp;
    return payload;
  } catch {
    return null;
  }
}

function replaceScalars(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === 'string') value[index] = scalar(entry);
      else replaceScalars(entry);
    });
    return;
  }
  if (!isPlain(value)) return;
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (typeof child === 'string') value[key] = scalar(child);
    else replaceScalars(child);
  }
}

function scalar(value: string): string {
  if (TIMESTAMP.test(value)) return '<timestamp>';
  if (BCRYPT.test(value)) return '<password-hash>';
  return value;
}

function applyApprovals(baseline: Snapshot, candidate: Snapshot, rules: ChangeRule[]): Approval[] {
  return rules.map((rule) => {
    let applied = 0;
    const details: string[] = [];
    for (const table of rule.tablesAdded || []) {
      const rows = candidate.db.rows[table];
      if (rows && !(table in baseline.db.rows) && (!rule.requireEmpty || rows.length === 0)) {
        delete candidate.db.rows[table];
        delete candidate.db.columns[table];
        applied += 1;
        details.push(`table ${table}`);
      }
    }
    // 列を消す前に、先取り会員の世代が 0 のままかを見る。トークン全体を消す前に Credentials の世代を見る。
    applied += approvePasswordRetired(baseline, candidate, rule.passwordRetired || [], details);
    applied += approveRejectedUnverifiedExisting(baseline, candidate, rule.rejectedUnverifiedExisting || [], details);
    applied += approveCredentialsGeneration(baseline, candidate, rule.credentialsGeneration || [], details);
    for (const column of rule.columnsAdded || []) {
      const baseColumns = new Set(baseline.db.columns[column.table] || []);
      const candidateColumns = candidate.db.columns[column.table];
      const rows = candidate.db.rows[column.table] || [];
      if (!candidateColumns || baseColumns.has(column.column) || !candidateColumns.includes(column.column)) continue;
      if (rows.some((row) => !same(row[column.column], column.value))) continue;
      for (const row of rows) delete row[column.column];
      candidate.db.columns[column.table] = candidateColumns.filter((name) => name !== column.column);
      applied += 1;
      details.push(`${column.table}.${column.column}`);
    }
    const baselineIndexes = new Set(baseline.db.indexes.map((index) => index.name));
    const approvedIndexes = new Set(rule.indexesAdded || []);
    candidate.db.indexes = candidate.db.indexes.filter((index) => {
      if (approvedIndexes.has(index.name) && !baselineIndexes.has(index.name)) {
        applied += 1;
        details.push(`index ${index.name}`);
        return false;
      }
      return true;
    });
    applied += stripFields(baseline, candidate, rule.responseFieldsAdded || [], details);
    applied += approveRejectedUrls(baseline, candidate, rule.rejectedUrls || [], details);
    applied += approveRejectedUnverifiedGoogle(baseline, candidate, rule.rejectedUnverifiedGoogle || [], details);
    return {
      id: rule.id,
      reason: rule.reason,
      applied,
      detail: details.length ? details.join(', ') : '差分に現れなかった',
    };
  });
}

const PASSWORD_HASH = '<password-hash>';

function approvePasswordRetired(baseline: Snapshot, candidate: Snapshot, rules: PasswordRetired[], details: string[]): number {
  let applied = 0;
  for (const rule of rules) {
    const base = onlyUser(baseline.db.rows.users || [], rule.email);
    const cand = onlyUser(candidate.db.rows.users || [], rule.email);
    if (!base || !cand) continue;
    if (base.password_hash !== PASSWORD_HASH || cand.password_hash !== null) continue;
    if (cand.session_generation !== rule.generation) continue;
    if (!sameExcept(base, cand, ['password_hash', 'session_generation'])) continue;
    cand.password_hash = base.password_hash;
    cand.session_generation = 0;
    applied += 1;
    details.push(rule.email);
  }
  return applied;
}

function approveRejectedUnverifiedExisting(
  baseline: Snapshot,
  candidate: Snapshot,
  rules: RejectedUnverifiedExisting[],
  details: string[],
): number {
  let applied = 0;
  for (const rule of rules) {
    const baseStep = baseline.steps[rule.step];
    const candStep = candidate.steps[rule.step];
    if (!baseStep || !candStep) continue;
    if (baseStep.allowed !== true || candStep.allowed !== false || candStep.assignedUserId != null) continue;
    if (baseStep.assignedUserId !== `user:${rule.email}`) continue;
    const base = onlyUser(baseline.db.rows.users || [], rule.email);
    const cand = onlyUser(candidate.db.rows.users || [], rule.email);
    if (!base || !cand) continue;
    if (cand.google_id !== null || base.google_id !== rule.googleId) continue;
    if (base.password_hash !== PASSWORD_HASH || cand.password_hash !== PASSWORD_HASH) continue;
    if (cand.session_generation !== 0) continue;
    if (!sameExcept(base, cand, ['google_id', 'session_generation'])) continue;
    base.google_id = null;
    baseStep.allowed = false;
    baseStep.assignedUserId = null;
    applied += 1;
    details.push(rule.email);
  }
  return applied;
}

function approveCredentialsGeneration(
  baseline: Snapshot,
  candidate: Snapshot,
  rules: CredentialsGeneration[],
  details: string[],
): number {
  let applied = 0;
  for (const rule of rules) {
    const baseStep = baseline.steps[rule.step];
    const candStep = candidate.steps[rule.step];
    if (!baseStep || !candStep || baseStep.available !== true || candStep.available !== true) continue;
    if (!isPlain(baseStep.user) || !isPlain(candStep.user)) continue;
    if ('sessionGeneration' in baseStep.user || candStep.user.sessionGeneration !== rule.generation) continue;
    if (!sameExcept(baseStep.user, candStep.user, ['sessionGeneration'])) continue;
    delete candStep.user.sessionGeneration;
    applied += 1;
    details.push(rule.step);
  }
  return applied;
}

function approveRejectedUnverifiedGoogle(
  baseline: Snapshot,
  candidate: Snapshot,
  rules: RejectedUnverifiedGoogle[],
  details: string[],
): number {
  let applied = 0;
  for (const rule of rules) {
    const baseStep = baseline.steps[rule.step];
    const candStep = candidate.steps[rule.step];
    if (!baseStep || !candStep) continue;
    if (baseStep.allowed !== true || candStep.allowed !== false || candStep.assignedUserId != null) continue;
    const baseUsers = baseline.db.rows.users || [];
    const candUsers = candidate.db.rows.users || [];
    const created = onlyUser(baseUsers, rule.email);
    if (!created || created.google_id !== rule.googleId || created.password_hash != null) continue;
    if (candUsers.some((row) => row.email === rule.email || row.google_id === rule.googleId)) continue;
    if (baseStep.assignedUserId !== `user:${rule.email}`) continue;
    baseline.db.rows.users = baseUsers.filter((row) => row.email !== rule.email);
    baseStep.allowed = false;
    baseStep.assignedUserId = null;
    applied += 1;
    details.push(rule.email);
  }
  return applied;
}

function onlyUser(rows: Row[], email: string): Row | undefined {
  const matches = rows.filter((row) => row.email === email);
  return matches.length === 1 ? matches[0] : undefined;
}

function sameExcept(left: Row, right: Row, ignore: string[]): boolean {
  const skip = new Set(ignore);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    if (!same(left[key], right[key])) return false;
  }
  return true;
}

function approveRejectedUrls(baseline: Snapshot, candidate: Snapshot, rules: RejectedUrl[], details: string[]): number {
  let applied = 0;
  for (const rule of rules) {
    const baseStep = baseline.steps[rule.step];
    const candStep = candidate.steps[rule.step];
    const baseRow = (baseline.db.rows.items || []).find((row) => row.url === rule.url);
    const candRow = (candidate.db.rows.items || []).some((row) => row.url === rule.url);
    const stored = Boolean(
      baseStep
      && baseRow
      && baseStep.status === 201
      && isPlain(baseStep.json)
      && baseStep.json.url === rule.url,
    );
    const rejected = Boolean(
      candStep
      && !candRow
      && candStep.status === rule.status
      && exactError(candStep.json, rule.error)
      && !objectWithUrl(candidate.steps, rule.url),
    );
    if (!stored || !rejected || !baseStep || !candStep) continue;
    baseline.db.rows.items = (baseline.db.rows.items || []).filter((row) => row.url !== rule.url);
    const historyId = `item:${rule.url}`;
    if (baseline.db.rows.price_history) {
      baseline.db.rows.price_history = baseline.db.rows.price_history.filter((row) => row.item_id !== historyId);
    }
    dropUrl(baseline.steps, rule.url);
    baseStep.status = candStep.status;
    baseStep.json = structuredClone(candStep.json);
    applied += 1;
    details.push(rule.url);
  }
  return applied;
}

function exactError(value: unknown, error: string): boolean {
  return isPlain(value) && Object.keys(value).length === 1 && value.error === error;
}

function objectWithUrl(value: unknown, url: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => objectWithUrl(entry, url));
  if (!isPlain(value)) return false;
  if (value.url === url) return true;
  return Object.values(value).some((entry) => objectWithUrl(entry, url));
}

function dropUrl(value: unknown, url: string): void {
  if (Array.isArray(value)) {
    const kept = value.filter((entry) => !(isPlain(entry) && entry.url === url));
    if (kept.length !== value.length) {
      value.splice(0, value.length, ...kept);
    }
    for (const entry of value) dropUrl(entry, url);
    return;
  }
  if (!isPlain(value)) return;
  for (const entry of Object.values(value)) dropUrl(entry, url);
}

function stripFields(baseline: unknown, candidate: unknown, rules: FieldRule[], details: string[]): number {
  if (!rules.length) return 0;
  let applied = 0;
  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    const count = Math.min(baseline.length, candidate.length);
    for (let index = 0; index < count; index += 1) {
      applied += stripFields(baseline[index], candidate[index], rules, details);
    }
    return applied;
  }
  if (!isPlain(baseline) || !isPlain(candidate)) return 0;
  for (const rule of rules) {
    if (!(rule.field in baseline) && rule.field in candidate && same(candidate[rule.field], rule.equals)) {
      delete candidate[rule.field];
      applied += 1;
      if (!details.includes(rule.field)) details.push(rule.field);
    }
  }
  for (const key of Object.keys(candidate)) {
    if (key in baseline) applied += stripFields(baseline[key], candidate[key], rules, details);
  }
  return applied;
}

function collect(baseline: unknown, candidate: unknown, pathName: string, out: Difference[]) {
  if (stable(baseline) === stable(candidate)) return;
  if (isPlain(baseline) && isPlain(candidate)) {
    const keys = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])];
    const sameCount = keys.filter((key) => key in baseline && key in candidate && stable(baseline[key]) === stable(candidate[key])).length;
    const responseBody = pathName.endsWith('.json') || pathName.includes('.json.');
    if (responseBody && keys.length > 4 && sameCount / keys.length < 0.5) {
      out.push({ path: pathName, kind: 'changed', baseline, candidate });
      return;
    }
    for (const key of [...keys].sort()) {
      const next = pathName ? `${pathName}.${key}` : key;
      if (!(key in baseline)) out.push({ path: next, kind: 'added', candidate: candidate[key] });
      else if (!(key in candidate)) out.push({ path: next, kind: 'removed', baseline: baseline[key] });
      else collect(baseline[key], candidate[key], next, out);
    }
    return;
  }
  if (Array.isArray(baseline) && Array.isArray(candidate) && alignByKey(baseline, candidate, pathName, out)) return;
  if (Array.isArray(baseline) && Array.isArray(candidate)) {
    const count = Math.max(baseline.length, candidate.length);
    for (let index = 0; index < count; index += 1) {
      const next = `${pathName}[${index}]`;
      if (index >= baseline.length) out.push({ path: next, kind: 'added', candidate: candidate[index] });
      else if (index >= candidate.length) out.push({ path: next, kind: 'removed', baseline: baseline[index] });
      else collect(baseline[index], candidate[index], next, out);
    }
    return;
  }
  out.push({ path: pathName || '(root)', kind: 'changed', baseline, candidate });
}

function alignByKey(baseline: unknown[], candidate: unknown[], pathName: string, out: Difference[]): boolean {
  const baseKeys = baseline.map(rowKey);
  const candidateKeys = candidate.map(rowKey);
  if (baseKeys.some((key) => !key) || candidateKeys.some((key) => !key)) return false;
  const baseBy = new Map(baseline.map((row, index) => [baseKeys[index] as string, row]));
  const candidateBy = new Map(candidate.map((row, index) => [candidateKeys[index] as string, row]));
  for (const key of [...new Set([...baseKeys, ...candidateKeys])].sort()) {
    const label = key as string;
    const next = `${pathName}[${label}]`;
    if (!candidateBy.has(label)) out.push({ path: next, kind: 'removed', baseline: baseBy.get(label) });
    else if (!baseBy.has(label)) out.push({ path: next, kind: 'added', candidate: candidateBy.get(label) });
    else collect(baseBy.get(label), candidateBy.get(label), next, out);
  }
  const shared = baseKeys.filter((key) => candidateBy.has(key as string));
  const candidateShared = candidateKeys.filter((key) => baseBy.has(key as string));
  if (shared.join('\n') !== candidateShared.join('\n')) {
    out.push({ path: `${pathName}.order`, kind: 'changed', baseline: shared, candidate: candidateShared });
  }
  return true;
}

function rowKey(value: unknown): string | null {
  if (!isPlain(value) || typeof value.url !== 'string') return null;
  return `url:${value.url}`;
}

function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

function stable(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlain(value)) return value;
  const next: Row = {};
  for (const key of Object.keys(value).sort()) next[key] = sortKeys(value[key]);
  return next;
}

function isPlain(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mapValues<T>(record: Record<string, T>, map: (value: T) => T): Record<string, T> {
  const next: Record<string, T> = {};
  for (const key of Object.keys(record)) next[key] = map(record[key]);
  return next;
}

function show(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  return text.length > 2000 ? `${text.slice(0, 2000)}\n…` : text;
}
