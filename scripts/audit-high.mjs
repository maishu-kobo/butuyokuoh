/**
 * npm audit の high / critical を見る。
 * 例外は .github/audit-exceptions.json の name、GHSA、理由、期限がそろい、
 * 開発依存だけだと確認できたものに限る。期限切れ、説明のない例外、本番に届く例外は落とす。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCEPTION_PATH = join(root, '.github', 'audit-exceptions.json');
const GHSA = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i;
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const BLOCKING = new Set(['high', 'critical']);

export function ghsaOf(url) {
  if (typeof url !== 'string') return null;
  const id = url.split('/').filter(Boolean).pop() || '';
  return GHSA.test(id) ? id.toUpperCase() : null;
}

export function highAdvisories(report) {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') return [];
  const found = [];
  for (const vulnerability of Object.values(vulnerabilities)) {
    if (!vulnerability || typeof vulnerability !== 'object') continue;
    for (const via of vulnerability.via || []) {
      if (!via || typeof via !== 'object') continue;
      const severity = String(via.severity || vulnerability.severity || '').toLowerCase();
      if (!BLOCKING.has(severity)) continue;
      found.push({
        name: String(via.name || vulnerability.name || ''),
        ghsa: ghsaOf(via.url),
        severity,
        url: typeof via.url === 'string' ? via.url : '',
      });
    }
  }
  return found;
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function loadExceptions(path) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).join() !== 'exceptions') {
    throw new Error('監査例外は exceptions だけを持つ');
  }
  if (!Array.isArray(data.exceptions)) throw new Error('exceptions は配列');
  return data.exceptions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('例外の形が違う');
    const keys = Object.keys(entry).sort().join();
    if (keys !== 'devOnly,expires,ghsa,name,reason') {
      throw new Error('例外には name、ghsa、devOnly、expires、reason が要る');
    }
    const { name, ghsa, devOnly, expires, reason } = entry;
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) throw new Error(`例外の name が不正: ${name}`);
    if (typeof ghsa !== 'string' || !GHSA.test(ghsa)) throw new Error(`例外の ghsa が不正: ${ghsa}`);
    if (devOnly !== true) throw new Error(`${name} の例外は開発依存だけに限る`);
    if (typeof expires !== 'string' || !isRealDate(expires)) throw new Error(`${name} の期限が日付ではない`);
    if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`${name} の例外に理由が無い`);
    return { name, ghsa: ghsa.toUpperCase(), devOnly, expires, reason };
  });
}

export function evaluateAudit(report, exceptions, today) {
  const findings = highAdvisories(report);
  const errors = [];
  for (const finding of findings) {
    const match = exceptions.find((entry) => entry.name === finding.name && entry.ghsa === finding.ghsa);
    if (!match) {
      const id = finding.ghsa || finding.url || 'GHSA 不明';
      errors.push(`例外の無い ${finding.severity}: ${finding.name} ${id}`);
      continue;
    }
    if (today >= match.expires) {
      errors.push(`期限切れの例外: ${match.name} ${match.ghsa} (${match.expires})`);
    }
  }
  for (const entry of exceptions) {
    const live = findings.some((finding) => finding.name === entry.name && finding.ghsa === entry.ghsa);
    if (!live) errors.push(`もう出ていない例外: ${entry.name} ${entry.ghsa}`);
  }
  return errors;
}

function npm(args) {
  return spawnSync('npm', args, { cwd: root, encoding: 'utf8' });
}

function assertDevOnly(name) {
  const listed = npm(['ls', name, '--omit=dev', '--parseable']);
  const lines = `${listed.stdout || ''}`.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0) {
    throw new Error(`${name} は本番の依存木にある。開発依存の例外では通せない`);
  }
}

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function main() {
  const exceptions = loadExceptions(EXCEPTION_PATH);
  for (const entry of exceptions) assertDevOnly(entry.name);
  const audit = npm(['audit', '--json']);
  let report;
  try {
    report = JSON.parse(audit.stdout || '');
  } catch {
    process.stderr.write(audit.stderr || '');
    process.stderr.write('npm audit の JSON を読めない\n');
    return 1;
  }
  const today = todayUtc();
  const errors = evaluateAudit(report, exceptions, today);
  const findings = highAdvisories(report);
  for (const entry of exceptions) {
    const live = findings.some((finding) => finding.name === entry.name && finding.ghsa === entry.ghsa);
    if (live) process.stdout.write(`例外: ${entry.name} ${entry.ghsa} 期限 ${entry.expires}（開発依存のみ）\n${entry.reason}\n`);
  }
  if (errors.length > 0) {
    process.stderr.write(errors.join('\n') + '\n');
    return 1;
  }
  process.stdout.write('high / critical で例外以外は 0 件\n');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(main());
