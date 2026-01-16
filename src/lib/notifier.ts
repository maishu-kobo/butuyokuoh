import { Item } from '@/types';

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

export async function sendLineNotification(
  token: string,
  payload: NotificationPayload
): Promise<boolean> {
  const { item, oldPrice, newPrice, targetPrice, type } = payload;
  
  const emoji = type === 'target_reached' ? '🎉' : '📉';
  const title = type === 'target_reached' 
    ? `${emoji} 目標価格に到達！`
    : `${emoji} 価格が下がりました！`;
  
  const priceChange = oldPrice - newPrice;
  const changePercent = Math.round((priceChange / oldPrice) * 100);

  const message = `${title}\n\n` +
    `商品: ${item.name}\n` +
    `旧価格: ¥${oldPrice.toLocaleString()}\n` +
    `新価格: ¥${newPrice.toLocaleString()} (-¥${priceChange.toLocaleString()}, -${changePercent}%)\n` +
    (targetPrice ? `目標価格: ¥${targetPrice.toLocaleString()}\n` : '') +
    `\n${item.url}`;

  try {
    const res = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
      },
      body: `message=${encodeURIComponent(message)}`,
    });
    return res.ok;
  } catch (error) {
    console.error('LINE notification failed:', error);
    return false;
  }
}
