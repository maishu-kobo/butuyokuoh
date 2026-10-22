import { scrapeGuestUrl } from '@/lib/guest-scraper';
import { randomUUID } from 'node:crypto';
import { assertGuestCapacity, assertGuestSessionActive } from '@/lib/guest';
import { assertOwnedRelations } from '@/lib/api-access';
import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeUrl } from '@/lib/scraper';
import { getCurrentUser } from '@/lib/auth';
import { isStorableItemUrl, ITEM_URL_ERROR } from '@/lib/http-url';
import { annotateSpend, photoSpendDecisions, userSpendInput } from '@/lib/photo-spend';

async function handleGET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  // previous_price は行ごとの相関サブクエリではなく、ウィンドウ関数で
  // 各アイテムの「2番目に新しい価格履歴」を一括導出して LEFT JOIN する。
  // ORDER BY の id DESC は recorded_at 同値時の結果を決定的にするため。
  const items = db.prepare(`
    SELECT
      i.*,
      cg.name as comparison_group_name,
      cg.origin as comparison_group_origin,
      cg.origin as group_origin,
      cg.priority as group_priority,
      cat.name as category_name,
      cat.color as category_color,
      prev.price as previous_price
    FROM items i
    LEFT JOIN comparison_groups cg ON i.comparison_group_id = cg.id
    LEFT JOIN categories cat ON i.category_id = cat.id
    LEFT JOIN (
      SELECT item_id, price FROM (
        SELECT item_id, price,
               ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY recorded_at DESC, id DESC) AS rn
        FROM price_history
      ) WHERE rn = 2
    ) prev ON prev.item_id = i.id
    WHERE i.is_purchased = 0 AND i.user_id = ? AND i.deleted_at IS NULL
    ORDER BY
      COALESCE(cg.priority, i.priority) ASC,
      i.sort_order ASC,
      i.created_at DESC
  `).all(user.id) as { id: number }[];

  const [spendItems, spendGroups] = userSpendInput(db, user.id);
  return NextResponse.json(annotateSpend(items, photoSpendDecisions(spendItems, spendGroups)));
}

async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const {
    url,
    priority = 3,
    planned_purchase_date,
    notes,
    comparison_group_id,
    category_id,
    quantity = 1,
    // 手動追加用フィールド
    manual = false,
    name: manualName,
    price: manualPrice,
    image_url: manualImageUrl,
  } = body;

  const db = getDb();

  if (typeof url === 'string' && url && !isStorableItemUrl(url)) {
    return NextResponse.json({ error: ITEM_URL_ERROR }, { status: 400 });
  }

  assertOwnedRelations(db, user.id, body);

  // 手動追加モード
  if (manual) {
    if (!manualName) {
      return NextResponse.json({ error: '商品名は必須です' }, { status: 400 });
    }

    return db.transaction(() => {
      assertGuestCapacity(user, 'items', db);
      if (manualPrice) assertGuestCapacity(user, 'price_history', db);
      const stmt = db.prepare(`
        INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source, priority, planned_purchase_date, comparison_group_id, category_id, notes, quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const manualUrl = url || `manual://${randomUUID()}`; // URLなしの場合はダミーURL
      const result = stmt.run(
        user.id,
        manualName,
        manualUrl,
        manualImageUrl || null,
        manualPrice || null,
        manualPrice || null,
        'other',
        priority,
        planned_purchase_date || null,
        comparison_group_id || null,
        category_id || null,
        notes || null,
        quantity
      );

      if (manualPrice) {
        db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(result.lastInsertRowid, manualPrice);
      }

      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
      return NextResponse.json(item, { status: 201 });
    }).immediate();
  }

  // URLベースの追加（通常モード）
  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  // 重複チェック（同じユーザー内で）
  const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ?').get(user.id, url);
  if (existing) {
    return NextResponse.json({ error: 'このURLは既に登録されています' }, { status: 400 });
  }

  // スクレイピング
  assertGuestCapacity(user, 'items', db);
  const scraped = user.account_type === 'guest' ? await scrapeGuestUrl(url, user.id) : await scrapeUrl(url);

  return db.transaction(() => {
    assertGuestSessionActive(user, db);
    assertGuestCapacity(user, 'items', db);
    if (scraped.price) assertGuestCapacity(user, 'price_history', db);
    assertOwnedRelations(db, user.id, body);

    const stmt = db.prepare(`
      INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source, source_name, priority, planned_purchase_date, comparison_group_id, category_id, notes, quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      user.id,
      scraped.name,
      url,
      scraped.imageUrl,
      scraped.price,
      scraped.price,
      scraped.source,
      scraped.sourceName,
      priority,
      planned_purchase_date || null,
      comparison_group_id || null,
      category_id || null,
      notes || null,
      quantity
    );

    // 価格履歴に追加
    if (scraped.price) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(result.lastInsertRowid, scraped.price);
    }

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;

    // スクレイピング結果に注意メッセージがあれば含める
    const response = { ...item, scrapeNote: scraped.note || null };
    return NextResponse.json(response, { status: 201 });
  }).immediate();
}

export const GET = withAccess(handleGET, true);
export const POST = withAccess(handlePOST, true);
