import { scrapeGuestUrl } from '@/lib/guest-scraper';
import { GuestError } from '@/lib/guest';
import { withAccess } from '@/lib/api-access';
import { NextRequest, NextResponse } from 'next/server';
import { scrapeUrl } from '@/lib/scraper';
import { getCurrentUser } from '@/lib/auth';

async function handlePOST(request: NextRequest) {
  try {
    // 認証チェック
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 }
      );
    }

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URLが必要です' },
        { status: 400 }
      );
    }

    // URLのバリデーション
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: '無効なURL形式です' },
        { status: 400 }
      );
    }

    // スクレイピング
    const result = user.account_type === 'guest' ? await scrapeGuestUrl(url, user.id) : await scrapeUrl(url);

    return NextResponse.json({
      name: result.name,
      price: result.price,
      image_url: result.imageUrl,
      source: result.source,
      source_name: result.sourceName,
      note: result.note,
    });
  } catch (error) {
    if (error instanceof GuestError) throw error;
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: '商品情報の取得に失敗しました' },
      { status: 500 }
    );
  }
}

export const POST = withAccess(handlePOST, true);
