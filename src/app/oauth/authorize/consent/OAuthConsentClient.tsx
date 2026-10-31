'use client';

import { useState } from 'react';
import LoginForm from '@/components/LoginForm';
import { useAuth } from '@/components/AuthProvider';

type Props = {
  pendingId: string;
  csrf: string;
  clientName: string;
  clientId: string;
  scopes: string[];
  resource: string;
  redirectUri: string;
};

export default function OAuthConsentClient({
  pendingId,
  csrf,
  clientName,
  clientId,
  scopes,
  resource,
  redirectUri,
}: Props) {
  const { user, loading, isGuest } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const authorizeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/oauth/authorize/consent?pending=${encodeURIComponent(pendingId)}`
      : `/oauth/authorize/consent?pending=${encodeURIComponent(pendingId)}`;

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/oauth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_id: pendingId, decision, csrf }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : '処理に失敗しました');
        setBusy(false);
        return;
      }
      if (typeof data.redirect_url === 'string') {
        window.location.assign(data.redirect_url);
        return;
      }
      setError('リダイレクト先がありません');
      setBusy(false);
    } catch {
      setError('通信に失敗しました');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
        <p role="status">読み込み中...</p>
      </main>
    );
  }

  if (!user || isGuest) {
    return (
      <div>
        <div className="bg-amber-50 text-amber-950 p-3 text-sm text-center">
          エージェント連携の認可には会員ログインが必要です（ゲスト不可）
        </div>
        <LoginForm callbackUrl={authorizeUrl} hideGuest />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">エージェント連携の許可</h1>
        <p>
          <strong>{clientName}</strong>
          {' '}
          が、あなたの物欲王リストへアクセスしようとしています。
        </p>
        <dl className="text-sm space-y-2">
          <div>
            <dt className="font-medium">クライアント</dt>
            <dd className="break-all text-[var(--color-muted)]">{clientId}</dd>
          </div>
          <div>
            <dt className="font-medium">権限</dt>
            <dd>{scopes.join(', ') || 'read, write'}</dd>
          </div>
          <div>
            <dt className="font-medium">接続先</dt>
            <dd className="break-all">{resource}</dd>
          </div>
          <div>
            <dt className="font-medium">戻り先</dt>
            <dd className="break-all text-[var(--color-muted)]">{redirectUri}</dd>
          </div>
        </dl>
        {error && <p role="alert" className="text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('approve')}
            className="flex-1 py-3 rounded-md bg-amber-600 text-white font-medium disabled:opacity-50"
          >
            許可する
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide('deny')}
            className="flex-1 py-3 rounded-md border border-gray-300 dark:border-slate-600 disabled:opacity-50"
          >
            拒否する
          </button>
        </div>
      </div>
    </main>
  );
}
