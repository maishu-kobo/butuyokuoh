import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { scrapeWishlist } from '@/lib/wishlist-scraper';
import { getCurrentUser } from '@/lib/auth';

// URLを正規化する関数
function normalizeAmazonUrl(url: string): string {
  try {
    // ASINを抽出
    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/) || 
                      url.match(/\/gp\/product\/([A-Z0-9]{10})/) ||
                      url.match(/\/ASIN\/([A-Z0-9]{10})/);
    if (asinMatch) {
      // ドメインを抽出
      const domainMatch = url.match(/amazon\.(co\.jp|jp|com)/);
      const domain = domainMatch ? domainMatch[1] : 'co.jp';
      return `https://www.amazon.${domain}/dp/${asinMatch[1]}`;
    }
    return url;
  } catch {
    return url;
  }
}

interface SkippedItem {
  name: string;
  reason: string;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { url } = body;

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    console.log('[Import] Starting import for URL:', url);
    
    // ほしいものリストをスクレイピング
    const result = await scrapeWishlist(url);
    
    console.log('[Import] Scraping result:', {
      source: result.source,
      listName: result.listName,
      itemCount: result.items.length,
      error: result.error,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (result.items.length === 0) {
      return NextResponse.json({ 
        error: 'アイテムが見つかりませんでした。リストが公開されているか確認してください。' 
      }, { status: 400 });
    }

    const db = getDb();
    
    let imported = 0;
    let skipped = 0;
    const skippedItems: SkippedItem[] = [];
    const importedItems: string[] = [];

    for (const item of result.items) {
      try {
        // URLを正規化
        const normalizedUrl = normalizeAmazonUrl(item.url);
        
        console.log('[Import] Processing item:', {
          name: item.name?.substring(0, 50),
          originalUrl: item.url,
          normalizedUrl,
          price: item.price,
        });

        // 必須フィールドのチェック
        if (!item.name || !normalizedUrl) {
          console.log('[Import] Skipping - missing required fields');
          skipped++;
          skippedItems.push({
            name: item.name || 'Unknown',
            reason: '商品名またはURLが取得できませんでした',
          });
          continue;
        }

        // 重複チェック（正規化されたURLで確認）
        const existingItem = db.prepare(
          'SELECT id, url FROM items WHERE user_id = ? AND (url = ? OR url = ?)'
        ).get(user.id, normalizedUrl, item.url);
        
        if (existingItem) {
          console.log('[Import] Skipping - already exists');
          skipped++;
          skippedItems.push({
            name: item.name.substring(0, 50),
            reason: '既に登録済みのアイテムです',
          });
          continue;
        }

        const sourceName = result.source === 'amazon' ? 'Amazon' : '楽天市場';
        
        // INSERTを実行
        const insertResult = db.prepare(`
          INSERT INTO items (user_id, name, url, image_url, current_price, original_price, source, source_name, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          item.name,
          normalizedUrl,
          item.imageUrl,
          item.price,
          item.price,
          result.source,
          sourceName,
          3
        );

        console.log('[Import] Insert result:', { changes: insertResult.changes, lastId: insertResult.lastInsertRowid });

        if (insertResult.changes > 0) {
          imported++;
          importedItems.push(item.name.substring(0, 50));
          
          // 価格履歴に追加
          if (item.price) {
            db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(
              insertResult.lastInsertRowid, 
              item.price
            );
          }
        }
      } catch (e) {
        console.error('[Import] Error inserting item:', e);
        skipped++;
        skippedItems.push({
          name: item.name?.substring(0, 50) || 'Unknown',
          reason: `データベースエラー: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
    }

    console.log('[Import] Final result:', { imported, skipped, total: result.items.length });

    return NextResponse.json({
      success: true,
      listName: result.listName,
      source: result.source,
      total: result.items.length,
      imported,
      skipped,
      skippedItems: skippedItems.slice(0, 10), // 最大で10件まで返す
      importedItems: importedItems.slice(0, 5), // 最初の5件を返す
      message: imported > 0 
        ? `${imported}件のアイテムをインポートしました` 
        : 'すべてのアイテムが既に登録済みです',
    });
  } catch (error) {
    console.error('[Import] Import wishlist error:', error);
    return NextResponse.json({ 
      error: `インポートに失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, { status: 500 });
  }
}
