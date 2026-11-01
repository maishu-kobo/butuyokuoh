import { NextRequest, NextResponse } from 'next/server';
import { withAccess } from '@/lib/api-access';
import { listAgentAuditLog, listAgentTokens } from '@/lib/agent-token';
import { getCurrentUser } from '@/lib/auth';

async function handleGET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || user.account_type !== 'member') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const { id } = await context.params;
  const tokenId = Number(id);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: 'トークンが見つかりません' }, { status: 404 });
  }
  const owned = listAgentTokens(user.id).some((token) => token.id === tokenId);
  if (!owned) {
    return NextResponse.json({ error: 'トークンが見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ entries: listAgentAuditLog(user.id, tokenId) });
}

export const GET = withAccess(handleGET, false);
