'use client';

import { useEffect, useState } from 'react';
import { Item, ComparisonGroup, Category } from '@/types';
import ItemCard from '@/components/ItemCard';
import AddItemForm from '@/components/AddItemForm';
import BudgetView from '@/components/BudgetView';
import PurchasedHistory from '@/components/PurchasedHistory';
import TrashView from '@/components/TrashView';
import StatsView from '@/components/StatsView';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';
import { Crown, List, Wallet, Layers, Plus, RefreshCw, Upload, LogOut, User, Settings, Tag, X, ShoppingBag, Search, ArrowUpDown, Trash2, BarChart3, Pencil, Check } from 'lucide-react';
import Link from 'next/link';
import ImportWishlistModal from '@/components/ImportWishlistModal';
import { useSwipeable } from 'react-swipeable';
import { motion, AnimatePresence } from 'framer-motion';

type Tab = 'list' | 'budget' | 'groups' | 'categories' | 'purchased' | 'trash' | 'stats';

const TABS: Tab[] = ['list', 'budget', 'purchased', 'stats', 'groups', 'categories', 'trash'];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [slideDirection, setSlideDirection] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6b7280');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryColor, setEditCategoryColor] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'price_asc' | 'price_desc' | 'date_new' | 'date_old' | 'name'>('priority');
  const [selectedPriority, setSelectedPriority] = useState<number | null>(null);

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

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    await fetch('/api/comparison-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName }),
    });
    setNewGroupName('');
    fetchGroups();
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategoryName, color: newCategoryColor }),
    });
    setNewCategoryName('');
    setNewCategoryColor('#6b7280');
    fetchCategories();
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('このカテゴリを削除しますか？\nアイテムは削除されず、カテゴリなしになります。')) return;
    await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    fetchCategories();
    fetchItems();
  };

  const startEditCategory = (cat: Category) => {
    setEditingCategoryId(cat.id);
    setEditCategoryName(cat.name);
    setEditCategoryColor(cat.color);
  };

  const handleUpdateCategory = async () => {
    if (!editingCategoryId || !editCategoryName.trim()) return;
    await fetch(`/api/categories/${editingCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editCategoryName, color: editCategoryColor }),
    });
    setEditingCategoryId(null);
    fetchCategories();
    fetchItems();
  };

  // タブ切り替え関数
  const changeTab = (newTab: Tab) => {
    const currentIndex = TABS.indexOf(activeTab);
    const newIndex = TABS.indexOf(newTab);
    setSlideDirection(newIndex > currentIndex ? 1 : -1);
    setActiveTab(newTab);
  };

  // スワイプでタブ切り替え
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex < TABS.length - 1) {
        setSlideDirection(1);
        setActiveTab(TABS[currentIndex + 1]);
      }
    },
    onSwipedRight: () => {
      const currentIndex = TABS.indexOf(activeTab);
      if (currentIndex > 0) {
        setSlideDirection(-1);
        setActiveTab(TABS[currentIndex - 1]);
      }
    },
    trackMouse: false,
    preventScrollOnSwipe: false,
    delta: 50,
  });

  // フィルター適用（カテゴリ、検索、優先度）
  const filteredItems = items
    .filter(item => {
      // カテゴリフィルター
      if (selectedCategory && item.category_id !== selectedCategory) return false;
      // 優先度フィルター
      if (selectedPriority && item.priority !== selectedPriority) return false;
      // 検索フィルター
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

  // グループごとにアイテムを分類
  const groupedItems = filteredItems.reduce<Record<string, Item[]>>((acc, item) => {
    const key = item.comparison_group_id ? `group-${item.comparison_group_id}` : 'ungrouped';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // 認証チェック
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <Crown size={32} className="text-yellow-300" />
            <h1 className="text-2xl font-bold">物欲王</h1>
          </div>
          <div className="flex items-center justify-between">
            <p className="mt-1 text-amber-100 text-sm">すべてのほしいものを一つに</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-amber-100 text-sm">
                <User size={16} />
                <span>{user.name || user.email}</span>
              </div>
              <Link
                href="/settings"
                className="flex items-center gap-1 text-amber-100 hover:text-white text-sm"
              >
                <Settings size={16} />
                設定
              </Link>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-amber-100 hover:text-white text-sm"
              >
                <LogOut size={16} />
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* タブ */}
      <div className="bg-white shadow sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 overflow-x-auto">
          <nav className="flex gap-1 min-w-max">
            <button
              onClick={() => { changeTab('list'); fetchItems(); }}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'list'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <List size={18} />
              リスト
            </button>
            <button
              onClick={() => changeTab('budget')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'budget'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Wallet size={18} />
              出費予定
            </button>
            <button
              onClick={() => changeTab('purchased')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'purchased'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <ShoppingBag size={18} />
              購入済
            </button>
            <button
              onClick={() => changeTab('stats')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'stats'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <BarChart3 size={18} />
              統計
            </button>
            <button
              onClick={() => changeTab('groups')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'groups'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Layers size={18} />
              比較
            </button>
            <button
              onClick={() => changeTab('categories')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'categories'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Tag size={18} />
              カテゴリ
            </button>
            <button
              onClick={() => changeTab('trash')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'trash'
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Trash2 size={18} />
              ゴミ箱
            </button>
          </nav>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main {...swipeHandlers} className="max-w-4xl mx-auto px-4 py-6 overflow-hidden">
        <AnimatePresence mode="wait" custom={slideDirection}>
          <motion.div
            key={activeTab}
            custom={slideDirection}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
        {activeTab === 'list' && (
          <div className="space-y-4">
            {/* 検索・並び替え・フィルター */}
            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              {/* 検索バー */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="商品名、メモ、カテゴリで検索..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* 並び替え・優先度フィルター */}
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <ArrowUpDown size={16} className="text-gray-500" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                  <span className="text-sm text-gray-500">優先度:</span>
                  <select
                    value={selectedPriority || ''}
                    onChange={(e) => setSelectedPriority(e.target.value ? Number(e.target.value) : null)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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

              {/* カテゴリフィルター */}
              {categories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      selectedCategory === null
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    すべて
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        selectedCategory === cat.id
                          ? 'text-white'
                          : 'text-gray-700 hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: selectedCategory === cat.id ? cat.color : `${cat.color}30`,
                        borderColor: cat.color,
                      }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-700">
                ほしいものリスト ({filteredItems.length}件{selectedCategory ? ` / 全${items.length}件` : ''})
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600"
                >
                  <Upload size={16} />
                  インポート
                </button>
                <button
                  onClick={handleRefreshAll}
                  disabled={refreshing || items.length === 0}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-500 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                  全て更新
                </button>
              </div>
            </div>

            <AddItemForm onAdd={fetchItems} comparisonGroups={groups} categories={categories} />

            {loading ? (
              <div className="text-center py-8 text-gray-500">読み込み中...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                まだアイテムがありません。上のフォームから追加してください。
              </div>
            ) : (
              <div className="space-y-4">
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

        {activeTab === 'groups' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-700">比較グループ</h2>
            
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="新しいグループ名"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddGroup}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-1"
                >
                  <Plus size={18} />
                  追加
                </button>
              </div>
            </div>

            {groups.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                比較グループがありません
              </div>
            ) : (
              groups.map((group) => {
                const groupItems = groupedItems[`group-${group.id}`] || [];
                return (
                  <div key={group.id} className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b">
                      <h3 className="font-semibold">{group.name}</h3>
                      <p className="text-sm text-gray-500">{groupItems.length}件のアイテム</p>
                    </div>
                    {groupItems.length > 0 ? (
                      <div className="p-4 space-y-3">
                        {groupItems.map((item) => (
                          <div key={item.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                            {item.image_url && (
                              <img src={item.image_url} alt="" className="w-12 h-12 object-contain" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              <p className="text-sm text-gray-500">{item.source_name}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">¥{item.current_price?.toLocaleString() || '---'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-center text-gray-500 text-sm">
                        アイテムがありません
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-700">カテゴリ管理</h2>
            
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="新しいカテゴリ名"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="color"
                  value={newCategoryColor}
                  onChange={(e) => setNewCategoryColor(e.target.value)}
                  className="w-12 h-10 border border-gray-300 rounded-md cursor-pointer"
                  title="カテゴリの色"
                />
                <button
                  onClick={handleAddCategory}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-1"
                >
                  <Plus size={18} />
                  追加
                </button>
              </div>
            </div>

            {categories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                カテゴリがありません
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                    {editingCategoryId === cat.id ? (
                      <>
                        <input
                          type="color"
                          value={editCategoryColor}
                          onChange={(e) => setEditCategoryColor(e.target.value)}
                          className="w-8 h-8 border border-gray-300 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={editCategoryName}
                          onChange={(e) => setEditCategoryName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                        <button
                          onClick={handleUpdateCategory}
                          className="text-green-500 hover:text-green-600"
                          title="保存"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() => setEditingCategoryId(null)}
                          className="text-gray-400 hover:text-gray-600"
                          title="キャンセル"
                        >
                          <X size={18} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="flex-1 font-medium">{cat.name}</span>
                        <span className="text-sm text-gray-500">
                          {(cat as Category & { item_count?: number }).item_count || 0}件
                        </span>
                        <button
                          onClick={() => startEditCategory(cat)}
                          className="text-gray-400 hover:text-blue-500"
                          title="編集"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="text-gray-400 hover:text-red-500"
                          title="削除"
                        >
                          <X size={18} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'purchased' && <PurchasedHistory />}

        {activeTab === 'trash' && <TrashView />}

        {activeTab === 'stats' && <StatsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      <ImportWishlistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={fetchItems}
      />
    </div>
  );
}
