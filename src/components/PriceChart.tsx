'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { PriceHistory } from '@/types';

interface PriceChartProps {
  itemId: number;
  url?: string;
  source?: string;
}

// AmazonのURLからASINを抽出
function extractAsin(url: string): string | null {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/) ||
                url.match(/\/gp\/product\/([A-Z0-9]{10})/) ||
                url.match(/\/ASIN\/([A-Z0-9]{10})/);
  return match ? match[1] : null;
}

// AmazonのURLかどうかを安全に判定（hostname完全一致）
function isAmazonUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'www.amazon.co.jp' ||
           hostname === 'www.amazon.jp' ||
           hostname === 'www.amazon.com' ||
           hostname === 'amazon.co.jp' ||
           hostname === 'amazon.jp' ||
           hostname === 'amazon.com';
  } catch {
    return false;
  }
}

// 楽天のURLかどうかを判定
function isRakutenUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname.includes('rakuten.co.jp');
  } catch {
    return false;
  }
}

export default function PriceChart({ itemId, url, source }: PriceChartProps) {
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeepa, setShowKeepa] = useState(true);

  // Amazonの場合、ASINを抽出
  const isAmazon = source === 'amazon' || isAmazonUrl(url);
  const isRakuten = source === 'rakuten' || isRakutenUrl(url);
  const asin = url ? extractAsin(url) : null;
  
  // Amazon・楽天はサーバー側での価格取得ができない
  const cannotAutoCollect = isAmazon || isRakuten;

  useEffect(() => {
    fetch(`/api/items/${itemId}/price-history`)
      .then((res) => res.json())
      .then((data) => {
        setHistory(data);
        setLoading(false);
      });
  }, [itemId]);

  // Amazon商品でASINが取れた場合、Keepaグラフを表示
  if (isAmazon && asin && showKeepa) {
    const keepaUrl = `https://graph.keepa.com/pricehistory.png?domain=5&asin=${asin}`;

    return (
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-gray-500">Keepa価格履歴</span>
          <button
            onClick={() => setShowKeepa(false)}
            className="text-xs text-blue-500 hover:underline"
          >
            自己収集データを見る
          </button>
        </div>
        <div className="bg-white rounded overflow-hidden">
          <img
            src={keepaUrl}
            alt="Keepa価格履歴"
            className="w-full h-auto"
            onError={(e) => {
              // 画像が取得できなかった場合は自己収集データに切り替え
              setShowKeepa(false);
            }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">
          データ提供: <a href={`https://keepa.com/#!product/5-${asin}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Keepa</a>
        </p>
      </div>
    );
  }

  // 自己収集データの表示
  if (loading) {
    return <div className="h-48 flex items-center justify-center text-gray-500">読み込み中...</div>;
  }

  if (history.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center text-gray-500">
        <p>価格履歴がまだありません</p>
        {cannotAutoCollect ? (
          <p className="text-xs mt-1 text-center">
            {isAmazon ? 'Amazon' : '楽天'}の商品はボット対策により<br />
            サーバーからの価格収集ができません
          </p>
        ) : (
          <p className="text-xs mt-1">登録後、6時間ごとに価格を自動収集します</p>
        )}
        {isAmazon && asin && (
          <button
            onClick={() => setShowKeepa(true)}
            className="mt-2 text-xs text-blue-500 hover:underline"
          >
            Keepaの履歴を見る
          </button>
        )}
      </div>
    );
  }

  const chartData = history.map((h) => ({
    date: format(new Date(h.recorded_at), 'MM/dd HH:mm', { locale: ja }),
    price: h.price,
    fullDate: format(new Date(h.recorded_at), 'yyyy/MM/dd HH:mm', { locale: ja }),
  }));

  const minPrice = Math.min(...history.map((h) => h.price));
  const maxPrice = Math.max(...history.map((h) => h.price));

  // 1件のみの場合はシンプルな表示
  if (history.length === 1) {
    return (
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-gray-500">自己収集データ</span>
          {isAmazon && asin && (
            <button
              onClick={() => setShowKeepa(true)}
              className="text-xs text-blue-500 hover:underline"
            >
              Keepaの履歴を見る
            </button>
          )}
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">¥{history[0].price.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">{chartData[0].fullDate} 時点（登録時）</p>
          </div>
          {cannotAutoCollect ? (
            <p className="text-xs text-gray-400 mt-3 text-center">
              {isAmazon ? 'Amazon' : '楽天'}の商品はボット対策により<br />
              サーバーからの定期的な価格収集ができません
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-3 text-center">
              次回の価格収集後にグラフが表示されます
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-gray-500">自己収集データ（{history.length}件）</span>
        {isAmazon && asin && (
          <button
            onClick={() => setShowKeepa(true)}
            className="text-xs text-blue-500 hover:underline"
          >
            Keepaの履歴を見る
          </button>
        )}
      </div>
      <div className="flex justify-between mb-2 text-sm">
        <span className="text-gray-500">
          最安値: <span className="text-green-600 font-semibold">¥{minPrice.toLocaleString()}</span>
        </span>
        <span className="text-gray-500">
          最高値: <span className="text-red-600 font-semibold">¥{maxPrice.toLocaleString()}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => `¥${value.toLocaleString()}`}
            domain={['dataMin - 100', 'dataMax + 100']}
          />
          <Tooltip
            formatter={(value) => [`¥${Number(value).toLocaleString()}`, '価格']}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
