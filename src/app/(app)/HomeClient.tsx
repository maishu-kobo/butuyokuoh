'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import DesignWorkbench from '@/components/design/DesignWorkbench';
import DesktopPage from '@/components/design/DesktopPage';
import { readListPreview } from '@/lib/design-list-preview';
import UiVersionSwitch from '@/components/design/UiVersionSwitch';
import { filterReviewItems, readReviewView, reviewHref, reviewSettingsHref } from '@/lib/design-home';
import { useDesktopWorkspace } from '@/components/design/DesktopWorkspace';
import { useTheme } from '@/components/ThemeProvider';
import ListManagementView from '@/components/home/ListManagementView';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-fetch';

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { useSwipeable } from 'react-swipeable';
import { Item, ComparisonGroup, Category } from '@/types';
import { sumCountedPrices } from '@/lib/photo-spend';
import { wishlistRows } from '@/lib/capture/list-card';
import { homeListDragOrders, selectAllFilteredIds } from '@/lib/home-list-page';
import { bulkPurchaseItems } from '@/lib/bulk-purchase';
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
import McpConnectionCard from '@/components/mcp/McpConnectionCard';
import { useHomeSwipeRef } from '@/lib/home-tab-swipe';
import {
  HOME_TABS,
  filterHomeItems,
  homeDragEnabled,
  homeTabAnimation,
  homeTabBySwipe,
  lowestPriceInSelectedGroup,
  type HomeListQuery,
  type HomeSortBy,
  type HomeTab,
} from '@/lib/home-wishlist';

export default function HomeClient({ mcpUrl, designReview = false }: { mcpUrl: string; designReview?: boolean }) {
  const { user, isGuest, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [budgetRevision, setBudgetRevision] = useState(0);
  const [purchasedItems, setPurchasedItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const designTab = designReview ? requestedTab : null;
  const reviewView = readReviewView(searchParams.get('view'));
  const { palette, resolvedTheme: appearance } = useTheme();
  const desktop = useDesktopWorkspace();
  const integrated = designReview && desktop.active && desktop.layout === 'reading';
  const ListView = designReview ? ListManagementView : HomeListView;
  const listPreview = readListPreview(searchParams.get('list'));
  const fromSettings=designReview && designTab==='agents' && searchParams.get('from')==='settings';
  const activeTab: HomeTab = HOME_TABS.find(tab => tab === requestedTab) ?? 'list';
  const [animationClass, setAnimationClass] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<HomeSortBy>('priority');
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null);
  const [selectedPriorities, setSelectedPriorities] = useState<number[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const fetchItems = useCallback(async () => {
    try {
      const res = await apiFetch(designReview ? '/api/items?with=buy-guide' : '/api/items');
      if (!res.ok) throw new Error(`Failed to fetch items: ${res.status}`);
      const data = await res.json();
      // 非配列レスポンス（エラーJSON等）を配列stateに入れない
      if (!Array.isArray(data)) throw new Error('Unexpected response format');
      setItems(data);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to fetch items:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [designReview]);

  useEffect(() => {
    if (!user) return;
    const refreshListOnBack = () => {
      const tab = new URL(window.location.href).searchParams.get('tab');
      if (!tab || tab === 'list') void fetchItems();
    };
    window.addEventListener('popstate', refreshListOnBack);
    return () => window.removeEventListener('popstate', refreshListOnBack);
  }, [user, fetchItems]);

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
    setLoadError(false);
    setLoading(true);
    fetchItems();
    fetchPurchased();
    fetchGroups();
    fetchCategories();
  };

  useEffect(() => {
    if (!user) return;
    // 取得関数の中の setState は await のあと。effect から直接呼ぶと新しい react-hooks が同期 setState と誤認する。
    // 各関数は今までどおり同時に始める。
    void (async () => { await fetchItems(); })();
    void (async () => { await fetchPurchased(); })();
    void (async () => { await fetchGroups(); })();
    void (async () => { await fetchCategories(); })();
  }, [user, fetchItems, fetchPurchased, fetchGroups, fetchCategories, designTab]);

  const handleDelete = useCallback(async (id: number) => {
    const response = await apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    if (!response.ok) return;
    await fetchItems();
    setBudgetRevision(value => value + 1);
  }, [fetchItems]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all(items.map((item) =>
        apiFetch(`/api/items/${item.id}/refresh`, { method: 'POST' })
      ));
      if (integrated) await reloadReview();
      else await fetchItems();
    } finally {
      setRefreshing(false);
    }
  };

  const listQuery: HomeListQuery = useMemo(() => ({
    selectedCategory,
    selectedPriority,
    selectedGroup,
    searchQuery,
    sortBy,
  }), [selectedCategory, selectedPriority, selectedGroup, searchQuery, sortBy]);
  const priorityOptionsItems = useMemo(() => designReview ? filterReviewItems(items, groups, listQuery, purchasedItems) : filterHomeItems(items, listQuery), [items, groups, listQuery, designReview, purchasedItems]);
  const filteredItems = useMemo(() => designReview && selectedPriorities.length
    ? filterReviewItems(items, groups, {...listQuery, priorities:selectedPriorities}, purchasedItems) : priorityOptionsItems,
  [items,groups,listQuery,designReview,selectedPriorities,priorityOptionsItems,purchasedItems]);
  const changePriorities = (priorities:number[]) => {
    setSelectedPriorities(priorities);
    setSelectedPriority(null);
    setSelectedItems(new Set());
  };
  // ドラッグ&ドロップが有効かどうか（優先度順で、絞り込みが無いときだけ）
  const dragEnabled = homeDragEnabled(listQuery);
  const wishlist = useMemo(
    () => wishlistRows(filteredItems, groups, purchasedItems),
    [filteredItems, groups, purchasedItems],
  );

  const productCount = useMemo(() => wishlistRows(items, groups, purchasedItems).length, [items, groups, purchasedItems]);

  // ドラッグ終了時のハンドラ
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const newSortOrders = homeListDragOrders(filteredItems, Number(active.id), Number(over.id));
    if (!newSortOrders) return;

    // 楽観的更新: 即座にローカル状態を更新
    setItems(prevItems =>
      prevItems.map(item => ({
        ...item,
        sort_order: newSortOrders.has(item.id) ? newSortOrders.get(item.id)! : item.sort_order,
      }))
    );

    // バックグラウンドでAPIを一括更新
    try {
      await Promise.all(
        Array.from(newSortOrders.entries()).map(([id, sort_order]) =>
          apiFetch(`/api/items/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order }),
          })
        )
      );
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
  }, []);
  const toggleMatchingSelection = useCallback((ids: number[]) => {
    setSelectedItems(current => {
      const next = new Set(current);
      if (ids.every(id => current.has(id))) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }, []);

  // 全選択。画面に出ていない絞り込み結果も含む。
  const selectAll = () => {
    setSelectedItems(new Set(selectAllFilteredIds(filteredItems)));
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
    if (integrated) await reloadReview();
    else await fetchItems();
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
    if (integrated) await reloadReview();
    else await fetchItems();
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
    if (integrated) await reloadReview();
    else await fetchItems();
  };

  // 一括購入済み
  const handleBulkPurchased = async () => {
    const purchaseItems = bulkPurchaseItems(items, groups, selectedItems);
    if (purchaseItems.length === 0) return;
    if (!confirm(`${purchaseItems.length}件のアイテムを購入済みにしますか？`)) return;

    await Promise.all(
      purchaseItems.map(({ id }) =>
        apiFetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_purchased: true }),
        })
      )
    );
    setSelectedItems(new Set());
    setSelectionMode(false);
    if (integrated) await reloadReview();
    else await fetchItems();
  };

  // タブ切り替え関数
  const changeTab = (newTab: HomeTab, direction?: 'left' | 'right') => {
    const animation = homeTabAnimation(activeTab, newTab, direction);
    if (!animation) return;
    setAnimationClass(animation);
    const url = new URL(window.location.href);
    if (newTab === 'list') url.searchParams.delete('tab');
    else url.searchParams.set('tab', newTab);
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
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
    setSelectedPriorities([]);
    setSelectedGroup(null);
    setSortBy('priority');
    // 選択モードを解除（クリア後に見えないアイテムへの一括操作を防ぐ）
    setSelectionMode(false);
    setSelectedItems(new Set());
  };

  // 合計金額計算。写真グループはサーバーが付けた印の付いた1件だけを足す。
  const totalAmount = sumCountedPrices(items);
  // 比較グループフィルター時の最安価格
  const lowestPriceInGroup = lowestPriceInSelectedGroup(selectedGroup, filteredItems);
  const refreshPhotoCard = useCallback(() => {
    void fetchItems();
    void fetchPurchased();
  }, [fetchItems, fetchPurchased]);

  const reloadReview = useCallback(async () => {
    await Promise.all([fetchItems(), fetchPurchased(), fetchGroups(), fetchCategories()]);
    setBudgetRevision(value => value + 1);
  }, [fetchItems, fetchPurchased, fetchGroups, fetchCategories]);

  useEffect(() => {
    if (!user || !designReview) return;
    const resume = () => { if (document.visibilityState === 'visible') void reloadReview(); };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [user, designReview, reloadReview]);

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

  const listProps: ComponentProps<typeof ListManagementView> = {
    managementOnly: designReview, returnView: designReview ? reviewView : undefined,
    items, filteredItems, wishlist, totalAmount, productCount, loading, loadError, categories, groups,
    searchQuery, onSearchQuery: setSearchQuery, sortBy, onSortBy: setSortBy,
    selectedPriority, onSelectedPriority: setSelectedPriority, selectedCategory, onSelectedCategory: setSelectedCategory,
    priorityFilters: designReview ? selectedPriorities : undefined,
    selectedGroup, onSelectedGroup: setSelectedGroup, isFilterOpen, onToggleFilter: () => setIsFilterOpen(!isFilterOpen),
    selectionMode, selectedCount: selectedItems.size, selectedItems, onToggleSelectionMode: toggleSelectionMode,
    onSelectAll: selectAll, onDeselectAll: deselectAll, onClearFilters: clearFilters, onRetry: handleRetry,
    onDelete: handleDelete, onToggleSelect: toggleItemSelection, onItemsChanged: integrated ? reloadReview : fetchItems, onPhotoChanged: integrated ? reloadReview : refreshPhotoCard,
    onBudget: () => changeTab('budget'), onImport: () => setShowImportModal(true), onRefreshAll: handleRefreshAll,
    onViewRegistered: location => { clearFilters(); changeTab(location); if (location === 'list') void fetchItems(); },
    onDragEnd: handleDragEnd, refreshing, isGuest, dragEnabled, lowestPriceInGroup,
  };
  const bulkBar = (inline = false) => selectionMode && selectedItems.size > 0 ? <HomeBulkBar
    inline={inline} count={selectedItems.size} categories={categories} groups={groups}
    onCategoryChange={handleBulkCategoryChange} onGroupChange={handleBulkGroupChange}
    onPurchased={handleBulkPurchased} onDelete={handleBulkDelete}/> : null;
  const importModal = <ImportWishlistModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} onImported={reloadReview}/>;

  if (designReview && ((activeTab === 'list' && designTab !== 'manage' && designTab !== 'agents') || designTab === 'budget')) {
    return <><DesignWorkbench budgetRevision={budgetRevision} view={designTab === 'budget' ? 'plan' : reviewView} palette={palette} appearance={appearance} items={items} purchased={purchasedItems} groups={groups}
      categories={categories} loading={loading} loadError={loadError} onRetry={handleRetry}
      onReload={reloadReview} onDelete={handleDelete} onLogout={logout} isGuest={isGuest}
      management={{ search: searchQuery, onSearch: setSearchQuery, matching: filteredItems, priorityOptionsItems,
        sortBy, onSortBy:setSortBy, priorities:selectedPriorities, onPriorities:changePriorities, filterOpen: isFilterOpen,
        onToggleFilter: () => setIsFilterOpen(!isFilterOpen), selection: selectionMode ? { ids: selectedItems, toggle: toggleMatchingSelection } : undefined,
        render: (compactList,visibleIds,active) => <ListManagementView {...listProps} embedded activeIntegration={active} compactList={compactList}
          onSelectCompact={() => setSelectedItems(new Set(visibleIds))} bulkActions={bulkBar(true)}/> }}/>{importModal}</>;
  }

  const content = (
    <div ref={swipeRef} className={(designReview ? "agenda-home " : "") + "min-h-screen bg-[var(--kinari)] dark:bg-slate-900"}>
      {designReview ? <header className="review-subheader">
        <Link href={fromSettings ? reviewSettingsHref(reviewView,palette,appearance) : reviewHref(reviewView,undefined,palette,appearance,listPreview)}><ArrowLeft size={17} /> {fromSettings?'設定に戻る':'ホームへ戻る'}</Link>
        <span>{designTab === 'manage' ? 'リストの管理' : designTab === 'agents' ? 'AI連携' : '物欲王'}</span>
        <UiVersionSwitch enabled />
      </header> : <>
        <HomeHeader user={user} onLogout={logout} />
        <HomeTabNav activeTab={activeTab} onChange={changeTab} onOpenList={fetchItems} />
      </>}

      <main className={(designReview ? "agenda-main" : "max-w-4xl") + " mx-auto px-4 py-6"}>
        {!designReview && activeTab === 'list' && <McpConnectionCard url={mcpUrl} guest={isGuest} variant="home" className="mb-4" />}
        {/*
          overflow-clip は親、スライドは子。同じ要素だと transform が
          文書の横スクロール幅を押し広げる（モバイルの出費予定 E2E が落ちる）。
          カードの説明パネルはここより外なので切れない。
        */}
        <div className="overflow-clip">
          <div className={animationClass || undefined}>
            {activeTab === 'list' && designTab !== 'agents' && (
              <ListView {...listProps}/>
            )}

            {activeTab === 'budget' && <BudgetView />}

            {activeTab === 'purchased' && <PurchasedHistory revision={designReview ? budgetRevision : 0} />}

            {activeTab === 'stats' && <StatsView revision={designReview ? budgetRevision : 0} />}

            {activeTab === 'trash' && <TrashView revision={designReview ? budgetRevision : 0} />}
          </div>
        </div>
        {activeTab === 'list' && designReview && designTab === 'agents' && (
          <McpConnectionCard
            url={mcpUrl}
            guest={isGuest}
            variant="home"
            className="agenda-mcp mt-6"
          />
        )}
      </main>

      {bulkBar()}
      {importModal}
    </div>
  );
  const page = designTab || activeTab;
  const titles: Record<string, string> = { manage: 'リストの管理', purchased: '購入履歴', stats: '統計', trash: 'ゴミ箱', agents: 'AI連携' };
  return designReview ? <DesktopPage page={page} title={titles[page] || 'ほしいものリスト'}
    groups={groups} categories={categories} isGuest={isGuest} onReload={reloadReview}>{content}</DesktopPage> : content;

}
