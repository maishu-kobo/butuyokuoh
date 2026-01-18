'use client';

import { useEffect, useState } from 'react';
import { Item, ComparisonGroup, Category } from '@/types';
import SortableItemCard from '@/components/SortableItemCard';
import AddItemForm from '@/components/AddItemForm';
import BudgetView from '@/components/BudgetView';
import PurchasedHistory from '@/components/PurchasedHistory';
import StatsView from '@/components/StatsView';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';
import { Crown, List, Wallet, RefreshCw, Upload, LogOut, User, Settings, ShoppingBag, Search, ArrowUpDown, BarChart3, ChevronDown, ChevronUp, SlidersHorizontal, Layers, CheckSquare, X, Trash2 } from 'lucide-react';
import Link from 'next/link';
import ImportWishlistModal from '@/components/ImportWishlistModal';
import { useSwipeable } from 'react-swipeable';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';

type Tab = 'list' | 'budget' | 'purchased' | 'stats';

const TABS: Tab[] = ['list', 'budget', 'purchased', 'stats'];

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [animationClass, setAnimationClass] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'price_asc' | 'price_desc' | 'date_new' | 'date_old' | 'name'>('priority');
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const fetchItems = async () => {
    const res = await fetch('/api/items');
    const data = await res.json();
    setItems(data);
    setLoading(false);
  };

  const fetchGroups = async () => {
    const res = await fetch('/api/comparison-groups');
    const data = await res.json();
    setGroups(data);
  };

  const fetchCategories = async () => {
    const res = await fetch('/api/categories');
    const data = await res.json();
    setCategories(data);
  };

  useEffect(() => {
    if (user) {
      fetchItems();
      fetchGroups();
      fetchCategories();
    }
  }, [user]);

  const handleDelete = async (id: number) => {
    await fetch(`/api/items/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all(items.map((item) => 
        fetch(`/api/items/${item.id}/refresh`, { method: 'POST' })
      ));
      fetchItems();
    } finally {
      setRefreshing(false);
    }
  };

  // ドラッグ&ドロップ用のsensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ドラッグ&ドロップが有効かどうか（優先度順の時のみ）
  const isDragEnabled = sortBy === 'priority' && !selectedCategory && !selectedGroup && !selectedPriority && !searchQuery;

  // ドラッグ終了時のハンドラ
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const activeItem = filteredItems.find(item => item.id === active.id);
    const overItem = filteredItems.find(item => item.id === over.id);
    
    if (!activeItem || !overItem) return;
    
    // 同一優先度内でのみ並び替えを許可
    if (activeItem.priority !== overItem.priority) return;
    
    // 同じ優先度のアイテムのみを抽出
    const samePriorityItems = filteredItems.filter(item => item.priority === activeItem.priority);
    const oldIndex = samePriorityItems.findIndex(item => item.id === active.id);
    const newIndex = samePriorityItems.findIndex(item => item.id === over.id);
    
    if (oldIndex === -1 || newIndex === -1) return;

    // 新しい順序で配列を作成
    const reorderedItems = [...samePriorityItems];
    const [movedItem] = reorderedItems.splice(oldIndex, 1);
    reorderedItems.splice(newIndex, 0, movedItem);
    
    // 同一優先度内のsort_orderを計算
    const newSortOrders = new Map<number, number>();
    reorderedItems.forEach((item, index) => {
      newSortOrders.set(item.id, index);
    });
    
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
          fetch(`/api/items/${id}`, {
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

  // アイテムの選択トグル
  const toggleItemSelection = (id: number) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  // 全選択
  const selectAll = () => {
    setSelectedItems(new Set(filteredItems.map(item => item.id)));
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
        fetch(`/api/items/${id}`, { method: 'DELETE' })
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
        fetch(`/api/items/${id}`, {
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
        fetch(`/api/items/${id}`, {
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
    
    const today = new Date().toISOString().split('T')[0];
    await Promise.all(
      Array.from(selectedItems).map(id =>
        fetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_purchased: true, purchased_at: today }),
        })
      )
    );
    setSelectedItems(new Set());
    setSelectionMode(false);
    fetchItems();
  };

  // タブ切り替え関数
  const changeTab = (newTab: Tab, direction?: 'left' | 'right') => {
    if (newTab === activeTab) return;
    const currentIndex = TABS.indexOf(activeTab);
    const newIndex = TABS.indexOf(newTab);
    const dir = direction || (newIndex > currentIndex ? 'left' : 'right');
    setAnimationClass(dir === 'left' ? 'slide-in-right' : 'slide-in-left');
    setActiveTab(newTab);
    setTimeout(() => setAnimationClass(''), 200);
  };

  // スワイプでタブ切り替え
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex < TABS.length - 1) {
        changeTab(TABS[currentIndex + 1], 'left');
      }
    },
    onSwipedRight: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex > 0) {
        changeTab(TABS[currentIndex - 1], 'right');
      }
    },
    trackMouse: false,
    preventScrollOnSwipe: true,
    delta: 30,
    swipeDuration: 500,
    touchEventOptions: { passive: false },
  });

  // フィルター適用（カテゴリ、検索、優先度、比較グループ）
  const filteredItems = items
    .filter(item => {
      if (selectedCategory && item.category_id !== selectedCategory) return false;
      if (selectedPriority && item.priority !== selectedPriority) return false;
      if (selectedGroup && item.comparison_group_id !== selectedGroup) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return item.name.toLowerCase().includes(query) ||
               item.notes?.toLowerCase().includes(query) ||
               item.category_name?.toLowerCase().includes(query);
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return (a.current_price || 0) - (b.current_price || 0);
        case 'price_desc':
          return (b.current_price || 0) - (a.current_price || 0);
        case 'date_new':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'date_old':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'name':
          return a.name.localeCompare(b.name, 'ja');
        case 'priority':
        default:
          // 優先度でソート、同じ優先度ならsort_orderでソート
          if (a.priority !== b.priority) {
            return a.priority - b.priority;
          }
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      }
    });

  // 合計金額計算
  const totalAmount = items.reduce((sum, item) => {
    const price = item.current_price || 0;
    const quantity = item.quantity || 1;
    return sum + (price * quantity);
  }, 0);

  // 比較グループフィルター時の最安価格を計算
  const lowestPriceInGroup = selectedGroup
    ? Math.min(...filteredItems.filter(i => i.current_price).map(i => i.current_price!))
    : null;

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
    <div {...swipeHandlers} className="min-h-screen bg-[var(--kinari)] dark:bg-slate-900">
      {/* ヘッダー */}
      <header className="bg-[var(--ai)] text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown size={28} className="text-[var(--kitsune)]" />
              <h1 className="text-xl font-bold">物欲王</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-amber-100 text-sm">
                <User size={16} />
                <span>{user.name || user.email}</span>
              </div>
              <Link
                href="/settings"
                className="p-2 text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="設定"
              >
                <Settings size={20} />
              </Link>
              <button
                onClick={logout}
                className="p-2 text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="ログアウト"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ナビゲーション（ピル型タブ） */}
      <div className="bg-white dark:bg-slate-800 shadow-sm sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <nav className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => { changeTab('list'); fetchItems(); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'list'
                  ? 'bg-[var(--shu)] text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <List size={16} />
              リスト
            </button>
            <button
              onClick={() => changeTab('budget')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'budget'
                  ? 'bg-[var(--shu)] text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <Wallet size={16} />
              出費予定
            </button>
            <button
              onClick={() => changeTab('purchased')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'purchased'
                  ? 'bg-[var(--shu)] text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <ShoppingBag size={16} />
              購入済
            </button>
            <button
              onClick={() => changeTab('stats')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'stats'
                  ? 'bg-[var(--shu)] text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <BarChart3 size={16} />
              統計
            </button>
          </nav>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-4xl mx-auto px-4 py-6 overflow-hidden">
        <div className={animationClass}>
        {activeTab === 'list' && (
          <div className="space-y-4">
            {/* サマリーカード */}
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

            {/* 検索・並び替え・フィルター (折りたたみ式) */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm">
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-slate-600 dark:text-slate-300 hover:bg-[var(--kinari)] dark:hover:bg-slate-700 transition-colors rounded-2xl"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={18} className="text-slate-400" />
                  <span className="text-sm font-medium">検索・フィルター</span>
                  {(searchQuery || selectedCategory || selectedPriority || selectedGroup || sortBy !== 'priority') && (
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-medium rounded-full">
                      適用中
                    </span>
                  )}
                </div>
                {isFilterOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {isFilterOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-700">
                  <div className="relative pt-3">
                    <Search className="absolute left-3 top-1/2 translate-y-0.5 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="商品名、メモ、カテゴリで検索..."
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown size={16} className="text-slate-500 dark:text-slate-400" />
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
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
                        onChange={(e) => setSelectedPriority(e.target.value ? Number(e.target.value) : null)}
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
                        onClick={() => setSelectedCategory(null)}
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
                          onClick={() => setSelectedCategory(cat.id)}
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

                  {/* 比較グループフィルター */}
                  {groups.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                        <Layers size={16} />
                        <span>比較:</span>
                      </div>
                      <button
                        onClick={() => setSelectedGroup(null)}
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
                          onClick={() => setSelectedGroup(group.id)}
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

            {/* アクションバー */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {selectionMode 
                  ? `${selectedItems.size}件選択中`
                  : `ほしいものリスト (${filteredItems.length}件${selectedCategory ? ` / 全${items.length}件` : ''})`
                }
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {selectionMode ? (
                  <>
                    <button
                      onClick={selectAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                    >
                      全選択
                    </button>
                    <button
                      onClick={deselectAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                    >
                      選択解除
                    </button>
                    <button
                      onClick={toggleSelectionMode}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                    >
                      <X size={16} />
                      キャンセル
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={toggleSelectionMode}
                      disabled={items.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <CheckSquare size={16} />
                      選択
                    </button>
                    <button
                      onClick={() => setShowImportModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      <Upload size={16} />
                      インポート
                    </button>
                    <button
                      onClick={handleRefreshAll}
                      disabled={refreshing || items.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                      全て更新
                    </button>
                  </>
                )}
              </div>
            </div>

            <AddItemForm onAdd={fetchItems} comparisonGroups={groups} categories={categories} />

            {loading ? (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400">読み込み中...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                まだアイテムがありません。上のフォームから追加してください。
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filteredItems.map(item => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {filteredItems.map((item) => (
                      <SortableItemCard
                        key={item.id}
                        item={item}
                        onUpdate={fetchItems}
                        onDelete={handleDelete}
                        categories={categories}
                        comparisonGroups={groups}
                        isLowestPrice={selectedGroup !== null && lowestPriceInGroup !== null && item.current_price === lowestPriceInGroup}
                        isDragEnabled={isDragEnabled && !selectionMode}
                        selectionMode={selectionMode}
                        isSelected={selectedItems.has(item.id)}
                        onToggleSelect={toggleItemSelection}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}

        {activeTab === 'budget' && <BudgetView />}

        {activeTab === 'purchased' && <PurchasedHistory />}

        {activeTab === 'stats' && <StatsView />}
        </div>
      </main>

      {/* 一括操作バー（選択時のみ表示） */}
      {selectionMode && selectedItems.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-lg z-50">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {selectedItems.size}件選択中
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {/* カテゴリ変更 */}
              <select
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') return;
                  handleBulkCategoryChange(value === 'none' ? null : Number(value));
                  e.target.value = '';
                }}
                className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                defaultValue=""
              >
                <option value="" disabled>カテゴリ変更</option>
                <option value="none">なし</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              {/* グループ変更 */}
              <select
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') return;
                  handleBulkGroupChange(value === 'none' ? null : Number(value));
                  e.target.value = '';
                }}
                className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                defaultValue=""
              >
                <option value="" disabled>グループ変更</option>
                <option value="none">なし</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              {/* 購入済み */}
              <button
                onClick={handleBulkPurchased}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
              >
                <ShoppingBag size={16} />
                購入済み
              </button>
              {/* 削除 */}
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      <ImportWishlistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={fetchItems}
      />
    </div>
  );
}
