import { NextResponse } from 'next/server';
import { withAccess } from '@/lib/api-access';
import { clearAuthCookie, getCurrentUser } from '@/lib/auth';
import { deleteMemberAccount } from '@/lib/delete-member-account';

async function handleDELETE() {
  const user = await getCurrentUser();
  if (!user || user.account_type !== 'member') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!deleteMemberAccount(user.id)) {
    return NextResponse.json({ error: '退会できませんでした' }, { status: 404 });
  }
  await clearAuthCookie();
  return NextResponse.json({ success: true });
}

export const DELETE = withAccess(handleDELETE, false);
