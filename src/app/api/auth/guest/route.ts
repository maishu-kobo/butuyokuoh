import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/auth';
import { endGuest, GUEST_COOKIE, GuestError, guestEnabled, guestLimit, startGuest } from '@/lib/guest';
import { guestErrorResponse, requireSameOrigin } from '@/lib/api-access';

export function GET() {
  return NextResponse.json({ enabled: guestEnabled(), ttlHours: guestLimit('TTL_HOURS', 24) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await getCurrentUser();
    if (user?.account_type === 'member') throw new GuestError(409, 'ALREADY_MEMBER', 'すでにログインしています');
    const store = await cookies();
    const guest = startGuest(store.get(GUEST_COOKIE)?.value);
    const response = NextResponse.json({ user: guest.user }, { status: guest.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(GUEST_COOKIE, guest.token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
      expires: new Date(guest.user.expiresAt),
    });
    return response;
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireSameOrigin(request);
    endGuest((await cookies()).get(GUEST_COOKIE)?.value);
    const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(GUEST_COOKIE, '', { maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    return response;
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
