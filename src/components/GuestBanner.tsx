'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useAuth } from './AuthProvider';

export default function GuestBanner() {
  const { user, isGuest, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isGuest || !user) return null;
  const login = async () => {
    if (!window.confirm('Googleでログインすると、ゲスト体験のデータは引き継がれず削除されます。続けますか？')) return;
    setBusy(true);
    try { await signIn('google', { callbackUrl: '/' }); }
    catch { setError('ログインを開始できませんでした。体験データは引き続き利用できます。'); setBusy(false); }
  };
  return <aside aria-label="ゲスト体験" className="bg-amber-50 dark:bg-amber-950 border-b border-amber-300 px-4 py-3 text-sm">
    <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-bold">ゲスト体験中 · サンプル商品・価格はデモです</p>
        <p>期限: {new Date(user.expiresAt!).toLocaleString('ja-JP')}。期限・体験終了後に削除され、ログイン後には引き継がれません。</p>
        <p className="text-xs mt-1">手動追加・編集・比較・予算を体験できます。URL取得・インポート・画像追加・通知・拡張機能はログイン後に利用できます。</p>
      </div>
      <div className="flex gap-2"><button disabled={busy} onClick={login} className="rounded bg-amber-600 px-3 py-2 text-white disabled:opacity-50">Googleでログイン</button>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await logout(); } finally { setBusy(false); } }} className="rounded border border-amber-400 px-3 py-2">体験を終了</button></div>
      {error && <p role="alert">{error}</p>}
    </div>
  </aside>;
}
