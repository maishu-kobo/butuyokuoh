'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Crown, ArrowLeft, Copy, Check, Key, Bell, Loader2, Download, Tag, Layers, Trash2, Plus, Pencil, X, RotateCcw, ChevronDown, ChevronUp, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import Link from 'next/link';
import { Category, ComparisonGroup } from '@/types';

export default function SettingsPage() {
  const { user, token, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [displayToken, setDisplayToken] = useState<string | null>(null);
  const [notifySettings, setNotifySettings] = useState({
    slack_webhook: '',
    discord_webhook: '',
    notify_on_price_drop: true,
    notify_on_target_price: true,
  });
  const [savingNotify, setSavingNotify] = useState(false);
  const [notifySaved, setNotifySaved] = useState(false);
  
  // カテゴリ管理
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6b7280');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryColor, setEditCategoryColor] = useState('');
  
  // 比較グループ管理
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  
  // ゴミ箱
  const [trashItems, setTrashItems] = useState<any[]>([]);
  const [loadingTrash, setLoadingTrash] = useState(false);
  
  // 折りたたみ状態
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    categories: false,
    groups: false,
    trash: false,
    theme: false,
    notify: false,
    token: false,
    export: false,
  });
  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  useEffect(() => {
    // トークンを取得
    const fetchToken = async () => {
      try {
        const res = await fetch('/api/auth/token');
        if (res.ok) {
          const data = await res.json();
          setDisplayToken(data.token);
        }
      } catch (e) {
        console.error('Failed to fetch token');
      }
    };
    
    // 通知設定を取得
    const fetchNotifySettings = async () => {
      try {
        const res = await fetch('/api/notification-settings');
        if (res.ok) {
          const data = await res.json();
          setNotifySettings({
            slack_webhook: data.slack_webhook || '',
            discord_webhook: data.discord_webhook || '',
            notify_on_price_drop: !!data.notify_on_price_drop,
            notify_on_target_price: !!data.notify_on_target_price,
          });
        }
      } catch (e) {
        console.error('Failed to fetch notification settings');
      }
    };
    
    if (user) {
      fetchToken();
      fetchNotifySettings();
      fetchCategories();
      fetchGroups();
      fetchTrash();
    }
  }, [user]);

  const fetchCategories = async () => {
    const res = await fetch('/api/categories');
    if (res.ok) setCategories(await res.json());
  };

  const fetchGroups = async () => {
    const res = await fetch('/api/comparison-groups');
    if (res.ok) setGroups(await res.json());
  };

  const fetchTrash = async () => {
    setLoadingTrash(true);
    const res = await fetch('/api/trash');
    if (res.ok) setTrashItems(await res.json());
    setLoadingTrash(false);
  };

  // カテゴリ操作
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

  const handleUpdateCategory = async () => {
    if (!editingCategoryId || !editCategoryName.trim()) return;
    await fetch(`/api/categories/${editingCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editCategoryName, color: editCategoryColor }),
    });
    setEditingCategoryId(null);
    fetchCategories();
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('このカテゴリを削除しますか？')) return;
    await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    fetchCategories();
  };

  // 比較グループ操作
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

  const handleUpdateGroup = async () => {
    if (!editingGroupId || !editGroupName.trim()) return;
    await fetch(`/api/comparison-groups/${editingGroupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editGroupName }),
    });
    setEditingGroupId(null);
    fetchGroups();
  };

  const handleDeleteGroup = async (id: number) => {
    if (!confirm('この比較グループを削除しますか？')) return;
    await fetch(`/api/comparison-groups/${id}`, { method: 'DELETE' });
    fetchGroups();
  };

  // ゴミ箱操作
  const handleRestoreItem = async (id: number) => {
    await fetch(`/api/trash/${id}`, { method: 'POST' });
    fetchTrash();
  };

  const handlePermanentDelete = async (id: number) => {
    if (!confirm('完全に削除しますか？元に戻せません。')) return;
    await fetch(`/api/trash/${id}`, { method: 'DELETE' });
    fetchTrash();
  };

  const handleEmptyTrash = async () => {
    if (!confirm('ゴミ箱を空にしますか？全てのアイテムが完全に削除されます。')) return;
    await fetch('/api/trash', { method: 'DELETE' });
    fetchTrash();
  };

  const saveNotifySettings = async () => {
    setSavingNotify(true);
    try {
      const res = await fetch('/api/notification-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifySettings),
      });
      if (res.ok) {
        setNotifySaved(true);
        setTimeout(() => setNotifySaved(false), 2000);
      }
    } catch (e) {
      console.error('Failed to save notification settings');
    } finally {
      setSavingNotify(false);
    }
  };

  const copyToken = async () => {
    if (displayToken) {
      await navigator.clipboard.writeText(displayToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400 dark:text-gray-500">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <Crown size={32} className="text-yellow-300" />
            <h1 className="text-2xl font-bold">物欲王</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-gray-100 mb-6"
        >
          <ArrowLeft size={18} />
          戻る
        </Link>

        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">設定</h2>

        <div className="space-y-4">
          {/* アカウント情報 (折りたたみなし) */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">アカウント情報</h3>
            <div className="space-y-2 text-sm">
              <div className="flex">
                <span className="text-gray-500 dark:text-gray-400 dark:text-gray-500 w-32">メール:</span>
                <span className="text-gray-900 dark:text-gray-100">{user.email}</span>
              </div>
              {user.name && (
                <div className="flex">
                  <span className="text-gray-500 dark:text-gray-400 dark:text-gray-500 w-32">名前:</span>
                  <span className="text-gray-900 dark:text-gray-100">{user.name}</span>
                </div>
              )}
            </div>
          </div>

          {/* カテゴリ管理 */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('categories')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Tag size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">カテゴリ管理</h3>
                <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">({categories.length})</span>
              </div>
              {openSections.categories ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.categories && (
              <div className="px-4 pb-4 border-t">
                <div className="flex gap-2 my-4">
                  <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="新しいカテゴリ名" className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm" />
                  <input type="color" value={newCategoryColor} onChange={(e) => setNewCategoryColor(e.target.value)} className="w-12 h-10 border border-gray-300 dark:border-slate-600 rounded-md cursor-pointer" />
                  <button onClick={handleAddCategory} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-1"><Plus size={18} /> 追加</button>
                </div>
                {categories.length === 0 ? <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">カテゴリがありません</p> : (
                  <div className="space-y-2">
                    {categories.map((cat) => (
                      <div key={cat.id} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-slate-700 rounded-md">
                        {editingCategoryId === cat.id ? (
                          <>
                            <input type="color" value={editCategoryColor} onChange={(e) => setEditCategoryColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                            <input type="text" value={editCategoryName} onChange={(e) => setEditCategoryName(e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" autoFocus />
                            <button onClick={handleUpdateCategory} className="text-green-500 hover:text-green-600"><Check size={18} /></button>
                            <button onClick={() => setEditingCategoryId(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300"><X size={18} /></button>
                          </>
                        ) : (
                          <>
                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }} />
                            <span className="flex-1 text-sm">{cat.name}</span>
                            <button onClick={() => { setEditingCategoryId(cat.id); setEditCategoryName(cat.name); setEditCategoryColor(cat.color); }} className="text-gray-400 dark:text-gray-500 hover:text-blue-500"><Pencil size={16} /></button>
                            <button onClick={() => handleDeleteCategory(cat.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500"><X size={18} /></button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 比較グループ管理 */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('groups')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Layers size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">比較グループ管理</h3>
                <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">({groups.length})</span>
              </div>
              {openSections.groups ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.groups && (
              <div className="px-4 pb-4 border-t">
                <div className="flex gap-2 my-4">
                  <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新しいグループ名" className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm" />
                  <button onClick={handleAddGroup} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-1"><Plus size={18} /> 追加</button>
                </div>
                {groups.length === 0 ? <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">比較グループがありません</p> : (
                  <div className="space-y-2">
                    {groups.map((group) => (
                      <div key={group.id} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-slate-700 rounded-md">
                        {editingGroupId === group.id ? (
                          <>
                            <input type="text" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" autoFocus />
                            <button onClick={handleUpdateGroup} className="text-green-500 hover:text-green-600"><Check size={18} /></button>
                            <button onClick={() => setEditingGroupId(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300"><X size={18} /></button>
                          </>
                        ) : (
                          <>
                            <Layers size={16} className="text-orange-500" />
                            <span className="flex-1 text-sm">{group.name}</span>
                            <button onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); }} className="text-gray-400 dark:text-gray-500 hover:text-blue-500"><Pencil size={16} /></button>
                            <button onClick={() => handleDeleteGroup(group.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-500"><X size={18} /></button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">💡 グループ内のアイテムは「リスト」タブのフィルターで確認できます</p>
              </div>
            )}
          </div>

          {/* ゴミ箱 */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('trash')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Trash2 size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">ゴミ箱</h3>
                <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">({trashItems.length}件)</span>
              </div>
              {openSections.trash ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.trash && (
              <div className="px-4 pb-4 border-t">
                {trashItems.length > 0 && (
                  <div className="flex justify-end my-2">
                    <button onClick={handleEmptyTrash} className="text-sm text-red-500 hover:text-red-600">ゴミ箱を空にする</button>
                  </div>
                )}
                {loadingTrash ? <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm py-2">読み込み中...</p> : trashItems.length === 0 ? <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm py-2">ゴミ箱は空です</p> : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {trashItems.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-slate-700 rounded-md">
                        <span className="flex-1 text-sm truncate">{item.name}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">¥{item.current_price?.toLocaleString() || '---'}</span>
                        <button onClick={() => handleRestoreItem(item.id)} className="text-blue-500 hover:text-blue-600 text-xs flex items-center gap-1"><RotateCcw size={14} /> 復元</button>
                        <button onClick={() => handlePermanentDelete(item.id)} className="text-red-500 hover:text-red-600 text-xs">削除</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* テーマ設定 */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('theme')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Sun size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">テーマ</h3>
              </div>
              {openSections.theme ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.theme && (
              <div className="px-4 pb-4 border-t dark:border-slate-700">
                <div className="flex gap-2 pt-4">
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      theme === 'light'
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    <Sun size={16} />
                    ライト
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      theme === 'dark'
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    <Moon size={16} />
                    ダーク
                  </button>
                  <button
                    onClick={() => setTheme('system')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      theme === 'system'
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    <Monitor size={16} />
                    自動
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 価格通知設定 */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('notify')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Bell size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">価格通知設定</h3>
              </div>
              {openSections.notify ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.notify && (
              <div className="px-4 pb-4 border-t space-y-4 pt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Slack Webhook URL</label>
                  <input type="url" value={notifySettings.slack_webhook} onChange={(e) => setNotifySettings({ ...notifySettings, slack_webhook: e.target.value })} placeholder="https://hooks.slack.com/services/..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Discord Webhook URL</label>
                  <input type="url" value={notifySettings.discord_webhook} onChange={(e) => setNotifySettings({ ...notifySettings, discord_webhook: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={notifySettings.notify_on_price_drop} onChange={(e) => setNotifySettings({ ...notifySettings, notify_on_price_drop: e.target.checked })} className="rounded border-gray-300 dark:border-slate-600 text-orange-500" /><span className="text-sm text-gray-700">価格が下がったら通知</span></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={notifySettings.notify_on_target_price} onChange={(e) => setNotifySettings({ ...notifySettings, notify_on_target_price: e.target.checked })} className="rounded border-gray-300 dark:border-slate-600 text-orange-500" /><span className="text-sm text-gray-700">目標価格に達したら通知</span></label>
                </div>
                <button onClick={saveNotifySettings} disabled={savingNotify} className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2">
                  {savingNotify ? <><Loader2 size={18} className="animate-spin" /> 保存中...</> : notifySaved ? <><Check size={18} /> 保存しました</> : '保存'}
                </button>
              </div>
            )}
          </div>

          {/* Chrome拡張機能用トークン */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('token')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Key size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Chrome拡張機能用トークン</h3>
              </div>
              {openSections.token ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.token && (
              <div className="px-4 pb-4 border-t pt-4">
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Chrome拡張機能でほしいものリストをインポートする際に必要です。</p>
                {displayToken ? (
                  <div className="flex gap-2">
                    <input type="text" value={displayToken} readOnly className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-gray-50 dark:bg-slate-700 text-sm font-mono" />
                    <button onClick={copyToken} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2">
                      {copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'コピーした' : 'コピー'}
                    </button>
                  </div>
                ) : <div className="text-gray-500 dark:text-gray-400 dark:text-gray-500">トークンを取得中...</div>}
                <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-2">※ このトークンは他人に共有しないでください</p>
              </div>
            )}
          </div>

          {/* データエクスポート */}
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow">
            <button onClick={() => toggleSection('export')} className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:bg-slate-700 dark:hover:bg-slate-700 rounded-lg">
              <div className="flex items-center gap-2">
                <Download size={20} className="text-orange-500" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">データエクスポート</h3>
              </div>
              {openSections.export ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.export && (
              <div className="px-4 pb-4 border-t pt-4">
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">データをCSV形式でダウンロードできます。</p>
                <div className="flex flex-wrap gap-3">
                  <a href="/api/export?filter=wishlist" className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2"><Download size={18} />ほしいものリスト</a>
                  <a href="/api/export?filter=purchased" className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 flex items-center gap-2"><Download size={18} />購入済み</a>
                  <a href="/api/export?filter=all" className="px-4 py-2 bg-gray-50 dark:bg-slate-7000 text-white rounded-md hover:bg-gray-600 flex items-center gap-2"><Download size={18} />すべて</a>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
