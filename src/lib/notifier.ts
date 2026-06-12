import { Item } from '@/types';
import { isAllowedWebhookUrl } from '@/lib/url-validator';

export interface NotificationPayload {
  item: Item;
  oldPrice: number;
  newPrice: number;
  targetPrice?: number;
  type: 'price_drop' | 'target_reached';
}

export async function sendSlackNotification(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<boolean> {
  // 送信前検証（多重防御 / SSRF対策）
  // PUT検証前に保存された不正URLや別経路で混入した不正URLにもfetchしない。
  if (!isAllowedWebhookUrl(webhookUrl, 'slack')) {
    console.warn('Slack notification skipped: disallowed webhook host');
    return false;
  }

  const { item, oldPrice, newPrice, targetPrice, type } = payload;

  const emoji = type === 'target_reached' ? '🎉' : '📉';
  const title = type === 'target_reached'
    ? `${emoji} 目標価格に到達！`
    : `${emoji} 価格が下がりました！`;

  const priceChange = oldPrice - newPrice;
  const changePercent = Math.round((priceChange / oldPrice) * 100);

  const message = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: title, emoji: true }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${item.name}*\n\n` +
            `旧価格: ¥${oldPrice.toLocaleString()}\n` +
            `*新価格: ¥${newPrice.toLocaleString()}* (-¥${priceChange.toLocaleString()}, -${changePercent}%)` +
            (targetPrice ? `\n目標価格: ¥${targetPrice.toLocaleString()}` : '')
        },
        accessory: item.image_url ? {
          type: 'image',
          image_url: item.image_url,
          alt_text: item.name
        } : undefined
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '商品ページを開く' },
            url: item.url
          }
        ]
      }
    ]
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    return res.ok;
  } catch (error) {
    console.error('Slack notification failed:', error);
    return false;
  }
}

export async function sendDiscordNotification(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<boolean> {
  // 送信前検証（多重防御 / SSRF対策）
  // PUT検証前に保存された不正URLや別経路で混入した不正URLにもfetchしない。
  if (!isAllowedWebhookUrl(webhookUrl, 'discord')) {
    console.warn('Discord notification skipped: disallowed webhook host');
    return false;
  }

  const { item, oldPrice, newPrice, targetPrice, type } = payload;

  const emoji = type === 'target_reached' ? '🎉' : '📉';
  const title = type === 'target_reached'
    ? `${emoji} 目標価格に到達！`
    : `${emoji} 価格が下がりました！`;

  const priceChange = oldPrice - newPrice;
  const changePercent = Math.round((priceChange / oldPrice) * 100);

  const embed = {
    title: title,
    description: item.name,
    url: item.url,
    color: type === 'target_reached' ? 0x00ff00 : 0xffa500,
    fields: [
      {
        name: '旧価格',
        value: `¥${oldPrice.toLocaleString()}`,
        inline: true,
      },
      {
        name: '新価格',
        value: `¥${newPrice.toLocaleString()}`,
        inline: true,
      },
      {
        name: '値下げ',
        value: `-¥${priceChange.toLocaleString()} (-${changePercent}%)`,
        inline: true,
      },
    ],
    thumbnail: item.image_url ? { url: item.image_url } : undefined,
    timestamp: new Date().toISOString(),
  };

  if (targetPrice) {
    embed.fields.push({
      name: '目標価格',
      value: `¥${targetPrice.toLocaleString()}`,
      inline: true,
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return res.ok;
  } catch (error) {
    console.error('Discord notification failed:', error);
    return false;
  }
}
