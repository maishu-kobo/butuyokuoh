import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse, requireSameOrigin, withAccess } from '@/lib/api-access';
import { createAgentToken, listAgentTokens, parseScopes } from '@/lib/agent-token';
import { getCurrentUser } from '@/lib/auth';
import { GuestError } from '@/lib/guest';

async function handleGET() {
  const user = await getCurrentUser();
  if (!user || user.account_type !== 'member') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  return NextResponse.json({ tokens: listAgentTokens(user.id) });
}

async function handlePOST(request: NextRequest) {
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
  const { name, scopes, expiresInDays } = body as {
    name?: unknown;
    scopes?: unknown;
    expiresInDays?: unknown;
  };
  if (typeof name !== 'string') {
    return NextResponse.json({ error: 'トークン名を入力してください' }, { status: 400 });
  }
  const parsedScopes = parseScopes(scopes);
  if (!parsedScopes) {
    return NextResponse.json({ error: '権限は read / write から選んでください' }, { status: 400 });
  }
  let days: number | undefined;
  if (expiresInDays !== undefined) {
    if (typeof expiresInDays !== 'number' || !Number.isSafeInteger(expiresInDays)) {
      return NextResponse.json({ error: '有効期限の日数を確認してください' }, { status: 400 });
    }
    days = expiresInDays;
  }
  try {
    const created = createAgentToken(user.id, {
      name,
      scopes: parsedScopes,
      expiresInDays: days,
    });
    return NextResponse.json({
      token: created.token,
      record: created.record,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}

export const GET = withAccess(handleGET, false);
export const POST = withAccess(handlePOST, false);
