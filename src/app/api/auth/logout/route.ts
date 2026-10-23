import { NextResponse } from 'next/server';
import { clearAuthCookie, getCurrentUser, revokeMemberSessions } from '@/lib/auth';

function outsideRequest(error: unknown): boolean {
  return error instanceof Error && error.message.includes('outside a request scope');
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (user?.account_type === 'member') revokeMemberSessions(user.id);
  } catch (error) {
    // テストがリクエストの外からルートを呼ぶと、NextAuth の headers() が例外になる。
    // Cookie を消す処理は続ける。本番のリクエストではここには来ない。
    if (!outsideRequest(error)) throw error;
  }
  await clearAuthCookie();
  return NextResponse.json({ success: true });
}
