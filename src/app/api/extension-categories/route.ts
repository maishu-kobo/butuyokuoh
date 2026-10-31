import { guestErrorResponse } from '@/lib/api-access';
import { GuestError } from '@/lib/guest';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  applyExtensionAuthHeaders,
  extensionCorsHeaders,
  resolveExtensionAuth,
} from '@/lib/extension-auth';

interface Category {
  id: number;
  name: string;
  color: string;
}

const corsHeaders = extensionCorsHeaders('GET, OPTIONS');

export async function GET(request: NextRequest) {
  try {
    const auth = resolveExtensionAuth(request, { rate: 'read' });
    const userId = auth.userId;

    const db = getDb();
    const categories = db.prepare(`
      SELECT id, name, color
      FROM categories
      WHERE user_id = ?
      ORDER BY sort_order, name
    `).all(userId) as Category[];

    const headers = { ...corsHeaders };
    applyExtensionAuthHeaders(headers, auth);
    return NextResponse.json(categories, { headers });
  } catch (error) {
    if (error instanceof GuestError) {
      const response = guestErrorResponse(error);
      for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      return response;
    }
    console.error('Extension categories error:', error);
    return NextResponse.json(
      { error: 'カテゴリの取得に失敗しました' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
