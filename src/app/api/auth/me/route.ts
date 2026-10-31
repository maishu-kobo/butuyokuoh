import { GUEST_COOKIE } from '@/lib/guest';
import { withAccess } from '@/lib/api-access';
import { NextResponse } from 'next/server';
import { getCurrentUser, readRequestCookie } from '@/lib/auth';
import { getDb } from '@/lib/db';

async function handleGET() {
  const user = await getCurrentUser();
  
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  let has_password = false;
  if (user.account_type === 'member') {
    const row = getDb().prepare(
      "SELECT password_hash FROM users WHERE id = ? AND account_type = 'member'",
    ).get(user.id) as { password_hash: string | null } | undefined;
    has_password = Boolean(row?.password_hash);
  }
  
  return NextResponse.json({
    user,
    hasGuestSession: Boolean(await readRequestCookie(GUEST_COOKIE)),
    has_password,
  });
}

export const GET = withAccess(handleGET, true);
