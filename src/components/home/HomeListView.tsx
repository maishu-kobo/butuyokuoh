'use client';

import { useState } from 'react';
import { useSensors, useSensor, PointerSensor, KeyboardSensor, DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CheckSquare, RefreshCw, Upload, X } from 'lucide-react';
import AddItemForm from '@/components/AddItemForm';
import PhotoGroupCard from '@/components/PhotoGroupCard';
import SortableItemCard from '@/components/SortableItemCard';
import HomeFilterPanel from '@/components/home/HomeFilterPanel';
import { photoFaceItemId } from '@/lib/capture/photo-card-view';
import type { WishlistRow } from '@/lib/capture/list-card';
import type { RegisteredLocation } from '@/lib/capture/register';
import {
  alignHomeListPage,
  createHomeListPage,
  homeListHasMore,
  homeListQueryPageKey,
  reduceHomeListPage,
  visibleWishlistRows,
} from '@/lib/home-list-page';
import type { HomeSortBy } from '@/lib/home-wishlist';
import type { Category, ComparisonGroup, Item } from '@/types';

export default function HomeListView({
  items,
  filteredItems,
  wishlist,
  totalAmount,
  loading,
  loadError,
  categories,
  groups,
  searchQuery,
  onSearchQuery,
  sortBy,
  onSortBy,
  selectedPriority,
  onSelectedPriority,
  selectedCategory,
  onSelectedCategory,
  selectedGroup,
  onSelectedGroup,
  isFilterOpen,
  onToggleFilter,
  selectionMode,
  selectedCount,
  selectedItems,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onClearFilters,
  onRetry,
  onDelete,
  onToggleSelect,
  onItemsChanged,
  onPhotoChanged,
  onImport,
  onRefreshAll,
  onViewRegistered,
  onDragEnd,
  refreshing,
  isGuest,
  dragEnabled,
  lowestPriceInGroup,
}: {
  items: Item[];
  filteredItems: Item[];
  wishlist: WishlistRow<Item>[];
  totalAmount: number;
  loading: boolean;
  loadError: boolean;
  categories: Category[];
  groups: ComparisonGroup[];
  searchQuery: string;
  onSearchQuery: (value: string) => void;
  sortBy: HomeSortBy;
  onSortBy: (value: HomeSortBy) => void;
  selectedPriority: number | null;
  onSelectedPriority: (value: number | null) => void;
  selectedCategory: number | null;
  onSelectedCategory: (value: number | null) => void;
  selectedGroup: number | null;
  onSelectedGroup: (value: number | null) => void;
  isFilterOpen: boolean;
  onToggleFilter: () => void;
  selectionMode: boolean;
  selectedCount: number;
  selectedItems: Set<number>;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClearFilters: () => void;
  onRetry: () => void;
  onDelete: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onItemsChanged: () => void;
  onPhotoChanged: () => void;
  onImport: () => void;
  onRefreshAll: () => void;
  onViewRegistered: (location: RegisteredLocation) => void;
  onDragEnd: (event: DragEndEvent) => void;
  refreshing: boolean;
  isGuest: boolean;
  dragEnabled: boolean;
  lowestPriceInGroup: number | null;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const cardDragEnabled = dragEnabled && !selectionMode;
  const queryKey = homeListQueryPageKey({
    selectedCategory,
    selectedPriority,
    selectedGroup,
    searchQuery,
    sortBy,
  });
  const [listWindow, setListWindow] = useState(() => ({ key: queryKey, page: createHomeListPage() }));
  const alignedWindow = alignHomeListPage(listWindow, queryKey);
  if (alignedWindow !== listWindow) setListWindow(alignedWindow);
  const visibleRows = visibleWishlistRows(filteredItems, wishlist, alignedWindow.page);
  const hasMore = homeListHasMore(alignedWindow.page, filteredItems.length);
  const showMore = () => {
    setListWindow((current) => {
      const page = current.key === queryKey ? current.page : createHomeListPage();
      return {
        key: queryKey,
        page: reduceHomeListPage(page, { type: 'show-more', total: filteredItems.length }),
      };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm px-4 py-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">アイテム数</p>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{items.length}<span className="text-sm font-normal text-slate-500 dark:text-slate-400 ml-0.5">件</span></p>
        </div>
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm px-4 py-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">合計金額</p>
          <p className="text-xl font-bold text-orange-500">¥{totalAmount.toLocaleString()}</p>
        </div>
      </div>

      <HomeFilterPanel
        isOpen={isFilterOpen}
        onToggle={onToggleFilter}
        searchQuery={searchQuery}
        onSearchQuery={onSearchQuery}
        sortBy={sortBy}
        onSortBy={onSortBy}
        selectedPriority={selectedPriority}
        onSelectedPriority={onSelectedPriority}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectedCategory={onSelectedCategory}
        groups={groups}
        selectedGroup={selectedGroup}
        onSelectedGroup={onSelectedGroup}
      />

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
          {selectionMode
            ? `${selectedCount}件選択中`
            : `ほしいものリスト (${filteredItems.length}件${selectedCategory ? ` / 全${items.length}件` : ''})`
          }
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {selectionMode ? (
            <>
              <button
                onClick={onSelectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
              >
                全選択
              </button>
              <button
                onClick={onDeselectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
              >
                選択解除
              </button>
              <button
                onClick={onToggleSelectionMode}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                <X size={16} />
                キャンセル
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onToggleSelectionMode}
                disabled={items.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <CheckSquare size={16} />
                選択
              </button>
              <button
                disabled={isGuest}
                title={isGuest ? 'インポートはログイン後に利用できます' : undefined}
                onClick={onImport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <Upload size={16} />
                インポート
              </button>
              <button
                onClick={onRefreshAll}
                disabled={isGuest || refreshing || items.length === 0}
                title={isGuest ? '価格更新はログイン後に利用できます' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                全て更新
              </button>
            </>
          )}
        </div>
      </div>

      <AddItemForm
        onViewRegistered={onViewRegistered}
        onAdd={onItemsChanged}
        comparisonGroups={groups}
        categories={categories}
      />

      {loading ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">読み込み中...</div>
      ) : loadError ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <p>読み込みに失敗しました</p>
          <button
            onClick={onRetry}
            className="mt-3 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
          >
            再試行
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          まだアイテムがありません。上のフォームから追加してください。
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <p>条件に一致するアイテムがありません</p>
          <button
            onClick={onClearFilters}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
          >
            <X size={16} />
            条件をクリア
          </button>
        </div>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={visibleRows.flatMap((row) => row.kind === 'item' ? [row.item.id] : [photoFaceItemId(row)])}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {visibleRows.map((row) => row.kind === 'item' ? (
                  <SortableItemCard
                    key={row.item.id}
                    item={row.item}
                    onUpdate={onItemsChanged}
                    onDelete={onDelete}
                    categories={categories}
                    comparisonGroups={groups}
                    isLowestPrice={selectedGroup !== null && lowestPriceInGroup !== null && row.item.current_price === lowestPriceInGroup}
                    isDragEnabled={cardDragEnabled}
                    selectionMode={selectionMode}
                    isSelected={selectedItems.has(row.item.id)}
                    onToggleSelect={onToggleSelect}
                  />
                ) : (
                  <PhotoGroupCard
                    key={`photo-${row.groupId}`}
                    card={row}
                    item={filteredItems.find((entry) => entry.id === photoFaceItemId(row))!}
                    onUpdate={onPhotoChanged}
                    categories={categories}
                    comparisonGroups={groups}
                    isDragEnabled={cardDragEnabled}
                    selectionMode={selectionMode}
                    isSelected={selectedItems.has(photoFaceItemId(row))}
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {hasMore && (
            <div className="text-center">
              <button
                type="button"
                onClick={showMore}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
              >
                もっと見る
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
