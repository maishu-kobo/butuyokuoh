'use client';

import { useEffect, useState } from 'react';
import { Item, ComparisonGroup } from '@/types';
import ItemCard from '@/components/ItemCard';
import AddItemForm from '@/components/AddItemForm';
import BudgetView from '@/components/BudgetView';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';
import { Crown, List, Wallet, Layers, Plus, RefreshCw, Upload, LogOut, User, Settings } from 'lucide-react';
import Link from 'next/link';
import ImportWishlistModal from '@/components/ImportWishlistModal';

type Tab = 'list' | 'budget' | 'groups';

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
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

  useEffect(() => {
    if (user) {
      fetchItems();
      fetchGroups();
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

  // グループごとにアイテムを分類
  const groupedItems = items.reduce<Record<string, Item[]>>((acc, item) => {
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
              onClick={() => setActiveTab('list')}
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
          </nav>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'list' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-700">
                ほしいものリスト ({items.length}件)
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

            <AddItemForm onAdd={fetchItems} comparisonGroups={groups} />

            {loading ? (
              <div className="text-center py-8 text-gray-500">読み込み中...</div>
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                まだアイテムがありません。上のフォームから追加してください。
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
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
      </main>

      <ImportWishlistModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={fetchItems}
      />
    </div>
  );
}
