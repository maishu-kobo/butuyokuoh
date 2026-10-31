import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { requireAgentToken } from '@/lib/agent-token';
import { getDb } from '@/lib/db';
import { GuestError } from '@/lib/guest';

/**
 * #269 向けの共有認証ヘルパー動作確認用。
 * 画面向け API ではなく、エージェント用 Bearer のみを受け付ける。
 * 成功した読み取りは監査に残さない。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAgentToken(request, 'read', {
      rate: 'read',
    });
    const user = getDb().prepare(
      "SELECT id, email, name, created_at FROM users WHERE id = ? AND account_type = 'member'",
    ).get(auth.userId) as { id: number; email: string; name: string | null; created_at: string } | undefined;
    if (!user) {
      throw new GuestError(401, 'AGENT_TOKEN_INVALID', '無効または期限切れのエージェント用トークンです');
    }
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
      },
      scopes: auth.scopes,
      token: {
        id: auth.token.id,
        name: auth.token.name,
        token_prefix: auth.token.token_prefix,
        expires_at: auth.token.expires_at,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
