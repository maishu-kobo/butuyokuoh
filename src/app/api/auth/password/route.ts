import { NextRequest, NextResponse } from 'next/server';
import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { revokeAllAgentTokens } from '@/lib/agent-token';
import {
  confirmVerifiedPassword,
  generateToken,
  getCurrentUser,
  hashPassword,
  revokeMemberSessions,
  setAuthCookie,
  type User,
} from '@/lib/auth';
import { getDb } from '@/lib/db';

async function handlePUT(request: NextRequest) {
  requireSameOrigin(request);
  const user = await getCurrentUser();
  if (!user || user.account_type !== 'member') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
  }
  const { currentPassword, newPassword } = body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return NextResponse.json({ error: '現在のパスワードと新しいパスワードを入力してください' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: '新しいパスワードは6文字以上にしてください' }, { status: 400 });
  }
  if (newPassword.length > 200) {
    return NextResponse.json({ error: '新しいパスワードが長すぎます' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare(
    "SELECT id, email, name, created_at, account_type, password_hash FROM users WHERE id = ? AND account_type = 'member'",
  ).get(user.id) as (User & { password_hash: string | null }) | undefined;
  if (!row?.password_hash) {
    return NextResponse.json(
      { error: 'このアカウントはパスワードを変更できません' },
      { status: 400 },
    );
  }

  const matchedGeneration = await confirmVerifiedPassword(row.id, currentPassword, row.password_hash);
  if (matchedGeneration == null) {
    // 401 にすると apiFetch がセッション切れ扱いするため、入力ミスは 400 にする。
    return NextResponse.json(
      { error: '現在のパスワードが違います', code: 'WRONG_CURRENT_PASSWORD' },
      { status: 400 },
    );
  }

  // bcrypt はトランザクションの外で計算し、DB 更新だけを原子的にする。
  const nextHash = await hashPassword(newPassword);
  const previousHash = row.password_hash;
  const committed = db.transaction(() => {
    const updated = db.prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = datetime('now')
       WHERE id = ? AND account_type = 'member' AND password_hash = ?`,
    ).run(nextHash, row.id, previousHash);
    if (updated.changes !== 1) return false;
    revokeAllAgentTokens(row.id, db);
    if (!revokeMemberSessions(row.id)) return false;
    return true;
  }).immediate();

  if (!committed) {
    return NextResponse.json({ error: 'パスワードを変更できませんでした。もう一度お試しください。' }, { status: 409 });
  }

  const member: User = {
    id: row.id,
    account_type: 'member',
    email: row.email,
    name: row.name,
    created_at: row.created_at,
  };
  const freshGeneration = (db.prepare(
    'SELECT session_generation FROM users WHERE id = ?',
  ).get(row.id) as { session_generation: number }).session_generation;
  const token = generateToken(member, freshGeneration);
  await setAuthCookie(token);
  return NextResponse.json({ success: true });
}

export const PUT = withAccess(handlePUT, false);
