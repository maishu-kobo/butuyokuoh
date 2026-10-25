import { cookies } from 'next/headers';
import { GUEST_COOKIE } from '@/lib/guest';
import { withAccess } from '@/lib/api-access';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

async function handleGET() {
  const user = await getCurrentUser();
  
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  
  return NextResponse.json({ user, hasGuestSession: Boolean((await cookies()).get(GUEST_COOKIE)?.value) });
}

export const GET = withAccess(handleGET, true);
