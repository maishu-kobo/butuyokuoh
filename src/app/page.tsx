'use client';

import { useEffect, useState } from 'react';
import { Item, ComparisonGroup, Category } from '@/types';
import ItemCard from '@/components/ItemCard';
import AddItemForm from '@/components/AddItemForm';
import BudgetView from '@/components/BudgetView';
import PurchasedHistory from '@/components/PurchasedHistory';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';
import { Crown, List, Wallet, Layers, Plus, RefreshCw, Upload, LogOut, User, Settings, Tag, X, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import ImportWishlistModal from '@/components/ImportWishlistModal';

type Tab = 'list' | 'budget' | 'groups' | 'categories' | 'purchased';

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6b7280');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

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
    if (!confirm('本当に削除しますか？')) return;
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

  // カテゴリフィルター適用
  const filteredItems = selectedCategory
    ? items.filter(item => item.category_id === selectedCategory)
    : items;

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
        <div className="max-w-4xl mx-auto px-4">
          <nav className="flex gap-1">
            <button
              onClick={() => { setActiveTab('list'); fetchItems(); }}
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
              onClick={() => setActiveTab('budget')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'budget' 
                  ? 'border-orange-500 text-orange-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Wallet size={18} />
              予算
            </button>
            <button
              onClick={() => setActiveTab('groups')}
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
              onClick={() => setActiveTab('categories')}
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
              onClick={() => setActiveTab('purchased')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'purchased' 
                  ? 'border-orange-500 text-orange-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <ShoppingBag size={18} />
              購入済
            </button>
          </nav>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'list' && (
          <div className="space-y-4">
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
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="flex-1 font-medium">{cat.name}</span>
                    <span className="text-sm text-gray-500">
                      {(cat as Category & { item_count?: number }).item_count || 0}件
                    </span>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-gray-400 hover:text-red-500"
                      title="削除"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'purchased' && <PurchasedHistory />}
      </main>

      <ImportWishlistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={fetchItems}
      />
    </div>
  );
}
