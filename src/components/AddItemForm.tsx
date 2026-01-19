'use client';

import { useState, useRef } from 'react';
import { Plus, X, Upload, Link, Edit3 } from 'lucide-react';
import { ComparisonGroup, Category } from '@/types';

interface AddItemFormProps {
  onAdd: () => void;
  comparisonGroups: ComparisonGroup[];
  categories: Category[];
}

export default function AddItemForm({ onAdd, comparisonGroups, categories }: AddItemFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successNote, setSuccessNote] = useState(''); // 追加成功時の注意メッセージ
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    url: '',
    priority: 3,
    planned_purchase_date: '',
    notes: '',
    comparison_group_id: '',
    category_id: '',
    quantity: 1,
    // 手動追加用
    name: '',
    price: '',
    image_url: '',
  });

  const resetForm = () => {
    setFormData({
      url: '',
      priority: 3,
      planned_purchase_date: '',
      notes: '',
      comparison_group_id: '',
      category_id: '',
      quantity: 1,
      name: '',
      price: '',
      image_url: '',
    });
    setIsManualMode(false);
    setError('');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      const uploadData = new FormData();
      uploadData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: uploadData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'アップロードに失敗しました');
      }

      const { url } = await res.json();
      setFormData({ ...formData, image_url: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードエラー');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = isManualMode
        ? {
            manual: true,
            name: formData.name,
            price: formData.price ? Number(formData.price) : null,
            image_url: formData.image_url || null,
            url: formData.url || null,
            priority: formData.priority,
            planned_purchase_date: formData.planned_purchase_date || null,
            comparison_group_id: formData.comparison_group_id ? Number(formData.comparison_group_id) : null,
            category_id: formData.category_id ? Number(formData.category_id) : null,
            notes: formData.notes || null,
            quantity: Number(formData.quantity) || 1,
          }
        : {
            url: formData.url,
            priority: formData.priority,
            planned_purchase_date: formData.planned_purchase_date || null,
            comparison_group_id: formData.comparison_group_id ? Number(formData.comparison_group_id) : null,
            category_id: formData.category_id ? Number(formData.category_id) : null,
            notes: formData.notes || null,
            quantity: Number(formData.quantity) || 1,
          };

      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || '追加に失敗しました');
      }

      // スクレイピング結果に注意メッセージがあれば表示
      if (data.scrapeNote) {
        setSuccessNote(data.scrapeNote);
        // 10秒後に自動で消す
        setTimeout(() => setSuccessNote(''), 10000);
      }

      resetForm();
      setIsOpen(false);
      onAdd();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <>
        {/* 追加成功時の注意メッセージ */}
        {successNote && (
          <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <p className="text-amber-800 dark:text-amber-200 text-sm">
                  ⚠️ {successNote}
                </p>
              </div>
              <button
                onClick={() => setSuccessNote('')}
                className="ml-2 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        <button
          onClick={() => setIsOpen(true)}
          className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg text-gray- dark:text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={20} />
          新しいアイテムを追加
        </button>
      </>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg">新しいアイテムを追加</h3>
        <button onClick={() => { setIsOpen(false); resetForm(); }} className="text-gray- dark:text-gray-400 hover:text-gray- dark:text-gray-600">
          <X size={20} />
        </button>
      </div>

      {/* モード切り替え */}
      <div className="mb-4 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setIsManualMode(!isManualMode)}
          className="text-xs text-gray- dark:text-gray-400 hover:text-gray- dark:text-gray-600 flex items-center gap-1"
        >
          {isManualMode ? (
            <><Link size={12} /> URLから追加</>
          ) : (
            <><Edit3 size={12} /> 手動で追加</>
          )}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {isManualMode ? (
          /* 手動追加モード */
          <>
            <div>
              <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">
                商品名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="商品名を入力"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">価格</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  placeholder="例: 3990"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">URL（任意）</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* 画像アップロード */}
            <div>
              <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">画像</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.image_url}
                  onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                  placeholder="画像URLを入力またはアップロード"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                  className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1 text-sm text-gray- dark:text-gray-600"
                >
                  <Upload size={14} />
                  {uploading ? '...' : 'アップロード'}
                </button>
              </div>
              {formData.image_url && (
                <div className="mt-2">
                  <img src={formData.image_url} alt="プレビュー" className="h-16 w-16 object-cover rounded" />
                </div>
              )}
            </div>
          </>
        ) : (
          /* URLモード（通常） */
          <div>
            <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">
              商品URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://www.amazon.co.jp/..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">優先度</label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={1}>1 - 最高</option>
              <option value={2}>2 - 高</option>
              <option value={3}>3 - 普通</option>
              <option value={4}>4 - 低</option>
              <option value={5}>5 - 最低</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">購入予定日</label>
            <input
              type="date"
              value={formData.planned_purchase_date}
              onChange={(e) => setFormData({ ...formData, planned_purchase_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">個数</label>
            <input
              type="number"
              min="1"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">カテゴリ</label>
              <select
                value={formData.category_id}
                onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">なし</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {comparisonGroups.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">比較グループ</label>
              <select
                value={formData.comparison_group_id}
                onChange={(e) => setFormData({ ...formData, comparison_group_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">なし</option>
                {comparisonGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray- dark:text-gray-700 mb-1">メモ</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="購入理由や比較ポイントなど"
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
          />
        </div>

        {error && (
          <div className="text-red-500 text-sm">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => { setIsOpen(false); resetForm(); }}
            className="px-4 py-2 text-gray- dark:text-gray-600 hover:text-gray- dark:text-gray-800"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? '追加中...' : '追加'}
          </button>
        </div>
      </form>
    </div>
  );
}
