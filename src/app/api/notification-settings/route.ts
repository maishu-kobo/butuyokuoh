import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { isAllowedWebhookUrl } from '@/lib/url-validator';
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
  const { slack_webhook, discord_webhook, notify_on_price_drop, notify_on_target_price } = body;

  // Webhook URLの検証（SSRF対策）
  // 非空の場合のみ検証。空文字/null/undefinedは「未設定」として許可（通知は送られないだけ）。
  if (slack_webhook && !isAllowedWebhookUrl(slack_webhook, 'slack')) {
    return NextResponse.json(
      { error: 'Slack Webhook URL が不正です。https://hooks.slack.com/... の形式で入力してください' },
      { status: 400 }
    );
  }
  if (discord_webhook && !isAllowedWebhookUrl(discord_webhook, 'discord')) {
    return NextResponse.json(
      { error: 'Discord Webhook URL が不正です。https://discord.com/api/webhooks/... の形式で入力してください' },
      { status: 400 }
    );
  }

  const db = getDb();

  // upsert
  db.prepare(`
    INSERT INTO user_notification_settings (user_id, slack_webhook, discord_webhook, notify_on_price_drop, notify_on_target_price)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      slack_webhook = excluded.slack_webhook,
      discord_webhook = excluded.discord_webhook,
      notify_on_price_drop = excluded.notify_on_price_drop,
      notify_on_target_price = excluded.notify_on_target_price,
      updated_at = datetime('now')
  `).run(
    user.id,
    slack_webhook || null,
    discord_webhook || null,
    notify_on_price_drop ? 1 : 0,
    notify_on_target_price ? 1 : 0
  );

  const settings = db.prepare(
    'SELECT * FROM user_notification_settings WHERE user_id = ?'
  ).get(user.id);

  return NextResponse.json(settings);
}
