'use client';

import { useEffect, useState } from 'react';
import { Item, ComparisonGroup, Category } from '@/types';
import ItemCard from '@/components/ItemCard';
import AddItemForm from '@/components/AddItemForm';
import BudgetView from '@/components/BudgetView';
import PurchasedHistory from '@/components/PurchasedHistory';
import StatsView from '@/components/StatsView';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';
import { Crown, List, Wallet, RefreshCw, Upload, LogOut, User, Settings, ShoppingBag, Search, ArrowUpDown, BarChart3, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import ImportWishlistModal from '@/components/ImportWishlistModal';
import { useSwipeable } from 'react-swipeable';

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
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'price_asc' | 'price_desc' | 'date_new' | 'date_old' | 'name'>('priority');
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

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

  // フィルター適用（カテゴリ、検索、優先度）
  const filteredItems = items
    .filter(item => {
      if (selectedCategory && item.category_id !== selectedCategory) return false;
      if (selectedPriority && item.priority !== selectedPriority) return false;
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
          return a.priority - b.priority;
      }
    });

  // 合計金額計算
  const totalAmount = items.reduce((sum, item) => {
    const price = item.current_price || 0;
    const quantity = item.quantity || 1;
    return sum + (price * quantity);
  }, 0);

  // 認証チェック
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  return (
    <div {...swipeHandlers} className="min-h-screen bg-slate-50">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown size={28} className="text-yellow-300" />
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
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <nav className="flex gap-2">
            <button
              onClick={() => { changeTab('list'); fetchItems(); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === 'list'
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <List size={18} />
              リスト
            </button>
            <button
              onClick={() => changeTab('budget')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === 'budget'
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Wallet size={18} />
              出費予定
            </button>
            <button
              onClick={() => changeTab('purchased')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === 'purchased'
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <ShoppingBag size={18} />
              購入済
            </button>
            <button
              onClick={() => changeTab('stats')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === 'stats'
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <BarChart3 size={18} />
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-slate-500 mb-1">アイテム数</p>
                <p className="text-2xl font-bold text-slate-800">{items.length}<span className="text-sm font-normal text-slate-500">件</span></p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <p className="text-xs text-slate-500 mb-1">合計金額</p>
                <p className="text-2xl font-bold text-orange-500">¥{totalAmount.toLocaleString()}</p>
              </div>
              <div className="hidden sm:block bg-gradient-to-br from-orange-500 to-amber-500 rounded-2xl shadow-sm p-4 text-white">
                <p className="text-xs text-orange-100 mb-1">カテゴリ</p>
                <p className="text-2xl font-bold">{categories.length}<span className="text-sm font-normal text-orange-100">個</span></p>
              </div>
            </div>

            {/* 検索・並び替え・フィルター (折りたたみ式) */}
            <div className="bg-white rounded-2xl shadow-sm">
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-slate-600 hover:bg-slate-50 transition-colors rounded-2xl"
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={18} className="text-slate-400" />
                  <span className="text-sm font-medium">検索・フィルター</span>
                  {(searchQuery || selectedCategory || selectedPriority || sortBy !== 'priority') && (
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-medium rounded-full">
                      適用中
                    </span>
                  )}
                </div>
                {isFilterOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {isFilterOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
                  <div className="relative pt-3">
                    <Search className="absolute left-3 top-1/2 translate-y-0.5 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="商品名、メモ、カテゴリで検索..."
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown size={16} className="text-slate-500" />
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                      <span className="text-sm text-slate-500">優先度:</span>
                      <select
                        value={selectedPriority || ''}
                        onChange={(e) => setSelectedPriority(e.target.value ? Number(e.target.value) : null)}
                        className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                            ? 'bg-orange-500 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                </div>
              )}
            </div>

            {/* アクションバー */}
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-700">
                ほしいものリスト ({filteredItems.length}件{selectedCategory ? ` / 全${items.length}件` : ''})
              </h2>
              <div className="flex items-center gap-2">
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                  全て更新
                </button>
              </div>
            </div>

            <AddItemForm onAdd={fetchItems} comparisonGroups={groups} categories={categories} />

            {loading ? (
              <div className="text-center py-12 text-slate-500">読み込み中...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                まだアイテムがありません。上のフォームから追加してください。
              </div>
            ) : (
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onUpdate={fetchItems}
                    onDelete={handleDelete}
                    categories={categories}
                    comparisonGroups={groups}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'budget' && <BudgetView />}

        {activeTab === 'purchased' && <PurchasedHistory />}

        {activeTab === 'stats' && <StatsView />}
        </div>
      </main>

      <ImportWishlistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={fetchItems}
      />
    </div>
  );
}
