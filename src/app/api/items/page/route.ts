import { NextRequest, NextResponse } from 'next/server';
import { withAccess } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { ItemPageError, readItemPage } from '@/lib/item-page-query';

async function handleGET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  try {
    return NextResponse.json(readItemPage(getDb(), user.id, request.nextUrl.searchParams), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ItemPageError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
export const GET = withAccess(handleGET, true);
