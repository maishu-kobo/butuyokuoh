import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from './db';

const UPLOAD_NAME = /^(\d+)_(\d+)\.(jpg|jpeg|png|webp|gif|avif)$/;
const uploadRoot = path.join(process.cwd(), 'public', 'uploads');

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

// 古い名前 `${会員id}_${時刻}.${拡張子}` を消す。他の会員のファイルは残す。
function deleteLegacyMemberUploads(userId: number): void {
  const root = path.resolve(uploadRoot);
  if (!existsSync(root)) return;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    const match = UPLOAD_NAME.exec(name);
    if (!match || Number(match[1]) !== userId) continue;
    removeUploadEntry(path.resolve(root, name));
  }
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

// 会員行を消す前に、その会員の image_url が指す public/uploads のファイルを消す。
// 他の会員の古い名前、他の会員が指しているファイル、ディレクトリの外は残す。
function deleteReferencedUploads(db: Database.Database, userId: number): void {
  const others = new Set<string>();
  for (const url of imageUrlsFor(db, userId, true)) {
    const full = uploadPathFromStoredUrl(url);
    if (full) others.add(full);
  }
  for (const url of imageUrlsFor(db, userId, false)) {
    const full = uploadPathFromStoredUrl(url);
    if (!full || others.has(full)) continue;
    const legacy = UPLOAD_NAME.exec(path.basename(full));
    if (legacy && Number(legacy[1]) !== userId) continue;
    removeUploadEntry(full);
  }
}

function deleteMemberUploads(db: Database.Database, userId: number): void {
  deleteLegacyMemberUploads(userId);
  deleteReferencedUploads(db, userId);
}

// 会員の行と、その会員に紐づくデータを消す。ゲスト行は消さない。
// 外部キーが無効でも残らないよう、子の行から明示的に消す。
export function deleteMemberAccount(userId: number, db: Database.Database = getDb()): boolean {
  const member = db.prepare(
    "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
  ).get(userId);
  if (!member) return false;
  deleteMemberUploads(db, userId);
  return db.transaction(() => {
    const stillMember = db.prepare(
      "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
    ).get(userId);
    if (!stillMember) return false;
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
    const result = db.prepare(
      "DELETE FROM users WHERE id = ? AND account_type = 'member'",
    ).run(userId);
    return result.changes === 1;
  }).immediate();
}
