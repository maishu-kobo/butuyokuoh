'use client';

import { apiFetch } from '@/lib/api-fetch';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { useSwipeable } from 'react-swipeable';
import { Item, ComparisonGroup, Category } from '@/types';
import { usePagedItems } from '@/lib/use-paged-items';
import { itemPageKey, selectedItemPageIds } from '@/lib/item-page-client';
import { wishlistRows } from '@/lib/capture/list-card';
import { homeListDragOrders } from '@/lib/home-list-page';
import BudgetView from '@/components/BudgetView';
import PurchasedHistory from '@/components/PurchasedHistory';
import StatsView from '@/components/StatsView';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';
import TrashView from '@/components/TrashView';
import ImportWishlistModal from '@/components/ImportWishlistModal';
import HomeBulkBar from '@/components/home/HomeBulkBar';
import HomeHeader from '@/components/home/HomeHeader';
import HomeListView from '@/components/home/HomeListView';
import HomeTabNav from '@/components/home/HomeTabNav';
import { useHomeSwipeRef } from '@/lib/home-tab-swipe';
import {
  homeDragEnabled,
  homeTabAnimation,
  homeTabBySwipe,
  type HomeListQuery,
  type HomeSortBy,
  type HomeTab,
} from '@/lib/home-wishlist';

export default function Home() {
  const { user, isGuest, loading: authLoading, logout } = useAuth();
  const [purchasedItems, setPurchasedItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<HomeTab>('list');
  const [animationClass, setAnimationClass] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<HomeSortBy>('priority');
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<{ key: string; ids: Set<number> }>({ key: '', ids: new Set() });
  const listQuery: HomeListQuery = useMemo(() => ({
    selectedCategory, selectedPriority, selectedGroup, searchQuery, sortBy,
  }), [selectedCategory, selectedPriority, selectedGroup, searchQuery, sortBy]);
  const { state: pageState, reload: fetchItems, more: fetchMore } = usePagedItems(listQuery, user?.id ?? null);
  const page = pageState.page;
  const items = page?.items ?? [];
  const filteredItems = items;
  const loading = pageState.loading;
  const loadError = pageState.error;
  const selectionKey = itemPageKey(listQuery, user?.id ?? null);
  if (selection.key !== selectionKey) setSelection({ key: selectionKey, ids: new Set() });
  const selectedItems = useMemo(() => selectedItemPageIds(selection, selectionKey, page), [selection, selectionKey, page]);
  const setSelectedItems = useCallback((value: Set<number> | ((previous: Set<number>) => Set<number>)) => {
    setSelection(current => ({ key: selectionKey, ids: typeof value === 'function'
      ? value(selectedItemPageIds(current, selectionKey, page)) : value }));
  }, [selectionKey, page]);

  // 補助データ: 失敗しても空配列のままにしてクラッシュを防ぐ（エラーUIは出さない）
  const fetchPurchased = useCallback(async () => {
    try {
      const res = await apiFetch('/api/purchased');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.items)) setPurchasedItems(data.items);
    } catch (error) {
      console.error('Failed to fetch purchased items:', error);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await apiFetch('/api/comparison-groups');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setGroups(data);
    } catch (error) {
      console.error('Failed to fetch comparison groups:', error);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await apiFetch('/api/categories');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setCategories(data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  }, []);

  // 読み込み失敗時の再試行（補助データも併せて再取得）
  const handleRetry = () => {
    fetchItems();
    fetchPurchased();
    fetchGroups();
    fetchCategories();
  };

  useEffect(() => {
    if (!user) return;
    // 取得関数の中の setState は await のあと。effect から直接呼ぶと新しい react-hooks が同期 setState と誤認する。
    // 各関数は今までどおり同時に始める。
    void (async () => { await fetchPurchased(); })();
    void (async () => { await fetchGroups(); })();
    void (async () => { await fetchCategories(); })();
  }, [user, fetchPurchased, fetchGroups, fetchCategories]);

  const handleDelete = useCallback(async (id: number) => {
    await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    fetchItems();
  }, [fetchItems]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all((page?.allIds ?? []).map((id) =>
        apiFetch(`/api/items/${id}/refresh`, { method: 'POST' })
      ));
      fetchItems();
    } finally {
      setRefreshing(false);
    }
  };

  // Partial lists cannot safely rewrite sort positions of unseen items.
  const dragEnabled = homeDragEnabled(listQuery) && Boolean(page) && !page?.nextCursor && !loading;
  const wishlist = useMemo(
    () => wishlistRows(filteredItems, groups, purchasedItems),
    [filteredItems, groups, purchasedItems],
  );

  // ドラッグ終了時のハンドラ
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!dragEnabled || !over || active.id === over.id) return;

    const newSortOrders = homeListDragOrders(filteredItems, Number(active.id), Number(over.id));
    if (!newSortOrders) return;

    // バックグラウンドでAPIを一括更新
    try {
      await Promise.all(
        Array.from(newSortOrders.entries()).map(([id, sort_order]) =>
          apiFetch(`/api/items/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order }),
          }).then(response => { if (!response.ok) throw new Error('Reorder failed'); })
        )
      );
      await fetchItems();
    } catch (error) {
      // エラー時は再取得して整合性を保つ
      console.error('Failed to update sort order:', error);
      fetchItems();
    }
  };

  // 選択モードのトグル
  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedItems(new Set());
  };

  // アイテムの選択トグル。描画のたびに関数を新しくすると、メモしたカードが全部描き直される。
  const toggleItemSelection = useCallback((id: number) => {
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setSelectedItems]);

  // 全選択。画面に出ていない絞り込み結果も含む。
  const selectAll = () => {
    setSelectedItems(new Set(page?.matchedIds ?? []));
  };

  // 選択解除
  const deselectAll = () => {
    setSelectedItems(new Set());
  };

  // 一括削除
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    if (!confirm(`${selectedItems.size}件のアイテムを削除しますか？`)) return;

    await Promise.all(
      Array.from(selectedItems).map(id =>
        apiFetch(`/api/items/${id}`, { method: 'DELETE' })
      )
    );
    setSelectedItems(new Set());
    fetchItems();
  };

  // 一括カテゴリ変更
  const handleBulkCategoryChange = async (categoryId: number | null) => {
    if (selectedItems.size === 0) return;

    await Promise.all(
      Array.from(selectedItems).map(id =>
        apiFetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category_id: categoryId }),
        })
      )
    );
    setSelectedItems(new Set());
    fetchItems();
  };

  // 一括グループ変更
  const handleBulkGroupChange = async (groupId: number | null) => {
    if (selectedItems.size === 0) return;

    await Promise.all(
      Array.from(selectedItems).map(id =>
        apiFetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comparison_group_id: groupId }),
        })
      )
    );
    setSelectedItems(new Set());
    fetchItems();
  };

  // 一括購入済み
  const handleBulkPurchased = async () => {
    if (selectedItems.size === 0) return;
    if (!confirm(`${selectedItems.size}件のアイテムを購入済みにしますか？`)) return;

    await Promise.all(
      Array.from(selectedItems).map(id =>
        apiFetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_purchased: true }),
        })
      )
    );
    setSelectedItems(new Set());
    setSelectionMode(false);
    fetchItems();
  };

  // タブ切り替え関数
  const changeTab = (newTab: HomeTab, direction?: 'left' | 'right') => {
    const animation = homeTabAnimation(activeTab, newTab, direction);
    if (!animation) return;
    setAnimationClass(animation);
    setActiveTab(newTab);
    setTimeout(() => setAnimationClass(''), 200);
  };

  // スワイプでタブ切り替え。ref は描画ごとに新しい関数へ付け替えない。
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const next = homeTabBySwipe(activeTab, 'left');
      if (next) changeTab(next, 'left');
    },
    onSwipedRight: () => {
      const next = homeTabBySwipe(activeTab, 'right');
      if (next) changeTab(next, 'right');
    },
    trackMouse: false,
    preventScrollOnSwipe: true,
    delta: 30,
    swipeDuration: 500,
    touchEventOptions: { passive: false },
  });
  const swipeRef = useHomeSwipeRef(swipeHandlers.ref);

  // フィルター・検索・並び順をすべて初期値に戻す
  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategory(null);
    setSelectedPriority(null);
    setSelectedGroup(null);
    setSortBy('priority');
    // 選択モードを解除（クリア後に見えないアイテムへの一括操作を防ぐ）
    setSelectionMode(false);
    setSelectedItems(new Set());
  };

  // 合計金額計算。写真グループはサーバーが付けた印の付いた1件だけを足す。
  const totalAmount = page?.totalAmount ?? 0;
  // 比較グループフィルター時の最安価格
  const lowestPriceInGroup = page?.lowestPriceInGroup ?? null;
  const refreshPhotoCard = useCallback(() => {
    void fetchItems();
    void fetchPurchased();
  }, [fetchItems, fetchPurchased]);

  // 認証チェック
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--kinari)] flex items-center justify-center">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  return (
    <div ref={swipeRef} className="min-h-screen bg-[var(--kinari)] dark:bg-slate-900">
      <HomeHeader user={user} onLogout={logout} />
      <HomeTabNav activeTab={activeTab} onChange={changeTab} onOpenList={fetchItems} />

      <main className="max-w-4xl mx-auto px-4 py-6 overflow-clip">
        <div className={animationClass}>
          {activeTab === 'list' && (
            <HomeListView
              items={items}
              filteredItems={filteredItems}
              wishlist={wishlist}
              totalAmount={totalAmount}
              paging={{ totalCount: page?.totalCount ?? 0, matchedCount: page?.matchedCount ?? 0,
                hasMore: Boolean(page?.nextCursor), moreLoading: pageState.moreLoading,
                moreError: pageState.moreError, notice: pageState.notice, onMore: fetchMore }}
              loading={loading}
              loadError={loadError}
              categories={categories}
              groups={groups}
              searchQuery={searchQuery}
              onSearchQuery={setSearchQuery}
              sortBy={sortBy}
              onSortBy={setSortBy}
              selectedPriority={selectedPriority}
              onSelectedPriority={setSelectedPriority}
              selectedCategory={selectedCategory}
              onSelectedCategory={setSelectedCategory}
              selectedGroup={selectedGroup}
              onSelectedGroup={setSelectedGroup}
              isFilterOpen={isFilterOpen}
              onToggleFilter={() => setIsFilterOpen(!isFilterOpen)}
              selectionMode={selectionMode}
              selectedCount={selectedItems.size}
              selectedItems={selectedItems}
              onToggleSelectionMode={toggleSelectionMode}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onClearFilters={clearFilters}
              onRetry={handleRetry}
              onDelete={handleDelete}
              onToggleSelect={toggleItemSelection}
              onItemsChanged={fetchItems}
              onPhotoChanged={refreshPhotoCard}
              onImport={() => setShowImportModal(true)}
              onRefreshAll={handleRefreshAll}
              onViewRegistered={(location) => {
                clearFilters();
                changeTab(location);
                if (location === 'list') void fetchItems();
              }}
              onDragEnd={handleDragEnd}
              refreshing={refreshing}
              isGuest={isGuest}
              dragEnabled={dragEnabled}
              lowestPriceInGroup={lowestPriceInGroup}
            />
          )}

          {activeTab === 'budget' && <BudgetView />}

          {activeTab === 'purchased' && <PurchasedHistory />}

          {activeTab === 'stats' && <StatsView />}

          {activeTab === 'trash' && <TrashView />}
        </div>
      </main>

      {!loading && selectionMode && selectedItems.size > 0 && (
        <HomeBulkBar
          count={selectedItems.size}
          categories={categories}
          groups={groups}
          onCategoryChange={handleBulkCategoryChange}
          onGroupChange={handleBulkGroupChange}
          onPurchased={handleBulkPurchased}
          onDelete={handleBulkDelete}
        />
      )}

      <ImportWishlistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={fetchItems}
      />
    </div>
  );
}
