'use client';

import { useState } from 'react';
import { Item } from '@/types';
import { Trash2, RefreshCw, ExternalLink, TrendingDown, TrendingUp, Calendar, Flag } from 'lucide-react';
import PriceChart from './PriceChart';

interface ItemCardProps {
  item: Item;
  onUpdate: () => void;
  onDelete: (id: number) => void;
}

export default function ItemCard({ item, onUpdate, onDelete }: ItemCardProps) {
  const [showChart, setShowChart] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    priority: item.priority,
    planned_purchase_date: item.planned_purchase_date || '',
    notes: item.notes || '',
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/items/${item.id}/refresh`, { method: 'POST' });
      onUpdate();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async () => {
    await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editData),
    });
    setEditing(false);
    onUpdate();
  };

  const handlePurchased = async () => {
    if (!confirm('このアイテムを購入済みにしますか？')) return;
    await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        is_purchased: true,
        purchased_at: new Date().toISOString().split('T')[0],
      }),
    });
    onUpdate();
  };

  const priceChange = item.original_price && item.current_price 
    ? item.current_price - item.original_price 
    : 0;

  const sourceColors: Record<string, string> = {
    amazon: 'bg-orange-100 text-orange-800',
    rakuten: 'bg-red-100 text-red-800',
    other: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="flex">
        {/* 画像 */}
        <div className="w-32 h-32 flex-shrink-0 bg-gray-100">
          {item.image_url ? (
            <img 
              src={item.image_url} 
              alt={item.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              No Image
            </div>
          )}
        </div>

        {/* 情報 */}
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded ${sourceColors[item.source] || sourceColors.other}`}>
                  {item.source_name || item.source}
                </span>
                {item.category_name && item.category_color && (
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${item.category_color}20`,
                      color: item.category_color,
                    }}
                  >
                    {item.category_name}
                  </span>
                )}
                <div 
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                    item.priority <= 2 
                      ? 'bg-red-100 text-red-700' 
                      : item.priority === 3 
                        ? 'bg-yellow-100 text-yellow-700' 
                        : 'bg-gray-100 text-gray-600'
                  }`}
                  title="優先度"
                >
                  <Flag size={12} />
                  {['', '最高', '高', '普通', '低', '最低'][item.priority]}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 line-clamp-2">{item.name}</h3>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-blue-500 ml-2"
            >
              <ExternalLink size={18} />
            </a>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-gray-900">
              ¥{item.current_price?.toLocaleString() || '---'}
            </span>
            {priceChange !== 0 && (
              <span className={`text-sm flex items-center ${priceChange < 0 ? 'text-green-600' : 'text-red-600'}`}>
                {priceChange < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                ¥{Math.abs(priceChange).toLocaleString()}
              </span>
            )}
          </div>

          {item.planned_purchase_date && (
            <div className="mt-1 text-sm text-gray-500 flex items-center gap-1">
              <Calendar size={14} />
              購入予定: {item.planned_purchase_date}
            </div>
          )}

          {item.notes && (
            <p className="mt-1 text-sm text-gray-600 line-clamp-1">{item.notes}</p>
          )}
        </div>
      </div>

      {/* アクション */}
      <div className="px-4 py-2 bg-gray-50 flex items-center justify-between border-t">
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-gray-500 hover:text-blue-500 disabled:opacity-50"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowChart(!showChart)}
            className="text-sm text-gray-500 hover:text-blue-500"
          >
            価格推移
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="text-sm text-gray-500 hover:text-blue-500"
          >
            編集
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePurchased}
            className="text-sm px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
          >
            購入済みにする
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="text-red-400 hover:text-red-600"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* 価格チャート */}
      {showChart && (
        <div className="p-4 border-t">
          <PriceChart itemId={item.id} />
        </div>
      )}

      {/* 編集フォーム */}
      {editing && (
        <div className="p-4 border-t bg-gray-50">
          <div className="grid gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">優先度</label>
              <select
                value={editData.priority}
                onChange={(e) => setEditData({ ...editData, priority: Number(e.target.value) })}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} - {['', '最高', '高', '普通', '低', '最低'][n]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">購入予定日</label>
              <input
                type="date"
                value={editData.planned_purchase_date}
                onChange={(e) => setEditData({ ...editData, planned_purchase_date: e.target.value })}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">メモ</label>
              <textarea
                value={editData.notes}
                onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1 text-gray-600 hover:text-gray-800"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
