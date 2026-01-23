import { Item } from '@/types';

export interface NotificationPayload {
  item: Item;
  oldPrice: number;
  newPrice: number;
  targetPrice?: number;
  type: 'price_drop' | 'target_reached';
}

export interface StockNotificationPayload {
  item: Item;
  type: 'stock_back';
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

export async function sendDiscordNotification(
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


export async function sendSlackStockNotification(
  webhookUrl: string,
  payload: StockNotificationPayload
): Promise<boolean> {
  const { item } = payload;

  const message = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🎉 在庫が復活しました！', emoji: true }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${item.name}*\n\n` +
            (item.current_price ? `現在価格: ¥${item.current_price.toLocaleString()}` : '価格情報なし')
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
    console.error('Slack stock notification failed:', error);
    return false;
  }
}

export async function sendDiscordStockNotification(
  webhookUrl: string,
  payload: StockNotificationPayload
): Promise<boolean> {
  const { item } = payload;

  const embed = {
    title: '🎉 在庫が復活しました！',
    description: item.name,
    url: item.url,
    color: 0x00ff00,
    fields: [
      {
        name: '現在価格',
        value: item.current_price ? `¥${item.current_price.toLocaleString()}` : '価格情報なし',
        inline: true,
      },
    ],
    thumbnail: item.image_url ? { url: item.image_url } : undefined,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return res.ok;
  } catch (error) {
    console.error('Discord stock notification failed:', error);
    return false;
  }
}
