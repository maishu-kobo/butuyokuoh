import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getCurrentUser } from './auth';
import { GuestError, consumeGuestRate, guestLimit } from './guest';
import { DEMO_IMAGE } from './demo-data';

export function requireSameOrigin(request: NextRequest) {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_URL is required for guest mode in production');
  }
  const expected = new URL(configured || request.url).origin;
  if (request.headers.get('origin') !== expected) {
    throw new GuestError(403, 'INVALID_ORIGIN', 'この操作はアプリの画面から実行してください');
  }
}

export function guestErrorResponse(error: GuestError) {
  return NextResponse.json({ error: error.message, code: error.code }, {
    status: error.status,
    headers: { 'Cache-Control': 'no-store', ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) },
  });
}

// Bound the streamed body too: Content-Length alone is controlled by the caller.
async function readGuestBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.body) return {};
  const reader = request.clone().body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      void reader.cancel();
      throw new GuestError(413, 'BODY_TOO_LARGE', '入力内容が大きすぎます');
    }
    chunks.push(value);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new GuestError(400, 'INVALID_INPUT', '入力内容を確認してください');
  }
}

export function validateGuestInput(body: Record<string, unknown>, method?: string) {
  const invalid = () => { throw new GuestError(400, 'INVALID_INPUT', '入力内容・文字数・数値を確認してください'); };
  const lengths: Record<string, number> = { name: 200, notes: 2000, url: 2048, image_url: 2048, color: 7, icon: 32, planned_purchase_date: 10, purchased_at: 32, target_currency: 3 };
  for (const [key, value] of Object.entries(body)) {
    if (value === null) {
      if (['name', 'priority', 'quantity', 'sort_order', 'is_purchased', 'manual', 'color'].includes(key)) invalid();
      continue;
    }
    if (typeof value === 'object' || (typeof value === 'string' && value.length > 2048)) invalid();
    if (key in lengths && (typeof value !== 'string' || value.length > lengths[key])) invalid();
    if (['price', 'current_price', 'target_price'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000)) invalid();
    if (['category_id', 'comparison_group_id', 'quantity', 'priority', 'sort_order'].includes(key)) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'sort_order' ? 0 : 1) || value > (key === 'priority' ? 5 : key === 'quantity' ? 999 : 2_147_483_647)) invalid();
    }
    if (key === 'is_purchased' && ![true, false, 0, 1].includes(value as boolean)) invalid();
    if (key === 'manual' && typeof value !== 'boolean') invalid();
  }
  if (method === 'PATCH' && body.url === null) invalid();
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) invalid();
  if (body.color && !/^#[0-9a-fA-F]{6}$/.test(String(body.color))) invalid();
  if (body.planned_purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.planned_purchase_date))) invalid();
  if (body.url && !/^(https?:\/\/|manual:\/\/)/i.test(String(body.url))) invalid();
  if (body.image_url && body.image_url !== DEMO_IMAGE) {
    throw new GuestError(403, 'MEMBER_REQUIRED', '画像の追加はログイン後に利用できます');
  }
}

export function assertOwnedRelations(db: Database.Database, userId: number, body: Record<string, unknown>) {
  for (const [field, table] of [['category_id', 'categories'], ['comparison_group_id', 'comparison_groups']]) {
    const id = body[field];
    if (id === undefined || id === null) continue;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || !db.prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId)) {
      throw new GuestError(400, 'INVALID_RELATION', '指定したカテゴリまたは比較グループは利用できません');
    }
  }
}

// Guest access must be explicitly opted into by each route. Cookie auth remains
// separate from the extension's member-only bearer authentication.
export function withAccess<Args extends unknown[]>(handler: (request: NextRequest, ...args: Args) => Promise<Response>, allowGuest = false) {
  return async (request: NextRequest, ...args: Args): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) throw new GuestError(401, 'SESSION_REQUIRED', 'セッションが終了しました。ログイン画面から入り直してください');
      if (user.account_type === 'guest') {
        if (!allowGuest) throw new GuestError(403, 'MEMBER_REQUIRED', 'この機能はログイン後に利用できます');
        if (!['GET', 'HEAD'].includes(request.method)) {
          requireSameOrigin(request);
          consumeGuestRate(`write:${user.id}`, guestLimit('WRITES_PER_MINUTE', 60));
          const body = await readGuestBody(request);
          validateGuestInput(body, request.method);
          if (request.nextUrl.pathname === '/api/items' && request.method === 'POST' && body.manual !== true) {
            throw new GuestError(403, 'MEMBER_REQUIRED', 'URLからの商品取得はログイン後に利用できます。手動で追加してください');
          }
        }
      }
      const response = await handler(request, ...args);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (error) {
      if (error instanceof GuestError) return guestErrorResponse(error);
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return guestErrorResponse(new GuestError(409, 'DUPLICATE_ENTRY', '同じURLまたは名前がすでに登録されています'));
      }
      throw error;
    }
  };
}
