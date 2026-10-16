'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, Fragment, ReactNode } from 'react';
import { useSession, signOut as nextAuthSignOut } from 'next-auth/react';

interface User {
  id: number;
  account_type: 'member' | 'guest';
  email: string | null;
  name: string | null;
  expiresAt?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  isGuest: boolean;
  guestEnabled: boolean;
  ttlHours: number;
  startGuest: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestEnabled, setGuestEnabled] = useState(false);
  const [ttlHours, setTtlHours] = useState(24);
  const [notice, setNotice] = useState('');
  const revision = useRef(0);
  const currentUser = useRef<User | null>(null);

  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok && res.status !== 401) throw new Error('ログイン状態を確認できません。画面を再読み込みしてください。');
      const data = res.ok ? await res.json() : null;
      const next: User | null = data?.user || null;
      if (version !== revision.current) return;
      if (!next && currentUser.current?.account_type === 'guest') setNotice('ゲスト体験が終了しました。期限切れ、または別のタブで終了された可能性があります。');
      if (currentUser.current?.id !== next?.id) setToken(null);
      currentUser.current = next;
      setUser(next);
      if (next?.account_type === 'member' && data?.hasGuestSession) {
        // Only discard the guest cookie after the server has confirmed member auth.
        try {
          const ended = await fetch('/api/auth/guest', { method: 'DELETE' });
          if (!ended.ok) throw new Error('Guest cleanup failed');
        } catch {
          if (version === revision.current) setNotice('ログインしました。体験データの削除に失敗したため、有効期限後に自動削除されます。');
        }
      }
    } catch (error) {
      if (version !== revision.current) return;
      currentUser.current = null;
      setUser(null);
      setNotice(error instanceof Error ? error.message : '通信に失敗しました');
    } finally {
      if (version === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'loading') void refresh();
    return () => { revision.current++; };
  }, [status, refresh]);

  useEffect(() => {
    fetch('/api/auth/guest', { cache: 'no-store' }).then(r => r.json()).then(data => {
      setGuestEnabled(data.enabled === true);
      setTtlHours(data.ttlHours || 24);
    }).catch(() => setGuestEnabled(false));
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const expired = () => {
      revision.current++;
      currentUser.current = null;
      setUser(null);
      setToken(null);
      setNotice('セッションが終了しました。ログイン画面から入り直してください。');
      void refresh();
    };
    const apiError = (event: Event) => setNotice((event as CustomEvent<string>).detail);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('session-expired', expired);
    window.addEventListener('api-error', apiError);
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('session-expired', expired);
      window.removeEventListener('api-error', apiError);
    };
  }, [refresh]);

  useEffect(() => {
    if (!user?.expiresAt) return;
    const timer = setTimeout(() => void refresh(), Math.max(0, new Date(user.expiresAt).getTime() - Date.now()) + 100);
    return () => clearTimeout(timer);
  }, [user?.expiresAt, refresh]);

  const authenticate = async (path: string, body?: object) => {
    setNotice('');
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ログインに失敗しました');
    await refresh();
    if (data.token && currentUser.current?.id === data.user.id) setToken(data.token);
  };

  const logout = async () => {
    try {
      if (user?.account_type === 'guest') {
        if (!window.confirm('ゲスト体験を終了すると、追加・編集したデータは削除されます。終了しますか？')) return;
        const res = await fetch('/api/auth/guest', { method: 'DELETE' });
        if (!res.ok) { setNotice('体験を終了できませんでした。もう一度お試しください。'); return; }
      } else {
        const res = await fetch('/api/auth/logout', { method: 'POST' });
        if (!res.ok) { setNotice('ログアウトに失敗しました'); return; }
        await nextAuthSignOut({ redirect: false });
      }
      revision.current++;
      currentUser.current = null;
      setUser(null);
      setToken(null);
      setNotice('');
    } catch { setNotice('通信に失敗しました。もう一度お試しください。'); }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, isGuest: user?.account_type === 'guest', guestEnabled, ttlHours,
      startGuest: () => authenticate('/api/auth/guest'),
      login: (email, password) => authenticate('/api/auth/login', { email, password }),
      register: (email, password, name) => authenticate('/api/auth/register', { email, password, name }), logout }}>
      {notice && <div role="alert" className="bg-amber-100 text-amber-950 p-3 flex justify-between gap-4"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="お知らせを閉じる">×</button></div>}
      {loading ? <div className="p-12 text-center" role="status">読み込み中...</div> :
        <Fragment key={user ? `${user.account_type}:${user.id}` : 'anonymous'}>{children}</Fragment>}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
