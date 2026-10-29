'use client';

import { useId } from 'react';
import { ChevronDown, ChevronUp, Search, SlidersHorizontal } from 'lucide-react';
import type { Category, ComparisonGroup } from '@/types';
import type { HomeSortBy } from '@/lib/home-wishlist';

export default function HomeFilterPanel({
  isOpen, onToggle, searchQuery, onSearchQuery, sortBy, onSortBy,
  selectedPriority, onSelectedPriority, categories, selectedCategory,
  onSelectedCategory, groups, selectedGroup, onSelectedGroup,
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
  const panelId = useId();
  const filtering = Boolean(searchQuery || selectedCategory !== null || selectedPriority !== null || selectedGroup !== null || sortBy !== 'priority');
  return (
    <section className="home-filter" aria-label="検索・フィルター">
      <div className="home-search-row">
        <label className="home-search">
          <span className="sr-only">商品名、メモ、カテゴリで検索</span>
          <Search size={18} aria-hidden="true" />
          <input type="search" value={searchQuery}
            onChange={(event) => onSearchQuery(event.target.value)}
            placeholder="商品名、メモ、カテゴリで検索" />
        </label>
        <button type="button" className="home-filter-toggle" onClick={onToggle}
          aria-expanded={isOpen} aria-controls={panelId}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          絞り込み{filtering ? ' 適用中' : ''}
          {isOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
      </div>
      <label className="home-sort">
        並び順
        <select aria-label="並び順" value={sortBy} onChange={(event) => onSortBy(event.target.value as HomeSortBy)}>
          <option value="priority">優先度順</option>
          <option value="price_asc">価格が安い順</option>
          <option value="price_desc">価格が高い順</option>
          <option value="date_new">新しい順</option>
          <option value="date_old">古い順</option>
          <option value="name">名前順</option>
        </select>
      </label>
      <div id={panelId} hidden={!isOpen} className="home-filter-details">
        <label className="home-sort">
          優先度
          <select aria-label="優先度" value={selectedPriority ?? ''}
            onChange={(event) => onSelectedPriority(event.target.value ? Number(event.target.value) : null)}>
            <option value="">すべて</option>
            <option value="1">最高</option><option value="2">高</option>
            <option value="3">普通</option><option value="4">低</option><option value="5">最低</option>
          </select>
        </label>
        {categories.length > 0 && (
          <fieldset className="home-filter-group">
            <legend>カテゴリ</legend>
            <div>
              <button type="button" aria-pressed={selectedCategory === null}
                onClick={() => onSelectedCategory(null)}>すべて</button>
              {categories.map((cat) => (
                <button type="button" key={cat.id} aria-pressed={selectedCategory === cat.id}
                  onClick={() => onSelectedCategory(cat.id)}>
                  <span aria-hidden="true" className="home-category-dot" style={{ backgroundColor: cat.color }} />
                  {cat.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {groups.length > 0 && (
          <fieldset className="home-filter-group">
            <legend>比較グループ</legend>
            <div>
              <button type="button" aria-pressed={selectedGroup === null}
                onClick={() => onSelectedGroup(null)}>すべて</button>
              {groups.map((group) => (
                <button type="button" key={group.id} aria-pressed={selectedGroup === group.id}
                  onClick={() => onSelectedGroup(group.id)}>{group.name}</button>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </section>
  );
}
