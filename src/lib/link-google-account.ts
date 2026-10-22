import type Database from 'better-sqlite3';

export interface GoogleLinkInput {
  email: string;
  googleId: string;
  name: string | null;
  emailVerified: boolean;
}

export type GoogleLinkResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'unverified_email' | 'missing_identity' | 'account_conflict' };

interface ExistingUser {
  id: number;
  google_id: string | null;
}

/**
 * Googleログインを既存ユーザーへ結びつける。
 *
 * パスワード登録はメール未確認のまま作れる。ここでパスワードを残したまま
 * 同じメールの確認済みGoogleアカウントを結びつけると、先に登録した側が
 * パスワードでログインし続けられる。確認済みGoogle側を所有者とみなし、
 * 結び付けた時点でパスワードを無効化する。
 */
export function linkGoogleAccount(
  db: Database.Database,
  input: GoogleLinkInput
): GoogleLinkResult {
  const email = input.email.trim();
  const googleId = input.googleId.trim();

  if (!email || !googleId) {
    return { ok: false, reason: 'missing_identity' };
  }

  if (!input.emailVerified) {
    return { ok: false, reason: 'unverified_email' };
  }

  const link = db.transaction((): GoogleLinkResult => {
    const existing = db
      .prepare(
        `SELECT id, google_id
         FROM users
         WHERE email = ? OR google_id = ?
         ORDER BY CASE WHEN google_id = ? THEN 0 ELSE 1 END
         LIMIT 1`
      )
      .get(email, googleId, googleId) as ExistingUser | undefined;

    if (!existing) {
      const result = db
        .prepare(
          'INSERT INTO users (email, password_hash, google_id, name) VALUES (?, NULL, ?, ?)'
        )
        .run(email, googleId, input.name);
      return { ok: true, userId: Number(result.lastInsertRowid) };
    }

    if (existing.google_id && existing.google_id !== googleId) {
      return { ok: false, reason: 'account_conflict' };
    }

    db.prepare(
      `UPDATE users
       SET google_id = ?,
           name = COALESCE(name, ?),
           password_hash = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(googleId, input.name, existing.id);

    return { ok: true, userId: existing.id };
  });

  return link();
}
