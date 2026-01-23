import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { UserNotificationSettings } from '@/types';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const db = getDb();
  let settings = db.prepare(
    'SELECT * FROM user_notification_settings WHERE user_id = ?'
  ).get(user.id) as UserNotificationSettings | undefined;

  if (!settings) {
    // デフォルト設定を作成
    db.prepare(
      'INSERT INTO user_notification_settings (user_id) VALUES (?)'
    ).run(user.id);
    settings = db.prepare(
      'SELECT * FROM user_notification_settings WHERE user_id = ?'
    ).get(user.id) as UserNotificationSettings;
  }

  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { slack_webhook, discord_webhook, notify_on_price_drop, notify_on_target_price, notify_on_stock_back } = body;

  const db = getDb();

  // upsert
  db.prepare(`
    INSERT INTO user_notification_settings (user_id, slack_webhook, discord_webhook, notify_on_price_drop, notify_on_target_price, notify_on_stock_back)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      slack_webhook = excluded.slack_webhook,
      discord_webhook = excluded.discord_webhook,
      notify_on_price_drop = excluded.notify_on_price_drop,
      notify_on_target_price = excluded.notify_on_target_price,
      notify_on_stock_back = excluded.notify_on_stock_back,
      updated_at = datetime('now')
  `).run(
    user.id,
    slack_webhook || null,
    discord_webhook || null,
    notify_on_price_drop ? 1 : 0,
    notify_on_target_price ? 1 : 0,
    notify_on_stock_back !== false ? 1 : 0
  );

  const settings = db.prepare(
    'SELECT * FROM user_notification_settings WHERE user_id = ?'
  ).get(user.id);

  return NextResponse.json(settings);
}
