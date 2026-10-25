'use client';

import { ArrowUpDown, ChevronDown, ChevronUp, Layers, Search, SlidersHorizontal } from 'lucide-react';
import type { Category, ComparisonGroup } from '@/types';
import type { HomeSortBy } from '@/lib/home-wishlist';

export default function HomeFilterPanel({
  isOpen,
  onToggle,
  searchQuery,
  onSearchQuery,
  sortBy,
  onSortBy,
  selectedPriority,
  onSelectedPriority,
  categories,
  selectedCategory,
  onSelectedCategory,
  groups,
  selectedGroup,
  onSelectedGroup,
}: {
  isOpen: boolean;
  onToggle: () => void;
  searchQuery: string;
  onSearchQuery: (value: string) => void;
  sortBy: HomeSortBy;
  onSortBy: (value: HomeSortBy) => void;
  selectedPriority: number | null;
  onSelectedPriority: (value: number | null) => void;
  categories: Category[];
  selectedCategory: number | null;
  onSelectedCategory: (value: number | null) => void;
  groups: ComparisonGroup[];
  selectedGroup: number | null;
  onSelectedGroup: (value: number | null) => void;
}) {
  const filtering = Boolean(searchQuery || selectedCategory || selectedPriority || selectedGroup || sortBy !== 'priority');

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-slate-600 dark:text-slate-300 hover:bg-[var(--kinari)] dark:hover:bg-slate-700 transition-colors rounded-2xl"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-slate-400" />
          <span className="text-sm font-medium">検索・フィルター</span>
          {filtering && (
            <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-medium rounded-full">
              適用中
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-700">
          <div className="relative pt-3">
            <Search className="absolute left-3 top-1/2 translate-y-0.5 text-slate-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQuery(event.target.value)}
              placeholder="商品名、メモ、カテゴリで検索..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ArrowUpDown size={16} className="text-slate-500 dark:text-slate-400" />
              <select
                value={sortBy}
                onChange={(event) => onSortBy(event.target.value as HomeSortBy)}
                className="px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="priority">優先度順</option>
                <option value="price_asc">価格が安い順</option>
                <option value="price_desc">価格が高い順</option>
                <option value="date_new">新しい順</option>
                <option value="date_old">古い順</option>
                <option value="name">名前順</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500 dark:text-slate-400">優先度:</span>
              <select
                value={selectedPriority || ''}
                onChange={(event) => onSelectedPriority(event.target.value ? Number(event.target.value) : null)}
                className="px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">すべて</option>
                <option value="1">最高</option>
                <option value="2">高</option>
                <option value="3">普通</option>
                <option value="4">低</option>
                <option value="5">最低</option>
              </select>
            </div>
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === null
                    ? 'bg-[var(--shu)] text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                すべて
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => onSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedCategory === cat.id
                      ? 'text-white'
                      : 'hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: selectedCategory === cat.id ? cat.color : `${cat.color}20`,
                    color: selectedCategory === cat.id ? 'white' : cat.color,
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                <Layers size={16} />
                <span>比較:</span>
              </div>
              <button
                onClick={() => onSelectedGroup(null)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedGroup === null
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                すべて
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => onSelectedGroup(group.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selectedGroup === group.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                  }`}
                >
                  {group.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
