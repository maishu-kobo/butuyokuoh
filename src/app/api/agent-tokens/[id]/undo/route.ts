import { NextRequest, NextResponse } from 'next/server';
import { requireSameOrigin, withAccess } from '@/lib/api-access';
import { listAgentTokens, trashItemsAddedByAgent } from '@/lib/agent-token';
import { getCurrentUser } from '@/lib/auth';

async function handlePOST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  requireSameOrigin(request);
  const user = await getCurrentUser();
  if (!user || user.account_type !== 'member') {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const { id } = await context.params;
  const tokenId = Number(id);
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: 'トークンが見つかりません' }, { status: 404 });
  }
  if (!listAgentTokens(user.id).some((token) => token.id === tokenId)) {
    return NextResponse.json({ error: 'トークンが見つかりません' }, { status: 404 });
  }
  const moved = trashItemsAddedByAgent(user.id, tokenId);
  return NextResponse.json({ success: true, moved });
}

export const POST = withAccess(handlePOST, false);
