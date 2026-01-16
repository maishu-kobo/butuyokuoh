'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Crown, ArrowLeft, Copy, Check, Key } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [displayToken, setDisplayToken] = useState<string | null>(null);

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
    if (user) {
      fetchToken();
    }
  }, [user]);

  const copyToken = async () => {
    if (displayToken) {
      await navigator.clipboard.writeText(displayToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    );
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
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft size={18} />
          戻る
        </Link>

        <h2 className="text-xl font-bold text-gray-900 mb-6">設定</h2>

        <div className="space-y-6">
          {/* アカウント情報 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-semibold text-gray-900 mb-4">アカウント情報</h3>
            <div className="space-y-2 text-sm">
              <div className="flex">
                <span className="text-gray-500 w-32">メール:</span>
                <span className="text-gray-900">{user.email}</span>
              </div>
              {user.name && (
                <div className="flex">
                  <span className="text-gray-500 w-32">名前:</span>
                  <span className="text-gray-900">{user.name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Chrome拡張機能用トークン */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Key size={20} className="text-orange-500" />
              <h3 className="font-semibold text-gray-900">Chrome拡張機能用トークン</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Chrome拡張機能でほしいものリストをインポートする際に必要です。
            </p>
            {displayToken ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={displayToken}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono"
                />
                <button
                  onClick={copyToken}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2"
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  {copied ? 'コピーした' : 'コピー'}
                </button>
              </div>
            ) : (
              <div className="text-gray-500">トークンを取得中...</div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              ※ このトークンは他人に共有しないでください
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
