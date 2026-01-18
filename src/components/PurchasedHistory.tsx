'use client';

import { useEffect, useState } from 'react';
import { Item } from '@/types';
import { ShoppingBag, Calendar, ExternalLink, Undo2 } from 'lucide-react';

interface MonthlySummary {
  month: string;
  count: number;
  total: number;
}

interface PurchasedData {
  items: Item[];
  monthlySummary: MonthlySummary[];
  totalStats: {
    count: number;
    total: number;
  };
}

export default function PurchasedHistory() {
  const [data, setData] = useState<PurchasedData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const res = await fetch('/api/purchased');
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUndo = async (id: number) => {
    await fetch(`/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_purchased: false, purchased_at: null }),
    });
    fetchData();
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">読み込み中...</div>;
  }

  if (!data) {
    return <div className="text-center py-8 text-gray-500 dark:text-gray-400">データの取得に失敗しました</div>;
  }

  return (
    <div className="space-y-6">
      {/* 全体統計 */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg p-6 text-white">
        <div className="flex items-center gap-2 mb-2">
          <ShoppingBag size={24} />
          <h2 className="text-lg font-semibold">購入済み合計</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-green-100 text-sm">アイテム数</p>
            <p className="text-3xl font-bold">{data.totalStats.count}<span className="text-lg">件</span></p>
          </div>
          <div>
            <p className="text-green-100 text-sm">合計金額</p>
            <p className="text-3xl font-bold">¥{data.totalStats.total.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* 月別集計 */}
      {data.monthlySummary.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-3">月別購入履歴</h3>
          <div className="space-y-2">
            {data.monthlySummary.map((m) => (
              <div key={m.month} className="flex items-center justify-between py-2 border-b last:border-0">
                <span className="text-gray-600 dark:text-gray-300">{m.month}</span>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500 dark:text-gray-400">{m.count}件</span>
                  <span className="font-semibold">¥{m.total?.toLocaleString() || 0}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 購入済みアイテム一覧 */}
      <div>
        <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-3">購入済みアイテム ({data.items.length}件)</h3>
        {data.items.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            購入済みのアイテムはありません
          </div>
        ) : (
          <div className="space-y-3">
            {data.items.map((item) => (
              <div key={item.id} className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 flex items-center gap-4">
                {/* 画像 */}
                <div className="w-16 h-16 flex-shrink-0 bg-gray-100 rounded">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-contain rounded"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                      No Image
                    </div>
                  )}
                </div>

                {/* 情報 */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</h4>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      ¥{item.current_price?.toLocaleString() || '---'}
                    </span>
                    {item.purchased_at && (
                      <span className="flex items-center gap-1">
                        <Calendar size={14} />
                        {item.purchased_at}
                      </span>
                    )}
                    {item.category_name && (
                      <span
                        className="px-2 py-0.5 rounded text-xs"
                        style={{
                          backgroundColor: `${item.category_color}20`,
                          color: item.category_color || '#666',
                        }}
                      >
                        {item.category_name}
                      </span>
                    )}
                  </div>
                </div>

                {/* アクション */}
                <div className="flex items-center gap-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-500"
                    title="商品ページを開く"
                  >
                    <ExternalLink size={18} />
                  </a>
                  <button
                    onClick={() => handleUndo(item.id)}
                    className="text-gray-400 hover:text-orange-500"
                    title="未購入に戻す"
                  >
                    <Undo2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
