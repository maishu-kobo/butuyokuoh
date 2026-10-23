import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from './db';

const UPLOAD_NAME = /^(\d+)_(\d+)\.(jpg|jpeg|png|webp|gif|avif)$/;
const uploadRoot = path.join(process.cwd(), 'public', 'uploads');

// アップロードは `${会員id}_${時刻}.${拡張子}` だけを消す。ディレクトリの外や、他の会員のファイルは触らない。
function deleteMemberUploads(userId: number): void {
  const root = uploadRoot;
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
    const full = path.resolve(root, name);
    if (path.dirname(full) !== root) continue;
    const stat = lstatSync(full);
    // リンク自体だけを外す。参照先は消さない。ディレクトリは触らない。
    if (stat.isSymbolicLink()) {
      unlinkSync(full);
      continue;
    }
    if (!stat.isFile()) continue;
    unlinkSync(full);
  }
}

// 会員の行と、その会員に紐づくデータを消す。ゲスト行は消さない。
// 外部キーが無効でも残らないよう、子の行から明示的に消す。
export function deleteMemberAccount(userId: number, db: Database.Database = getDb()): boolean {
  const member = db.prepare(
    "SELECT id FROM users WHERE id = ? AND account_type = 'member'",
  ).get(userId);
  if (!member) return false;
  deleteMemberUploads(userId);
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
