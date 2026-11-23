'use client';

import { useDesktopWorkspace } from '../design/DesktopWorkspace';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import RegistrationSheet from '@/components/design/RegistrationSheet';
import { useSensors, useSensor, PointerSensor, KeyboardSensor, DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CheckSquare, Ellipsis, GalleryVerticalEnd, Rows3, RefreshCw, Upload, X } from 'lucide-react';
import AddItemForm from '@/components/AddItemForm';
import PhotoGroupCard from '@/components/PhotoGroupCard';
import SortableItemCard from '@/components/SortableItemCard';
import HomeAgendaSummary from '@/components/home/HomeAgendaSummary';
import HomeFilterPanel from '@/components/home/HomeFilterPanel';
import type { ReviewView } from '@/lib/design-home';
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

export default function ListManagementView({
  managementOnly = false,
  returnView,
  items,
  filteredItems,
  wishlist,
  totalAmount,
  productCount,
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
  onBudget,
  onRefreshAll,
  onViewRegistered,
  onDragEnd,
  refreshing,
  isGuest,
  dragEnabled,
  lowestPriceInGroup,
  embedded = false,
  activeIntegration = true,
  compactList,
  bulkActions,
  onSelectCompact,
}: {
  managementOnly?: boolean;
  returnView?: ReviewView;
  items: Item[];
  filteredItems: Item[];
  wishlist: WishlistRow<Item>[];
  totalAmount: number;
  productCount?: number;
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
  onBudget?: () => void;
  onRefreshAll: () => void;
  onViewRegistered: (location: RegisteredLocation) => void;
  onDragEnd: (event: DragEndEvent) => void;
  refreshing: boolean;
  isGuest: boolean;
  dragEnabled: boolean;
  lowestPriceInGroup: number | null;
  embedded?: boolean;
  activeIntegration?: boolean;
  compactList?: ReactNode;
  bulkActions?: ReactNode;
  onSelectCompact?: () => void;
}) {
  const desktop = useDesktopWorkspace();
  const [layout, setLayout] = useState<'list' | 'shelf'>('list');
  const [registrationOpen,setRegistrationOpen]=useState(false);
  const [registered,setRegistered]=useState('');
  const trigger=useRef<HTMLElement|null>(null);
  const toolsMenu=useRef<HTMLDetailsElement|null>(null);
  function closeRegistration() {
    setRegistrationOpen(false);
    requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));
  }
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
    <div className={embedded&&!activeIntegration ? 'integrated-list-pass-through' : 'agenda-list space-y-4'+(embedded?' integrated-list':'')}>
      {!managementOnly && !loading && !loadError && <HomeAgendaSummary items={items} productCount={productCount ?? items.length} total={totalAmount} onBudget={onBudget} />}

      {(!embedded || (activeIntegration && isFilterOpen)) && <HomeFilterPanel
        inline={embedded}
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
      />}

      {embedded && activeIntegration && <div className="integrated-list-tools">
        <div role="group" aria-label="商品の表示" className="agenda-layout-choices">
          <button type="button" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}><Rows3 size={16}/>一覧</button>
          <button type="button" aria-pressed={layout==='shelf'} onClick={()=>setLayout('shelf')}><GalleryVerticalEnd size={16}/>写真棚</button>
        </div>
        <div className="integrated-list-actions">
          {selectionMode ? <>
            <button type="button" onClick={layout==='list' ? onSelectCompact : onSelectAll}>全選択</button>
            <button type="button" onClick={onDeselectAll}>選択解除</button>
            <button type="button" onClick={onToggleSelectionMode} aria-label="選択を終了"><X size={16}/>完了</button>
          </> : <button type="button" onClick={onToggleSelectionMode} disabled={!items.length}><CheckSquare size={16}/>選択</button>}
          <details ref={toolsMenu} className="integrated-tools-menu" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();toolsMenu.current?.removeAttribute('open');toolsMenu.current?.querySelector('summary')?.focus();}}}>
            <summary role="button" aria-label="リストの操作"><Ellipsis size={20}/></summary>
            <div>
              <button type="button" onClick={()=>{toolsMenu.current?.removeAttribute('open');onImport();}} disabled={isGuest}><Upload size={16}/>インポート</button>
              <button type="button" onClick={()=>{toolsMenu.current?.removeAttribute('open');onRefreshAll();}} disabled={isGuest||refreshing||!items.length}><RefreshCw size={16}/>価格を更新</button>
            </div>
          </details>
        </div>
      </div>}
      {embedded && activeIntegration && (searchQuery || selectedCategory || selectedPriority || selectedGroup || sortBy!=='priority') &&
        <div className="integrated-filter-status"><span>{wishlist.length}商品</span><button type="button" onClick={onClearFilters}><X size={14}/>条件をクリア</button></div>}

      {!embedded && <><div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
          {selectionMode
            ? `${selectedCount}件選択中`
            : `ほしいものリスト (${wishlist.length}件${selectedCategory ? ` / 全${productCount ?? items.length}件` : ''})`
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

      {registered && <p role="status" className="mb-3">{registered}</p>}
      {registrationOpen && createPortal(<div className="design-review registration-surface"><RegistrationSheet
        groups={groups} categories={categories} isGuest={isGuest} onCancel={closeRegistration}
        onSaved={message=>{closeRegistration();setRegistered(message);onPhotoChanged();}}
        onExisting={location=>{closeRegistration();onViewRegistered(location);}}/></div>,document.body)}
      <AddItemForm
        onOpenRegistration={managementOnly ? ()=>{if(desktop.active){desktop.openRegistration();return;}trigger.current=document.activeElement as HTMLElement;setRegistered('');setRegistrationOpen(true);} : undefined}
        returnView={returnView}
        onViewRegistered={onViewRegistered}
        onAdd={onItemsChanged}
        comparisonGroups={groups}
        categories={categories}
      />

      <div className="agenda-display-tools">
        <div role="group" aria-label="リストの表示" className="agenda-layout-choices">
          <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><Rows3 size={16} />一覧</button>
          <button type="button" aria-pressed={layout === 'shelf'} onClick={() => setLayout('shelf')}><GalleryVerticalEnd size={16} />写真棚</button>
        </div>
        {groups.length > 0 && <label className="agenda-compare-picker">比較グループ
          <select aria-label="比較グループ" value={selectedGroup ?? ''} onChange={event => onSelectedGroup(event.target.value ? Number(event.target.value) : null)}>
            <option value="">すべて</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>}
      </div>
      </>}

      {embedded && <div hidden={activeIntegration&&layout!=='list'}>{compactList}</div>}
      <div hidden={embedded&&(!activeIntegration||layout==='list')}>
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
              strategy={layout === 'shelf' ? rectSortingStrategy : verticalListSortingStrategy}
            >
              <div className={layout === 'shelf' ? 'agenda-product-grid' : 'agenda-product-list'}>
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
      {embedded && activeIntegration && bulkActions}
    </div>
  );
}
