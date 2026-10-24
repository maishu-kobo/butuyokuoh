import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from './db';

const UPLOAD_NAME = /^(\d+)_(\d+)\.(jpg|jpeg|png|webp|gif|avif)$/;
// アップロードが付ける名前。32 バイトの十六進なので、会員 id は名前に入らない。
const STORED_UPLOAD_NAME = /^[0-9a-f]{64}\.(jpg|jpeg|png|webp|gif|avif)$/;
const uploadRoot = path.join(process.cwd(), 'public', 'uploads');

// アップロードに成功した十六進ファイルを、その会員の所有として記録する。
export function rememberMemberUpload(userId: number, name: string, database: Database.Database = getDb()): void {
  if (!STORED_UPLOAD_NAME.test(name)) {
    throw new Error('invalid upload name');
  }
  database.prepare('INSERT INTO member_uploads (name, user_id) VALUES (?, ?)').run(name, userId);
}

// リンク自体だけを外す。参照先は消さない。ディレクトリと、ディレクトリの外は触らない。
function removeUploadEntry(full: string): void {
  const root = path.resolve(uploadRoot);
  if (path.dirname(full) !== root) return;
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return;
  }
  if (stat.isSymbolicLink() || stat.isFile()) unlinkSync(full);
}

// 古い名前 `${会員id}_${時刻}.${拡張子}` のパス。他の会員のファイルは含めない。
function legacyUploadPaths(userId: number): string[] {
  const root = path.resolve(uploadRoot);
  if (!existsSync(root)) return [];
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const name of names) {
    const match = UPLOAD_NAME.exec(name);
    if (!match || Number(match[1]) !== userId) continue;
    const full = path.resolve(root, name);
    if (path.dirname(full) !== root) continue;
    paths.push(full);
  }
  return paths;
}

// 保存された URL が public/uploads の直下のファイルを指すときだけ、そのパスを返す。
function uploadPathFromStoredUrl(url: string): string | null {
  let pathname = url;
  if (url.startsWith('/')) {
    const cut = url.search(/[?#]/);
    pathname = cut === -1 ? url : url.slice(0, cut);
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) return null;
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const match = /^\/uploads\/([^/]+)$/.exec(decoded);
  if (!match) return null;
  const name = match[1];
  if (!name || name === '.' || name === '..' || name.includes('\0')) return null;
  const root = path.resolve(uploadRoot);
  const full = path.resolve(root, name);
  if (path.dirname(full) !== root) return null;
  return full;
}

function imageUrlsFor(db: Database.Database, userId: number, others: boolean): string[] {
  const compare = others ? '!=' : '=';
  const rows = db.prepare(
    `SELECT image_url AS url FROM items WHERE user_id ${compare} ? AND typeof(image_url) = 'text'
     UNION
     SELECT image_url AS url FROM capture_candidates WHERE user_id ${compare} ? AND typeof(image_url) = 'text'`,
  ).all(userId, userId) as { url: string }[];
  return rows.map((row) => row.url);
}

// 記録された十六進名が public/uploads の直下を指すときだけ、そのパスを返す。
// 名前が十六進でないもの、.. や区切りを含むものは所有者不明として扱わない。
function uploadPathFromOwnedName(name: string): string | null {
  if (!STORED_UPLOAD_NAME.test(name)) return null;
  const root = path.resolve(uploadRoot);
  const full = path.resolve(root, name);
  if (path.dirname(full) !== root) return null;
  return full;
}

function ownedNames(db: Database.Database, userId: number, others: boolean): string[] {
  const compare = others ? '!=' : '=';
  const rows = db.prepare(
    `SELECT name FROM member_uploads WHERE user_id ${compare} ? AND typeof(name) = 'text'`,
  ).all(userId) as { name: string }[];
  return rows.map((row) => row.name);
}

// 他の会員が参照しているファイルと、他の会員の所有記録にあるファイル。
function reservedUploadPaths(db: Database.Database, userId: number): Set<string> {
  const reserved = new Set<string>();
  for (const url of imageUrlsFor(db, userId, true)) {
    const full = uploadPathFromStoredUrl(url);
    if (full) reserved.add(full);
  }
  for (const name of ownedNames(db, userId, true)) {
    const full = uploadPathFromOwnedName(name);
    if (full) reserved.add(full);
  }
  return reserved;
}

// 退会が commit したあとに消すパス。ここでは消さない。
// 十六進は、その会員の image_url か所有記録からだけ消す。参照も記録も無い十六進はディレクトリを走査して消さない。
function uploadPathsForWithdrawal(db: Database.Database, userId: number): string[] {
  const reserved = reservedUploadPaths(db, userId);
  const planned = new Set<string>(legacyUploadPaths(userId));
  for (const name of ownedNames(db, userId, false)) {
    const full = uploadPathFromOwnedName(name);
    if (!full || reserved.has(full)) continue;
    planned.add(full);
  }
  for (const url of imageUrlsFor(db, userId, false)) {
    const full = uploadPathFromStoredUrl(url);
    if (!full || reserved.has(full)) continue;
    const legacy = UPLOAD_NAME.exec(path.basename(full));
    if (legacy && Number(legacy[1]) !== userId) continue;
    planned.add(full);
  }
  return [...planned];
}

// 失敗しても退会自体は戻さない。ログして次のファイルへ進む。
function removeUploadsBestEffort(paths: string[]): void {
  for (const full of paths) {
    try {
      removeUploadEntry(full);
    } catch (error) {
      console.error('退会後のアップロード削除に失敗しました', error);
    }
  }
}

// 会員の行と、その会員に紐づくデータを消す。ゲスト行は消さない。
// 外部キーが無効でも残らないよう、子の行から明示的に消す。
export function deleteMemberAccount(userId: number, db: Database.Database = getDb()): boolean {
  const member = db.prepare(
    "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
  ).get(userId);
  if (!member) return false;
  let paths: string[] = [];
  const committed = db.transaction(() => {
    const stillMember = db.prepare(
      "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
    ).get(userId);
    if (!stillMember) return false;
    paths = uploadPathsForWithdrawal(db, userId);
    db.prepare('DELETE FROM capture_candidates WHERE user_id = ?').run(userId);
    db.prepare(
      'DELETE FROM price_history WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)',
    ).run(userId);
    db.prepare(
      'DELETE FROM notification_settings WHERE item_id IN (SELECT id FROM items WHERE user_id = ?)',
    ).run(userId);
    db.prepare('DELETE FROM items WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM captures WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM comparison_groups WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM categories WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_notification_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM guest_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM guest_rate_limits WHERE bucket IN (?, ?)').run(`write:${userId}`, `scrape:${userId}`);
    db.prepare('DELETE FROM capture_ai_usage WHERE user_key = ?').run(String(userId));
    db.prepare('DELETE FROM member_uploads WHERE user_id = ?').run(userId);
    const result = db.prepare(
      "DELETE FROM users WHERE id = ? AND account_type = 'member'",
    ).run(userId);
    return result.changes === 1;
  }).immediate();
  if (!committed) return false;
  removeUploadsBestEffort(paths);
  return true;
}
