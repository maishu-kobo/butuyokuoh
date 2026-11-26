import { NextRequest, NextResponse } from 'next/server';
import { withAccess, requireSameOrigin } from '@/lib/api-access';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseRankAction } from '@/lib/design-rank';
import { moveProduct, saveBuyGuide, savePurchaseTiming } from '@/lib/item-ranking';

async function handlePost(request: NextRequest) {
  requireSameOrigin(request);
  const user = await getCurrentUser();
  if (!user) return new Response(null,{status:401});
  const action = parseRankAction(await request.json());
  if (!action) return NextResponse.json({error:'入力した内容を確認してください。'},{status:400});
  if (action.action === 'move') moveProduct(getDb(),user.id,action);
  else if(action.action==='timing') savePurchaseTiming(getDb(),user.id,action);
  else saveBuyGuide(getDb(),user.id,action);
  return NextResponse.json({ok:true});
}
export const POST = withAccess(handlePost,true);
