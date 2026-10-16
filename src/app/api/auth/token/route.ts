import { withAccess } from '@/lib/api-access';
import { NextResponse } from 'next/server';
import { getCurrentUser, generateToken } from '@/lib/auth';

async function handleGET() {
  const user = await getCurrentUser();
  
  if (!user || user.account_type !== 'member') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  
  const token = generateToken(user);
  return NextResponse.json({ token });
}

export const GET = withAccess(handleGET, false);
