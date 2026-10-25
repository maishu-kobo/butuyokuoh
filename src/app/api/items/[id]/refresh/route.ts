import { scrapeGuestUrl } from '@/lib/guest-scraper';
import { assertGuestCapacity, assertGuestSessionActive, GuestError } from '@/lib/guest';
import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeUrl, deriveScrapeOutcome, ScrapedItem } from '@/lib/scraper';
import { getCurrentUser } from '@/lib/auth';
import { excludesPagePriceCheck } from '@/lib/price-check-items';

interface DbItem {
  id: number;
  user_id: number;
  url: string;
  current_price: number | null;
  comparison_group_id: number | null;
}

async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, user.id) as DbItem | undefined;
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  // ショップが2件以上の写真グループは、ページの再取得で価格を上書きしない。
  if (excludesPagePriceCheck(db, item)) {
    return NextResponse.json(
      { error: '写真から登録した商品は価格の再取得をしません', code: 'PHOTO_PRICE_EXCLUDED' },
      { status: 409 },
    );
  }

  // 再スクレイピング（例外時も last_scraped_at と失敗ステータスを記録する）
  let scraped: ScrapedItem;
  try {
    scraped = user.account_type === 'guest' ? await scrapeGuestUrl(item.url, user.id) : await scrapeUrl(item.url);
  } catch (error) {
    if (error instanceof GuestError) throw error;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    try {
      db.prepare(`
        UPDATE items
        SET last_scraped_at = datetime('now'),
            scrape_status = 'failed',
            scrape_error = ?
        WHERE id = ?
      `).run(message, item.id);
    } catch (updateError) {
      // 記録用UPDATEの失敗ではレスポンス自体は変えない
      console.error('Failed to record scrape failure:', updateError);
    }
    return NextResponse.json({ error: '価格の再取得に失敗しました' }, { status: 500 });
  }

  return db.transaction(() => {
    assertGuestSessionActive(user, db);
    const current = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(id, user.id) as DbItem | undefined;
    if (!current) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    if (current.url !== item.url) return NextResponse.json({ error: 'URLが変更されました。もう一度お試しください' }, { status: 409 });

    // スクレイプ結果（成功/失敗）を導出（check-prices と共通ロジック）
    const outcome = deriveScrapeOutcome(scraped);

    // スクレイピング結果を更新（商品名、価格、画像）
    const updates: string[] = [];
    const values: unknown[] = [];

    // 商品名が取得できた場合のみ更新（エラーメッセージでない場合）
    if (scraped.name && !scraped.name.includes('取得できません') && !scraped.name.includes('不明な商品') && scraped.name !== '取得失敗' && scraped.name !== '無効なURL') {
      updates.push('name = ?');
      values.push(scraped.name);
    }

    // 価格が取得できた場合
    if (scraped.price) {
      updates.push('original_price = COALESCE(original_price, ?)');
      values.push(scraped.price);
      updates.push('current_price = ?');
      values.push(scraped.price);

      // 価格が変わった場合のみ履歴に追加
      if (scraped.price !== current.current_price) {
        assertGuestCapacity(user, 'price_history', db);
        db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(id, scraped.price);
      }
    }

    // 画像が取得できた場合
    if (scraped.imageUrl) {
      updates.push('image_url = ?');
      values.push(scraped.imageUrl);
    }

    // スクレイプ結果は成功/失敗にかかわらず常に記録する
    updates.push('last_scraped_at = datetime(\'now\')');
    updates.push('scrape_status = ?');
    values.push(outcome.status);
    updates.push('scrape_error = ?');
    values.push(outcome.error);

    // updated_at を更新して実行
    updates.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown>;
    return NextResponse.json({ ...updated, note: scraped.note });
  }).immediate();
}

export const POST = withAccess(handlePOST, true);
