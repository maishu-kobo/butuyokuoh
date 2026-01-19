'use client';

import { useEffect, useState } from 'react';
import { Item } from '@/types';
import { Trash2, Undo2, X, ExternalLink } from 'lucide-react';

interface TrashItem extends Item {
  days_left: number;
}

export default function TrashView() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    const res = await fetch('/api/trash');
    const data = await res.json();
    setItems(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleRestore = async (id: number) => {
    await fetch(`/api/trash/${id}`, { method: 'POST' });
    fetchItems();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('完全に削除しますか？元に戻せません。')) return;
    await fetch(`/api/trash/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const handleEmptyTrash = async () => {
    if (!confirm('ゴミ箱を空にしますか？全てのアイテムが完全に削除されます。')) return;
    await fetch('/api/trash', { method: 'DELETE' });
    fetchItems();
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-500 dark:text-slate-400">読み込み中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trash2 className="text-slate-500 dark:text-slate-400" size={24} />
          <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">ゴミ箱 ({items.length}件)</h2>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleEmptyTrash}
            className="px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
          >
            ゴミ箱を空にする
          </button>
        )}
      </div>
      
      <p className="text-sm text-slate-500 dark:text-slate-400">
        削除したアイテムは7日間保持され、その後自動的に完全削除されます。
      </p>

      {items.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <Trash2 size={48} className="mx-auto mb-4 opacity-30" />
          <p>ゴミ箱は空です</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 flex items-center gap-4">
              {/* 画像 */}
              <div className="w-16 h-16 flex-shrink-0 bg-slate-100 dark:bg-slate-700 rounded">
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-full object-contain rounded opacity-60"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
                    No Image
                  </div>
                )}
              </div>

              {/* 情報 */}
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-slate-700 dark:text-slate-200 truncate">{item.name}</h4>
                <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 dark:text-slate-400 flex-wrap">
                  <span>¥{item.current_price?.toLocaleString() || '---'}</span>
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
                  <span className="text-red-500">
                    あと{item.days_left}日で削除
                  </span>
                </div>
              </div>

              {/* アクション */}
              <div className="flex items-center gap-1">
                {item.url && !item.url.startsWith('manual://') && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-blue-500 p-2"
                    title="商品ページを開く"
                  >
                    <ExternalLink size={18} />
                  </a>
                )}
                <button
                  onClick={() => handleRestore(item.id)}
                  className="text-green-500 hover:text-green-600 p-2"
                  title="元に戻す"
                >
                  <Undo2 size={18} />
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-red-400 hover:text-red-600 p-2"
                  title="完全に削除"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
