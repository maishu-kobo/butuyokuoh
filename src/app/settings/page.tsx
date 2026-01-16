'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Crown, ArrowLeft, Copy, Check, Key, Bell, Loader2, Download } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { user, token, loading } = useAuth();
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
    }
  }, [user]);

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

          {/* データエクスポート */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Download size={20} className="text-orange-500" />
              <h3 className="font-semibold text-gray-900">データエクスポート</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              データをCSV形式でダウンロードできます。ExcelやGoogleスプレッドシートで開けます。
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/export?filter=wishlist"
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center gap-2"
              >
                <Download size={18} />
                ほしいものリスト
              </a>
              <a
                href="/api/export?filter=purchased"
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 flex items-center gap-2"
              >
                <Download size={18} />
                購入済み
              </a>
              <a
                href="/api/export?filter=all"
                className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 flex items-center gap-2"
              >
                <Download size={18} />
                すべて
              </a>
            </div>
          </div>

          {/* 価格通知設定 */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-4">
              <Bell size={20} className="text-orange-500" />
              <h3 className="font-semibold text-gray-900">価格通知設定</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              価格が下がったときや目標価格に達したときに通知を受け取れます。
            </p>
            
            <div className="space-y-4">
              {/* Slack */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Slack Webhook URL
                </label>
                <input
                  type="url"
                  value={notifySettings.slack_webhook}
                  onChange={(e) => setNotifySettings({ ...notifySettings, slack_webhook: e.target.value })}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                    Webhook URLの取得方法
                  </a>
                </p>
              </div>

              {/* Discord */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Discord Webhook URL
                </label>
                <input
                  type="url"
                  value={notifySettings.discord_webhook}
                  onChange={(e) => setNotifySettings({ ...notifySettings, discord_webhook: e.target.value })}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  サーバー設定 → 連携サービス → ウェブフック → 新しいウェブフック
                </p>
              </div>

              {/* 通知オプション */}
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifySettings.notify_on_price_drop}
                    onChange={(e) => setNotifySettings({ ...notifySettings, notify_on_price_drop: e.target.checked })}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">価格が下がったら通知</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifySettings.notify_on_target_price}
                    onChange={(e) => setNotifySettings({ ...notifySettings, notify_on_target_price: e.target.checked })}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">目標価格に達したら通知</span>
                </label>
              </div>

              <button
                onClick={saveNotifySettings}
                disabled={savingNotify}
                className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
              >
                {savingNotify ? (
                  <><Loader2 size={18} className="animate-spin" /> 保存中...</>
                ) : notifySaved ? (
                  <><Check size={18} /> 保存しました</>
                ) : (
                  '保存'
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
