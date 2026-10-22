import type Database from 'better-sqlite3';
import { normalizeEmail } from './email';

const GUEST_EMAIL_SUFFIX = '@guest.invalid';

export interface GoogleLinkInput {
  email: string;
  googleId: string;
  name: string | null;
  emailVerified: boolean;
}

export type GoogleLinkResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'unverified_email' | 'missing_identity' | 'account_conflict' | 'rejected_email' };

interface MemberRow {
  id: number;
  email: string;
  google_id: string | null;
}

/**
 * 確認済みの Google ログインを会員行へ結びつける。
 *
 * パスワード登録はメール未確認のまま作れる。ログインは LOWER(email) と
 * account_type = 'member' で照合し、表記ゆれの重複は ORDER BY id の先頭を使う。
 * ここで trim だけを見て会員以外も更新すると、先取り側の password_hash が残り、
 * 確認済み Google のあとでもパスワードで入れる。
 *
 * 確認済み Google を所有者とする。同じメールの会員行からはパスワードを消し、
 * Google ID はログインが選ぶ行（既にある Google ID、なければ最古の会員）にだけ付ける。
 * 別の Google ID が付いているメールは奪わない。ゲスト行と @guest.invalid は対象にしない。
 *
 * 会員 id はそのままなので、パスワードがあった行は session_generation を進める。
 * パスワードが既に無い再ログインでは進めず、本人の別端末は残す。
 */
export function linkGoogleAccount(
  db: Database.Database,
  input: GoogleLinkInput
): GoogleLinkResult {
  const email = normalizeEmail(input.email);
  const googleId = input.googleId.trim();

  if (!email || !googleId) {
    return { ok: false, reason: 'missing_identity' };
  }

  if (email.endsWith(GUEST_EMAIL_SUFFIX)) {
    return { ok: false, reason: 'rejected_email' };
  }

  if (!input.emailVerified) {
    return { ok: false, reason: 'unverified_email' };
  }

  const link = db.transaction((): GoogleLinkResult => {
    const nonMemberOwnsIdentity = db
      .prepare(
        `SELECT id
         FROM users
         WHERE account_type != 'member'
           AND (LOWER(email) = ? OR google_id = ?)
         LIMIT 1`
      )
      .get(email, googleId) as { id: number } | undefined;

    const members = db
      .prepare(
        `SELECT id, email, google_id
         FROM users
         WHERE account_type = 'member'
           AND (LOWER(email) = ? OR google_id = ?)
         ORDER BY CASE WHEN google_id = ? THEN 0 ELSE 1 END, id`
      )
      .all(email, googleId, googleId) as MemberRow[];

    const emailRows = members.filter((row) => normalizeEmail(row.email) === email);
    const googleRow = members.find((row) => row.google_id === googleId);

    if (emailRows.some((row) => row.google_id && row.google_id !== googleId)) {
      return { ok: false, reason: 'account_conflict' };
    }

    // ゲストがこのメールか Google ID を持っていて、同じ Google ID の会員はいない。
    // ゲストは更新しない。新規の会員作成や、その Google ID の付け替えもしない。
    if (!googleRow && nonMemberOwnsIdentity) {
      return { ok: false, reason: 'account_conflict' };
    }

    if (!googleRow && emailRows.length === 0) {
      const result = db
        .prepare(
          `INSERT INTO users (email, password_hash, google_id, name, account_type)
           VALUES (?, NULL, ?, ?, 'member')`
        )
        .run(email, googleId, input.name);
      return { ok: true, userId: Number(result.lastInsertRowid) };
    }

    const primary = googleRow ?? emailRows[0];
    if (!primary) {
      return { ok: false, reason: 'account_conflict' };
    }

    const retirePassword = db.prepare(
      `UPDATE users
       SET session_generation = session_generation + 1,
           updated_at = datetime('now')
       WHERE id = ? AND account_type = 'member' AND password_hash IS NOT NULL`
    );
    const clearPassword = db.prepare(
      `UPDATE users
       SET password_hash = NULL,
           updated_at = datetime('now')
       WHERE id = ? AND account_type = 'member'`
    );
    for (const row of emailRows) {
      if (row.id === primary.id) continue;
      retirePassword.run(row.id);
      clearPassword.run(row.id);
    }

    retirePassword.run(primary.id);
    db.prepare(
      `UPDATE users
       SET google_id = ?,
           name = COALESCE(name, ?),
           password_hash = NULL,
           updated_at = datetime('now')
       WHERE id = ? AND account_type = 'member'`
    ).run(googleId, input.name, primary.id);

    return { ok: true, userId: primary.id };
  });

  return link();
}
