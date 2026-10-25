'use client';

import { ShoppingBag, Trash2 } from 'lucide-react';
import type { Category, ComparisonGroup } from '@/types';

export default function HomeBulkBar({
  count,
  categories,
  groups,
  onCategoryChange,
  onGroupChange,
  onPurchased,
  onDelete,
}: {
  count: number;
  categories: Category[];
  groups: ComparisonGroup[];
  onCategoryChange: (categoryId: number | null) => void;
  onGroupChange: (groupId: number | null) => void;
  onPurchased: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-lg z-50">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {count}件選択中
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            onChange={(event) => {
              const value = event.target.value;
              if (value === '') return;
              onCategoryChange(value === 'none' ? null : Number(value));
              event.target.value = '';
            }}
            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
            defaultValue=""
          >
            <option value="" disabled>カテゴリ変更</option>
            <option value="none">なし</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <select
            onChange={(event) => {
              const value = event.target.value;
              if (value === '') return;
              onGroupChange(value === 'none' ? null : Number(value));
              event.target.value = '';
            }}
            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
            defaultValue=""
          >
            <option value="" disabled>グループ変更</option>
            <option value="none">なし</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
          <button
            onClick={onPurchased}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
          >
            <ShoppingBag size={16} />
            購入済み
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
