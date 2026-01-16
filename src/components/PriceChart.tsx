'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { PriceHistory } from '@/types';

interface PriceChartProps {
  itemId: number;
}

export default function PriceChart({ itemId }: PriceChartProps) {
  const [history, setHistory] = useState<PriceHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/items/${itemId}/price-history`)
      .then((res) => res.json())
      .then((data) => {
        setHistory(data);
        setLoading(false);
      });
  }, [itemId]);

  if (loading) {
    return <div className="h-48 flex items-center justify-center text-gray-500">読み込み中...</div>;
  }

  if (history.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-500">
        価格履歴が十分にありません
      </div>
    );
  }

  const chartData = history.map((h) => ({
    date: format(new Date(h.recorded_at), 'MM/dd', { locale: ja }),
    price: h.price,
  }));

  const minPrice = Math.min(...history.map((h) => h.price));
  const maxPrice = Math.max(...history.map((h) => h.price));
  const currentPrice = history[history.length - 1].price;

  return (
    <div>
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
