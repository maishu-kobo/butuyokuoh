import { NextRequest, NextResponse } from 'next/server';
import { guestErrorResponse } from '@/lib/api-access';
import { getAgentBudgetSummary } from '@/lib/agent-items';
import { withAgentNotice } from '@/lib/agent-response';
import { requireAgentToken } from '@/lib/agent-token';
import { GuestError } from '@/lib/guest';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAgentToken(request, 'read', { rate: 'read' });
    const month = request.nextUrl.searchParams.get('month');
    const summary = getAgentBudgetSummary(auth.userId, month);
    return NextResponse.json(withAgentNotice(summary), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GuestError) return guestErrorResponse(error);
    throw error;
  }
}
