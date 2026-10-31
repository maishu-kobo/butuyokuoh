'use client';

import { apiFetch } from '@/lib/api-fetch';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Crown, ArrowLeft, Copy, Check, Key, Bell, Loader2, Download, Tag, Layers, Plus, Pencil, X, ChevronDown, ChevronUp, Sun, Moon, Monitor, Palette, Bot, Lock } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import Link from 'next/link';
import LegalLinks from '@/components/LegalLinks';
import { Category, ComparisonGroup } from '@/types';

type AgentTokenRecord = {
  id: number;
  name: string;
  token_prefix: string;
  scopes: ('read' | 'write')[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  active: boolean;
};

export default function SettingsPage() {
  const { user, isGuest, token, loading, logout } = useAuth();
  const { theme, setTheme, colorScheme, setColorScheme } = useTheme();
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
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');

  // エージェント用トークン
  const [agentTokens, setAgentTokens] = useState<AgentTokenRecord[]>([]);
  const [agentName, setAgentName] = useState('');
  const [agentScopeRead, setAgentScopeRead] = useState(true);
  const [agentScopeWrite, setAgentScopeWrite] = useState(true);
  const [agentDays, setAgentDays] = useState(90);
  const [creatingAgentToken, setCreatingAgentToken] = useState(false);
  const [createdAgentPlaintext, setCreatedAgentPlaintext] = useState<string | null>(null);
  const [copiedAgent, setCopiedAgent] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [agentBusyId, setAgentBusyId] = useState<number | null>(null);
  const [agentAuditId, setAgentAuditId] = useState<number | null>(null);
  const [agentAuditEntries, setAgentAuditEntries] = useState<{ id: number; action: string; meta: string | null; created_at: string }[]>([]);

  // パスワード変更
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  
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
  
  // 折りたたみ状態
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    categories: false,
    groups: false,
    theme: false,
    notify: false,
    token: false,
    agentTokens: false,
    password: false,
    export: false,
  });
  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  const fetchCategories = async () => {
    const res = await apiFetch('/api/categories');
    if (res.ok) setCategories(await res.json());
  };

  const fetchGroups = async () => {
    const res = await apiFetch('/api/comparison-groups');
    if (res.ok) setGroups(await res.json());
  };

  const fetchAgentTokens = async () => {
    const res = await apiFetch('/api/agent-tokens');
    if (!res.ok) return;
    const data = await res.json() as { tokens: AgentTokenRecord[] };
    setAgentTokens(data.tokens || []);
  };

  useEffect(() => {
    // トークンを取得
    const fetchToken = async () => {
      try {
        const res = await apiFetch('/api/auth/token');
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
        const res = await apiFetch('/api/notification-settings');
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
      // 取得は今までどおり同時に始める。await で包むと、新しい react-hooks が中の setState を同期呼び出しと誤認しない。
      if (!isGuest) {
        void (async () => { await fetchToken(); })();
        void (async () => { await fetchNotifySettings(); })();
        void (async () => { await fetchAgentTokens(); })();
      }
      void (async () => { await fetchCategories(); })();
      void (async () => { await fetchGroups(); })();
    }
  }, [user]);

  // カテゴリ操作
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    await apiFetch('/api/categories', {
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
    await apiFetch(`/api/categories/${editingCategoryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editCategoryName, color: editCategoryColor }),
    });
    setEditingCategoryId(null);
    fetchCategories();
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('このカテゴリを削除しますか？')) return;
    await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
    fetchCategories();
  };

  // 比較グループ操作
  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    await apiFetch('/api/comparison-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName }),
    });
    setNewGroupName('');
    fetchGroups();
  };

  const handleUpdateGroup = async () => {
    if (!editingGroupId || !editGroupName.trim()) return;
    await apiFetch(`/api/comparison-groups/${editingGroupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editGroupName }),
    });
    setEditingGroupId(null);
    fetchGroups();
  };

  const handleDeleteGroup = async (id: number) => {
    if (!confirm('この比較グループを削除しますか？')) return;
    await apiFetch(`/api/comparison-groups/${id}`, { method: 'DELETE' });
    fetchGroups();
  };

  const saveNotifySettings = async () => {
    setSavingNotify(true);
    try {
      const res = await apiFetch('/api/notification-settings', {
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

  const deleteAccount = async () => {
    if (isGuest || deletingAccount) return;
    if (!window.confirm('退会すると、アカウントと登録したデータが削除されます。元に戻せません。退会しますか？')) return;
    setDeletingAccount(true);
    setAccountError('');
    try {
      const res = await fetch('/api/auth/account', { method: 'DELETE' });
      if (!res.ok) {
        setAccountError('退会できませんでした。もう一度お試しください。');
        return;
      }
      await logout();
    } catch {
      setAccountError('通信に失敗しました。もう一度お試しください。');
    } finally {
      setDeletingAccount(false);
    }
  };

  const copyToken = async () => {
    if (displayToken) {
      await navigator.clipboard.writeText(displayToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const createAgentAccessToken = async () => {
    if (creatingAgentToken) return;
    setAgentError('');
    setCreatedAgentPlaintext(null);
    const scopes: ('read' | 'write')[] = [];
    if (agentScopeRead) scopes.push('read');
    if (agentScopeWrite) scopes.push('write');
    if (!scopes.length) {
      setAgentError('権限を1つ以上選んでください');
      return;
    }
    setCreatingAgentToken(true);
    try {
      const res = await apiFetch('/api/agent-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, scopes, expiresInDays: agentDays }),
      });
      const data = await res.json().catch(() => ({})) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setAgentError(data.error || 'トークンを作成できませんでした');
        return;
      }
      setCreatedAgentPlaintext(data.token);
      setAgentName('');
      await fetchAgentTokens();
    } catch {
      setAgentError('通信に失敗しました');
    } finally {
      setCreatingAgentToken(false);
    }
  };

  const copyCreatedAgentToken = async () => {
    if (!createdAgentPlaintext) return;
    await navigator.clipboard.writeText(createdAgentPlaintext);
    setCopiedAgent(true);
    setTimeout(() => setCopiedAgent(false), 2000);
  };

  const revokeAgentAccessToken = async (id: number) => {
    if (!confirm('このエージェント用トークンを失効しますか？')) return;
    setAgentBusyId(id);
    setAgentError('');
    try {
      const res = await apiFetch(`/api/agent-tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setAgentError('失効できませんでした');
        return;
      }
      await fetchAgentTokens();
    } finally {
      setAgentBusyId(null);
    }
  };

  const undoAgentAdditions = async (id: number) => {
    if (!confirm('このトークンが追加した品目をまとめてゴミ箱へ移しますか？')) return;
    setAgentBusyId(id);
    setAgentError('');
    try {
      const res = await apiFetch(`/api/agent-tokens/${id}/undo`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { moved?: number; error?: string };
      if (!res.ok) {
        setAgentError(data.error || '取り消しに失敗しました');
        return;
      }
      alert(`${data.moved ?? 0} 件をゴミ箱へ移しました`);
    } finally {
      setAgentBusyId(null);
    }
  };

  const loadAgentAudit = async (id: number) => {
    if (agentAuditId === id) {
      setAgentAuditId(null);
      setAgentAuditEntries([]);
      return;
    }
    setAgentBusyId(id);
    try {
      const res = await apiFetch(`/api/agent-tokens/${id}/audit`);
      if (!res.ok) {
        setAgentError('操作ログを取得できませんでした');
        return;
      }
      const data = await res.json() as { entries: typeof agentAuditEntries };
      setAgentAuditId(id);
      setAgentAuditEntries(data.entries || []);
    } finally {
      setAgentBusyId(null);
    }
  };

  const changePassword = async () => {
    if (savingPassword) return;
    setPasswordError('');
    setPasswordMessage('');
    setSavingPassword(true);
    try {
      const res = await apiFetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setPasswordError(data.error || 'パスワードを変更できませんでした');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage('パスワードを変更し、エージェント用トークンをすべて失効しました');
      await fetchAgentTokens();
    } catch {
      setPasswordError('通信に失敗しました');
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-[var(--color-muted)]">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* ヘッダー */}
      <header className="bg-[var(--color-secondary)] text-white">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2">
            <Crown size={24} className="text-[var(--color-accent)]" />
            <h1 className="text-lg font-medium tracking-wide">物欲王</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-text)] mb-6"
        >
          <ArrowLeft size={18} />
          戻る
        </Link>

        <h2 className="text-xl font-bold text-[var(--color-text)] mb-6">設定</h2>

        <div className="space-y-4">
          {/* アカウント情報 (折りたたみなし) */}
          <div className="bg-[var(--color-card)] rounded-lg shadow p-6">
            <h3 className="font-semibold text-[var(--color-text)] mb-4">アカウント情報</h3>
            <div className="space-y-2 text-sm">
              <div className="flex">
                <span className="text-[var(--color-muted)] w-32">メール:</span>
                <span className="text-[var(--color-text)]">{isGuest ? 'ゲスト（体験データは一時保存）' : user.email}</span>
              </div>
              {user.name && (
                <div className="flex">
                  <span className="text-[var(--color-muted)] w-32">名前:</span>
                  <span className="text-[var(--color-text)]">{user.name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[var(--color-card)] rounded-lg shadow p-6">
            <h3 className="font-semibold text-[var(--color-text)] mb-2">プライバシーと利用規約</h3>
            <LegalLinks />
          </div>

          {/* カテゴリ管理 */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('categories')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Tag size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">カテゴリ管理</h3>
                <span className="text-sm text-[var(--color-muted)]">({categories.length})</span>
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
                {categories.length === 0 ? <p className="text-[var(--color-muted)] text-sm">カテゴリがありません</p> : (
                  <div className="space-y-2">
                    {categories.map((cat) => (
                      <div key={cat.id} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-slate-700 rounded-md">
                        {editingCategoryId === cat.id ? (
                          <>
                            <input type="color" value={editCategoryColor} onChange={(e) => setEditCategoryColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                            <input type="text" value={editCategoryName} onChange={(e) => setEditCategoryName(e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" autoFocus />
                            <button onClick={handleUpdateCategory} className="text-green-500 hover:text-green-600"><Check size={18} /></button>
                            <button onClick={() => setEditingCategoryId(null)} className="text-gray-400 dark:text-gray-500 hover:text-[var(--color-muted)]"><X size={18} /></button>
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
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('groups')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Layers size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">比較グループ管理</h3>
                <span className="text-sm text-[var(--color-muted)]">({groups.length})</span>
              </div>
              {openSections.groups ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.groups && (
              <div className="px-4 pb-4 border-t">
                <div className="flex gap-2 my-4">
                  <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新しいグループ名" className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm" />
                  <button onClick={handleAddGroup} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-1"><Plus size={18} /> 追加</button>
                </div>
                {groups.length === 0 ? <p className="text-[var(--color-muted)] text-sm">比較グループがありません</p> : (
                  <div className="space-y-2">
                    {groups.map((group) => (
                      <div key={group.id} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-slate-700 rounded-md">
                        {editingGroupId === group.id ? (
                          <>
                            <input type="text" value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" autoFocus />
                            <button onClick={handleUpdateGroup} className="text-green-500 hover:text-green-600"><Check size={18} /></button>
                            <button onClick={() => setEditingGroupId(null)} className="text-gray-400 dark:text-gray-500 hover:text-[var(--color-muted)]"><X size={18} /></button>
                          </>
                        ) : (
                          <>
                            <Layers size={16} className="text-[var(--color-primary)]" />
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

          {/* テーマ設定 */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('theme')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Sun size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">テーマ</h3>
              </div>
              {openSections.theme ? <ChevronUp size={20} className="text-[var(--color-muted)]" /> : <ChevronDown size={20} className="text-[var(--color-muted)]" />}
            </button>
            {openSections.theme && (
              <div className="px-4 pb-4 border-t border-[var(--color-border)]">
                {/* カラースキーム */}
                <div className="pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Palette size={16} className="text-[var(--color-muted)]" />
                    <span className="text-sm font-medium text-[var(--color-text)]">カラースキーム</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setColorScheme('wa-modern')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        colorScheme === 'wa-modern'
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-[#c53d43]"></span>
                      和モダン
                    </button>
                    <button
                      onClick={() => setColorScheme('default')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        colorScheme === 'default'
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-[#f97316]"></span>
                      デフォルト
                    </button>
                  </div>
                </div>
                
                {/* 明るさ */}
                <div className="pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sun size={16} className="text-[var(--color-muted)]" />
                    <span className="text-sm font-medium text-[var(--color-text)]">明るさ</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTheme('light')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        theme === 'light'
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <Sun size={16} />
                      ライト
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        theme === 'dark'
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <Moon size={16} />
                      ダーク
                    </button>
                    <button
                      onClick={() => setTheme('system')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        theme === 'system'
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <Monitor size={16} />
                      自動
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {isGuest && <p className="p-4 rounded bg-amber-50 text-amber-900">通知設定と拡張機能はログイン後に利用できます。</p>}
          {!isGuest && <>
          {/* 価格通知設定 */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('notify')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Bell size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">価格通知設定</h3>
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
                  <label className="flex items-center gap-2"><input type="checkbox" checked={notifySettings.notify_on_price_drop} onChange={(e) => setNotifySettings({ ...notifySettings, notify_on_price_drop: e.target.checked })} className="rounded border-gray-300 dark:border-slate-600 text-[var(--color-primary)]" /><span className="text-sm text-gray-700">価格が下がったら通知</span></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={notifySettings.notify_on_target_price} onChange={(e) => setNotifySettings({ ...notifySettings, notify_on_target_price: e.target.checked })} className="rounded border-gray-300 dark:border-slate-600 text-[var(--color-primary)]" /><span className="text-sm text-gray-700">目標価格に達したら通知</span></label>
                </div>
                <button onClick={saveNotifySettings} disabled={savingNotify} className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md hover:bg-[var(--color-primary-hover)] disabled:opacity-50 flex items-center gap-2">
                  {savingNotify ? <><Loader2 size={18} className="animate-spin" /> 保存中...</> : notifySaved ? <><Check size={18} /> 保存しました</> : '保存'}
                </button>
              </div>
            )}
          </div>

          {/* エージェント用トークン */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('agentTokens')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Bot size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">エージェント用トークン</h3>
                <span className="text-sm text-[var(--color-muted)]">({agentTokens.filter((t) => t.active).length})</span>
              </div>
              {openSections.agentTokens ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.agentTokens && (
              <div className="px-4 pb-4 border-t pt-4 space-y-4">
                <p className="text-sm text-[var(--color-muted)]">
                  AI エージェントからリストを読む・品目を追加するためのトークンです。平文は作成時に一度だけ表示します。パスワードを変更するとすべて失効します（ログアウトでは失効しません）。
                </p>
                <div className="space-y-3 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-md">
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="名前（例: Cursor）"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
                    maxLength={100}
                  />
                  <div className="flex flex-wrap gap-4 text-sm text-[var(--color-text)]">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={agentScopeRead} onChange={(e) => setAgentScopeRead(e.target.checked)} />
                      読み取り (read)
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={agentScopeWrite} onChange={(e) => setAgentScopeWrite(e.target.checked)} />
                      書き込み (write)
                    </label>
                  </div>
                  <label className="block text-sm text-[var(--color-text)]">
                    有効期限（日）
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={agentDays}
                      onChange={(e) => setAgentDays(Number(e.target.value) || 90)}
                      className="mt-1 w-28 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
                    />
                    <span className="ml-2 text-[var(--color-muted)]">既定 90 / 最長 365</span>
                  </label>
                  <button
                    type="button"
                    onClick={createAgentAccessToken}
                    disabled={creatingAgentToken || !agentName.trim()}
                    className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md hover:bg-[var(--color-primary-hover)] disabled:opacity-50 flex items-center gap-2"
                  >
                    {creatingAgentToken ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                    トークンを作成
                  </button>
                </div>
                {createdAgentPlaintext && (
                  <div className="p-3 border border-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-md space-y-2">
                    <p className="text-sm text-amber-900 dark:text-amber-100 font-medium">このトークンは今だけ表示されます。コピーして安全な場所に保存してください。</p>
                    <div className="flex gap-2">
                      <input type="text" value={createdAgentPlaintext} readOnly className="flex-1 px-3 py-2 border rounded-md bg-white dark:bg-slate-800 text-sm font-mono" />
                      <button type="button" onClick={copyCreatedAgentToken} className="px-3 py-2 bg-blue-500 text-white rounded-md flex items-center gap-1">
                        {copiedAgent ? <Check size={16} /> : <Copy size={16} />}
                        {copiedAgent ? 'コピーした' : 'コピー'}
                      </button>
                    </div>
                  </div>
                )}
                {agentError && <p className="text-sm text-red-600">{agentError}</p>}
                {agentTokens.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">まだトークンがありません</p>
                ) : (
                  <div className="space-y-3">
                    {agentTokens.map((t) => (
                      <div key={t.id} className="p-3 border border-[var(--color-border)] rounded-md space-y-2">
                        <div className="flex flex-wrap items-center gap-2 justify-between">
                          <div>
                            <div className="font-medium text-[var(--color-text)]">{t.name}</div>
                            <div className="text-xs font-mono text-[var(--color-muted)]">{t.token_prefix}…</div>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded ${t.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                            {t.active ? '有効' : '失効または期限切れ'}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--color-muted)] space-y-0.5">
                          <div>権限: {t.scopes.join(', ')}</div>
                          <div>期限: {t.expires_at}</div>
                          {t.revoked_at && <div>失効: {t.revoked_at}</div>}
                          {t.last_used_at && <div>最終利用: {t.last_used_at}</div>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {t.active && (
                            <button
                              type="button"
                              disabled={agentBusyId === t.id}
                              onClick={() => revokeAgentAccessToken(t.id)}
                              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md disabled:opacity-50"
                            >
                              失効
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={agentBusyId === t.id}
                            onClick={() => undoAgentAdditions(t.id)}
                            className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded-md disabled:opacity-50"
                          >
                            追加分をゴミ箱へ
                          </button>
                          <button
                            type="button"
                            disabled={agentBusyId === t.id}
                            onClick={() => loadAgentAudit(t.id)}
                            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md disabled:opacity-50"
                          >
                            {agentAuditId === t.id ? 'ログを閉じる' : '操作ログ'}
                          </button>
                        </div>
                        {agentAuditId === t.id && (
                          <div className="text-xs bg-gray-50 dark:bg-slate-800 rounded p-2 max-h-48 overflow-auto space-y-1">
                            {agentAuditEntries.length === 0 ? (
                              <p className="text-[var(--color-muted)]">ログはありません（90日保持）</p>
                            ) : agentAuditEntries.map((entry) => (
                              <div key={entry.id} className="font-mono">
                                <span className="text-[var(--color-muted)]">{entry.created_at}</span>{' '}
                                {entry.action}
                                {entry.meta ? ` ${entry.meta}` : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* パスワード変更 */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('password')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Lock size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">パスワード変更</h3>
              </div>
              {openSections.password ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.password && (
              <div className="px-4 pb-4 border-t pt-4 space-y-3">
                <p className="text-sm text-[var(--color-muted)]">変更するとエージェント用トークンはすべて失効します。ログアウトでは失効しません。</p>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="現在のパスワード"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
                  autoComplete="current-password"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新しいパスワード（6文字以上）"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm"
                  autoComplete="new-password"
                />
                {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
                {passwordMessage && <p className="text-sm text-green-700">{passwordMessage}</p>}
                <button
                  type="button"
                  onClick={changePassword}
                  disabled={savingPassword || !currentPassword || newPassword.length < 6}
                  className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md disabled:opacity-50 flex items-center gap-2"
                >
                  {savingPassword ? <Loader2 size={18} className="animate-spin" /> : null}
                  変更する
                </button>
              </div>
            )}
          </div>

          {/* Chrome拡張機能用トークン */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('token')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Key size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">Chrome拡張機能用トークン</h3>
              </div>
              {openSections.token ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.token && (
              <div className="px-4 pb-4 border-t pt-4">
                <p className="text-sm text-[var(--color-muted)] mb-4">Chrome拡張機能でほしいものリストをインポートする際に必要です。</p>
                {displayToken ? (
                  <div className="flex gap-2">
                    <input type="text" value={displayToken} readOnly className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-gray-50 dark:bg-slate-700 text-sm font-mono" />
                    <button onClick={copyToken} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2">
                      {copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'コピーした' : 'コピー'}
                    </button>
                  </div>
                ) : <div className="text-[var(--color-muted)]">トークンを取得中...</div>}
                <p className="text-xs text-[var(--color-muted)] mt-2">※ このトークンは他人に共有しないでください</p>
              </div>
            )}
          </div>

          <div className="bg-[var(--color-card)] rounded-lg shadow p-6">
            <h3 className="font-semibold text-[var(--color-text)] mb-2">退会</h3>
            <p className="text-sm text-[var(--color-muted)] mb-4">アカウントと登録したデータを削除します。元に戻せません。</p>
            {accountError && <p className="text-sm text-red-600 mb-3">{accountError}</p>}
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deletingAccount}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {deletingAccount ? '退会しています...' : '退会する'}
            </button>
          </div>

          </>}
          {/* データエクスポート */}
          <div className="bg-[var(--color-card)] rounded-lg shadow">
            <button onClick={() => toggleSection('export')} className="w-full p-4 flex items-center justify-between hover:bg-[var(--color-border)] rounded-lg">
              <div className="flex items-center gap-2">
                <Download size={20} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold text-[var(--color-text)]">データエクスポート</h3>
              </div>
              {openSections.export ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {openSections.export && (
              <div className="px-4 pb-4 border-t pt-4">
                <p className="text-sm text-[var(--color-muted)] mb-4">データをCSV形式でダウンロードできます。</p>
                <div className="flex flex-wrap gap-3">
                  <a href="/api/export?filter=wishlist" className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2"><Download size={18} />ほしいものリスト</a>
                  <a href="/api/export?filter=purchased" className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 flex items-center gap-2"><Download size={18} />購入済み</a>
                  <a href="/api/export?filter=all" className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center gap-2"><Download size={18} />すべて</a>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
