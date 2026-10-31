import { assertGuestCapacity } from '@/lib/guest';
import { assertOwnedRelations } from '@/lib/api-access';
import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { isStorableItemUrl, ITEM_URL_ERROR } from '@/lib/http-url';
import { cleanedStoredItemUrlTaken, normalizeItemName, sanitizeStoredItemUrl } from '@/lib/item-input';
import { localCalendarDate } from '@/lib/local-date';

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, user.id);
  
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }
  
  return NextResponse.json(item);
}

async function handlePATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const db = getDb();

  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, user.id) as { current_price?: number; url: string } | undefined;
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  // 保存済み URL と同じなら更新対象にしない（整形で hb.afl / tag 等が消えて identity が飛ぶのを防ぐ）。
  if (typeof body.url === 'string' && body.url) {
    if (body.url === item.url) {
      delete body.url;
    } else {
      const cleaned = sanitizeStoredItemUrl(body.url);
      if (!cleaned || !isStorableItemUrl(cleaned)) {
        return NextResponse.json({ error: ITEM_URL_ERROR }, { status: 400 });
      }
      body.url = cleaned;
    }
  } else if (body.url !== undefined) {
    // 空文字などは URL 更新として扱わない
    delete body.url;
  }

  if (typeof body.name === 'string') {
    const name = normalizeItemName(body.name);
    if (!name) {
      return NextResponse.json({ error: '商品名は必須です' }, { status: 400 });
    }
    body.name = name;
  }

  assertOwnedRelations(db, user.id, body);
  // 価格が変更された場合、価格履歴に記録
  const oldPrice = item.current_price;
  const newPrice = body.current_price;
  const priceChanged = newPrice !== undefined && newPrice !== null && newPrice !== oldPrice;

  const updates: string[] = [];
  const values: unknown[] = [];

  // 購入日を送らない購入操作は、サーバのタイムゾーンではなく日本の暦日にする。
  // 明示した日付と、購入取消の null はそのまま残す。
  if ((body.is_purchased === true || body.is_purchased === 1) && body.purchased_at === undefined) {
    body.purchased_at = localCalendarDate(new Date(), 'Asia/Tokyo');
  }

  const allowedFields = ['name', 'url', 'priority', 'planned_purchase_date', 'comparison_group_id', 'category_id', 'notes', 'is_purchased', 'purchased_at', 'target_price', 'target_currency', 'quantity', 'image_url', 'current_price', 'sort_order'];
  
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      // SQLiteはbooleanをサポートしないので0/1に変換
      let value = body[field];
      if (typeof value === 'boolean') {
        value = value ? 1 : 0;
      }
      values.push(value);
    }
  }

  // 商品URLを変えたら、以前の検索APIの商品コードと取得時刻を引き継がない。
  if (body.url !== undefined && body.url !== item.url) {
    const itemId = Number(id);
    if (cleanedStoredItemUrlTaken(db, user.id, body.url, Number.isFinite(itemId) ? itemId : undefined)) {
      return NextResponse.json({ error: 'この商品はすでに登録されています' }, { status: 409 });
    }
    updates.push('source_item_code = NULL', 'price_fetched_at = NULL');
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  return db.transaction(() => {
    if (priceChanged) assertGuestCapacity(user, 'price_history', db);
    db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // 価格が変更された場合、価格履歴に記録
    if (priceChanged) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(id, newPrice);
    }

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    return NextResponse.json(updated);
  }).immediate();
}

async function handleDELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  // ソフトデリート（ゴミ箱に移動）
  db.prepare("UPDATE items SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}

export const GET = withAccess(handleGET, true);
export const PATCH = withAccess(handlePATCH, true);
export const DELETE = withAccess(handleDELETE, true);
