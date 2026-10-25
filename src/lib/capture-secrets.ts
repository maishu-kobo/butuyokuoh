import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Names only. Values stay in the server process and are never logged. */
export const CAPTURE_SECRET_NAMES = {
  cloudflareAccountId: 'CLOUDFLARE_ACCOUNT_ID',
  cloudflareApiToken: 'CLOUDFLARE_API_TOKEN',
  yahooAppId: 'YAHOO_SHOPPING_APP_ID',
  rakutenAppId: 'RAKUTEN_APP_ID',
  rakutenAccessKey: 'RAKUTEN_ACCESS_KEY',
  rakutenAffiliateId: 'RAKUTEN_AFFILIATE_ID',
  amazonAssociateTag: 'AMAZON_ASSOCIATE_TAG',
} as const;

export const AI_UNAVAILABLE_MESSAGE = '写真からの自動の判定は使えません。商品名を入れて探してください';
export const SEARCH_UNAVAILABLE_MESSAGE = 'この店の検索は使えません。商品名を入れて手入力してください';

const SECRETS_FILE_ENV = 'CAPTURE_SECRETS_FILE';
const MAX_SECRETS_FILE_BYTES = 8192;
const ALLOWED_KEYS = new Set<string>(Object.values(CAPTURE_SECRET_NAMES));

export type CaptureSecrets = {
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
  yahooAppId: string | null;
  rakutenAppId: string | null;
  rakutenAccessKey: string | null;
  rakutenAffiliateId: string | null;
  amazonAssociateTag: string | null;
};

export type ServiceReport = {
  available: boolean;
  fallback: 'manual-entry' | null;
  message: string | null;
};

export type CaptureAvailability = {
  ai: ServiceReport;
  search: { yahoo: ServiceReport; rakuten: ServiceReport };
  secretsFile: 'unused' | 'loaded' | 'rejected';
};

function assertServerOnly() {
  if (typeof globalThis.window !== 'undefined') {
    throw new Error('capture secrets are server-only');
  }
}

function readProcessEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseValue(raw: string): string | null {
  if ((raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
      (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)) {
    const inner = raw.slice(1, -1);
    return inner.length ? inner : null;
  }
  const value = raw.trim();
  return value.length ? value : null;
}

function parseEnvText(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!ALLOWED_KEYS.has(key)) continue;
    const value = parseValue(line.slice(eq + 1));
    if (value) found.set(key, value);
  }
  return found;
}

function isOutsideRepo(filePath: string): boolean {
  const rel = relative(resolve(process.cwd()), resolve(filePath));
  // `relative` は別ドライブのときだけ絶対パスになる。`...` や `..secrets` はリポジトリの中。
  if (rel === '') return false;
  if (isAbsolute(rel)) return true;
  return rel === '..' || rel.startsWith(`..${sep}`);
}

/** Mode 0600 regular file outside the repository. Null means "do not use". */
function readPermittedFile(configuredPath: string): Map<string, string> | null {
  let fd: number | null = null;
  try {
    // パスを調べてから開くと、その間に差し替わる。開いた記述子を fstat する。
    // O_NOFOLLOW はシンボリックリンクを開かず、O_NONBLOCK は fifo を待たない。
    fd = openSync(configuredPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stats = fstatSync(fd);
    if (!stats.isFile()) return null;
    if ((stats.mode & 0o777) !== 0o600) return null;
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) return null;
    if (stats.size > MAX_SECRETS_FILE_BYTES) return null;
    const real = realpathSync(configuredPath);
    if (!isOutsideRepo(real)) return null;
    const realStats = statSync(real);
    if (realStats.dev !== stats.dev || realStats.ino !== stats.ino) return null;
    if (stats.size === 0) return new Map();
    const buf = Buffer.alloc(stats.size);
    const n = readSync(fd, buf, 0, stats.size, 0);
    return parseEnvText(buf.subarray(0, n).toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function loadSecretsFile(): { state: CaptureAvailability['secretsFile']; values: Map<string, string> } {
  const configured = readProcessEnv(SECRETS_FILE_ENV);
  if (!configured) return { state: 'unused', values: new Map() };
  const values = readPermittedFile(configured);
  if (!values) return { state: 'rejected', values: new Map() };
  return { state: 'loaded', values };
}

function load(): { secrets: CaptureSecrets; secretsFile: CaptureAvailability['secretsFile'] } {
  assertServerOnly();
  const file = loadSecretsFile();
  const pick = (name: string) => readProcessEnv(name) ?? file.values.get(name) ?? null;
  return {
    secretsFile: file.state,
    secrets: {
      cloudflareAccountId: pick(CAPTURE_SECRET_NAMES.cloudflareAccountId),
      cloudflareApiToken: pick(CAPTURE_SECRET_NAMES.cloudflareApiToken),
      yahooAppId: pick(CAPTURE_SECRET_NAMES.yahooAppId),
      rakutenAppId: pick(CAPTURE_SECRET_NAMES.rakutenAppId),
      rakutenAccessKey: pick(CAPTURE_SECRET_NAMES.rakutenAccessKey),
      rakutenAffiliateId: pick(CAPTURE_SECRET_NAMES.rakutenAffiliateId),
      amazonAssociateTag: pick(CAPTURE_SECRET_NAMES.amazonAssociateTag),
    },
  };
}

function report(ok: boolean, message: string): ServiceReport {
  return ok
    ? { available: true, fallback: null, message: null }
    : { available: false, fallback: 'manual-entry', message };
}

export function readCaptureSecrets(): CaptureSecrets {
  return load().secrets;
}

export function amazonAssociateTag(): string | null {
  return readCaptureSecrets().amazonAssociateTag;
}

export function captureAvailability(): CaptureAvailability {
  const { secrets, secretsFile } = load();
  return {
    ai: report(Boolean(secrets.cloudflareAccountId && secrets.cloudflareApiToken), AI_UNAVAILABLE_MESSAGE),
    search: {
      yahoo: report(Boolean(secrets.yahooAppId), SEARCH_UNAVAILABLE_MESSAGE),
      rakuten: report(Boolean(secrets.rakutenAppId && secrets.rakutenAccessKey), SEARCH_UNAVAILABLE_MESSAGE),
    },
    secretsFile,
  };
}
