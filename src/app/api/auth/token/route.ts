import { NextResponse } from 'next/server';
import { getCurrentUser, generateToken } from '@/lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  
  const token = generateToken(user);
  return NextResponse.json({ token });
}
