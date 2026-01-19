'use client';

import { useState, useRef } from 'react';
import { Item, Category, ComparisonGroup } from '@/types';
import { Trash2, RefreshCw, ExternalLink, TrendingDown, TrendingUp, Calendar, Flag, Upload, ImageIcon } from 'lucide-react';
import PriceChart from './PriceChart';

interface ItemCardProps {
  item: Item;
  onUpdate: () => void;
  onDelete: (id: number) => void;
  categories?: Category[];
  comparisonGroups?: ComparisonGroup[];
  isLowestPrice?: boolean;
}

export default function ItemCard({ item, onUpdate, onDelete, categories = [], comparisonGroups = [], isLowestPrice = false }: ItemCardProps) {
  const [showChart, setShowChart] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: item.name || '',
    url: item.url || '',
    priority: item.priority,
    planned_purchase_date: item.planned_purchase_date || '',
    notes: item.notes || '',
    target_price: item.target_price || '',
    target_currency: item.target_currency || 'JPY',
    category_id: item.category_id || '',
    comparison_group_id: item.comparison_group_id || '',
    quantity: item.quantity || 1,
    image_url: item.image_url || '',
    current_price: item.current_price || '',
  });
  const [refreshingUrl, setRefreshingUrl] = useState(false);
  const [showImageEdit, setShowImageEdit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/items/${item.id}/refresh`, { method: 'POST' });
      onUpdate();
    } finally {
      setRefreshing(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const { url } = await res.json();
        setEditData({ ...editData, image_url: url });
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editData.name || item.name,
        url: editData.url || item.url,
        priority: editData.priority,
        planned_purchase_date: editData.planned_purchase_date || null,
        notes: editData.notes || null,
        target_price: editData.target_price || null,
        target_currency: editData.target_currency,
        category_id: editData.category_id ? Number(editData.category_id) : null,
        comparison_group_id: editData.comparison_group_id ? Number(editData.comparison_group_id) : null,
        quantity: Number(editData.quantity) || 1,
        image_url: editData.image_url || null,
        current_price: editData.current_price ? Number(editData.current_price) : null,
      }),
    });
    setEditing(false);
    setShowImageEdit(false);
    onUpdate();
  };

  // URLを変更して再取得
  const handleRefreshWithNewUrl = async () => {
    if (!editData.url || editData.url === item.url) return;
    
    setRefreshingUrl(true);
    try {
      // まずURLを更新
      await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: editData.url }),
      });
      // その後再取得
      await fetch(`/api/items/${item.id}/refresh`, { method: 'POST' });
      onUpdate();
      setEditing(false);
    } finally {
      setRefreshingUrl(false);
    }
  };

  const handlePurchased = async () => {
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

  // 前回価格との差分（previous_priceがあればそれを使用、なければoriginal_price）
  const previousPrice = item.previous_price ?? item.original_price;
  const priceChange = previousPrice && item.current_price 
    ? item.current_price - previousPrice 
    : 0;

  const sourceColors: Record<string, string> = {
    amazon: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
    rakuten: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
    other: 'bg-gray-100 text-gray-800 dark:bg-slate-600 dark:text-gray-100',
  };

  const sourceNames: Record<string, string> = {
    amazon: 'Amazon',
    rakuten: '楽天',
    other: 'その他',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="flex">
        {/* 画像 */}
        <div className="w-32 h-32 flex-shrink-0 bg-gray-100 dark:bg-slate-700">
          {item.image_url ? (
            <img 
              src={item.image_url} 
              alt={item.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
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
                  {item.source_name || sourceNames[item.source] || 'その他'}
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
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300'
                  }`}
                  title="優先度"
                >
                  <Flag size={12} />
                  {['', '最高', '高', '普通', '低', '最低'][item.priority]}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">{item.name}</h3>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 dark:text-gray-500 hover:text-blue-500 ml-2"
            >
              <ExternalLink size={18} />
            </a>
          </div>

          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className={`text-xl font-bold ${isLowestPrice ? 'text-green-600' : 'text-gray-900 dark:text-gray-100'}`}>
              ¥{item.current_price?.toLocaleString() || '---'}
            </span>
            {isLowestPrice && (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
                🏷️ 最安
              </span>
            )}
            {(item.quantity || 1) > 1 && (
              <span className="text-sm text-gray-600 dark:text-gray-300">
                × {item.quantity} = ¥{((item.current_price || 0) * (item.quantity || 1)).toLocaleString()}
              </span>
            )}
            {priceChange !== 0 && (
              <span className={`text-sm flex items-center ${priceChange < 0 ? 'text-green-600' : 'text-red-600'}`}>
                {priceChange < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                ¥{Math.abs(priceChange).toLocaleString()}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">
            {item.planned_purchase_date && (
              <span className="flex items-center gap-1">
                <Calendar size={14} />
                購入予定: {item.planned_purchase_date}
              </span>
            )}
            {item.target_price && (
              <span className="flex items-center gap-1 text-orange-600">
                🎯 目標: {item.target_currency === 'USD' ? '$' : '¥'}{item.target_price.toLocaleString()}
              </span>
            )}
          </div>

          {item.notes && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-1">{item.notes}</p>
          )}
        </div>
      </div>

      {/* アクション */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-slate-700 flex items-center justify-between border-t">
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-blue-500 disabled:opacity-50"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowChart(!showChart)}
            className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-blue-500"
          >
            価格推移
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-blue-500"
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
          <PriceChart itemId={item.id} url={item.url} source={item.source} />
        </div>
      )}

      {/* 編集フォーム */}
      {editing && (
        <div className="p-4 border-t bg-gradient-to-b from-gray-50/50 to-white dark:from-slate-700/30 dark:to-slate-800">
          <div className="space-y-4">
            {/* 基本情報 */}
            <div className="border-l-2 border-orange-500 pl-3">
              <div className="flex items-center gap-1.5 mb-2">
                <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">基本情報</span>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8">
                    <input
                      type="text"
                      value={editData.name}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      placeholder="商品名"
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
                    />
                  </div>
                  <div className="col-span-4">
                    <select
                      value={editData.priority}
                      onChange={(e) => setEditData({ ...editData, priority: Number(e.target.value) })}
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}-{['', '最高', '高', '普通', '低', '最低'][n]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8">
                    <input
                      type="text"
                      value={editData.url}
                      onChange={(e) => setEditData({ ...editData, url: e.target.value })}
                      placeholder="商品URL"
                      className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-500 dark:text-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
                    />
                  </div>
                  <div className="col-span-4">
                    <div className="flex gap-1">
                      <span className="flex items-center px-2 text-sm text-gray-400 dark:text-gray-500">¥</span>
                      <input
                        type="number"
                        value={editData.current_price}
                        onChange={(e) => setEditData({ ...editData, current_price: e.target.value })}
                        placeholder="価格"
                        className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 購入計画 */}
            <div className="border-l-2 border-orange-500 pl-3">
              <div className="flex items-center gap-1.5 mb-2">
                <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">購入計画</span>
              </div>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-4">
                  <input
                    type="date"
                    value={editData.planned_purchase_date}
                    onChange={(e) => setEditData({ ...editData, planned_purchase_date: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    min="1"
                    value={editData.quantity}
                    onChange={(e) => setEditData({ ...editData, quantity: Math.max(1, Number(e.target.value) || 1) })}
                    placeholder="個数"
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500 text-center"
                  />
                </div>
                <div className="col-span-6">
                  <div className="flex">
                    <select
                      value={editData.target_currency}
                      onChange={(e) => setEditData({ ...editData, target_currency: e.target.value as 'JPY' | 'USD' })}
                      className="px-2 py-1.5 text-sm rounded-l-lg border border-r-0 border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-600 text-gray-900 dark:text-white focus:outline-none"
                    >
                      <option value="JPY">¥</option>
                      <option value="USD">$</option>
                    </select>
                    <input
                      type="number"
                      value={editData.target_price}
                      onChange={(e) => setEditData({ ...editData, target_price: e.target.value ? Number(e.target.value) : '' })}
                      placeholder="目標価格"
                      className="flex-1 px-2.5 py-1.5 text-sm rounded-r-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 分類 */}
            <div className="border-l-2 border-orange-500 pl-3">
              <div className="flex items-center gap-1.5 mb-2">
                <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>
                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">分類</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={editData.category_id}
                  onChange={(e) => setEditData({ ...editData, category_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="">カテゴリなし</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={editData.comparison_group_id}
                  onChange={(e) => setEditData({ ...editData, comparison_group_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="">比較Gなし</option>
                  {comparisonGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* メモ・画像（折りたたみ） */}
            <details className="border-l-2 border-orange-500 pl-3 group">
              <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                メモ・画像
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  value={editData.notes}
                  onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                  placeholder="メモを入力..."
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500 resize-none"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editData.image_url}
                    onChange={(e) => setEditData({ ...editData, image_url: e.target.value })}
                    placeholder="画像URL"
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:border-orange-500"
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="px-2 py-1.5 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50"
                    title="画像アップロード"
                  >
                    <Upload size={16} className="text-gray-400" />
                  </button>
                </div>
                {editData.image_url && (
                  <img src={editData.image_url} alt="プレビュー" className="h-12 w-12 object-cover rounded" />
                )}
              </div>
            </details>

            {/* ボタン */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-sm bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:from-orange-600 hover:to-orange-700 font-medium shadow-sm"
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
