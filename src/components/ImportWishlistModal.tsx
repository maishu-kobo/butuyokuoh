'use client';

import { useState } from 'react';
import { X, Upload, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface ImportWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

interface ImportResult {
  success: boolean;
  listName?: string;
  source?: string;
  total?: number;
  imported?: number;
  skipped?: number;
  error?: string;
}

export default function ImportWishlistModal({ isOpen, onClose, onImported }: ImportWishlistModalProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    if (!url.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/import-wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ success: false, error: data.error });
      } else {
        setResult({
          success: true,
          ...data,
        });
        onImported();
      }
    } catch (err) {
      setResult({ success: false, error: 'インポートに失敗しました' });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setResult(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">ほしいものリストをインポート</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ほしいものリストのURL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.amazon.co.jp/hz/wishlist/ls/..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm text-blue-800 font-medium mb-2">対応サイト:</p>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Amazon ほしいものリスト（公開設定が必要）</li>
              <li>• 楽天 お気に入り（公開設定が必要）</li>
            </ul>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-4 text-gray-600">
              <Loader2 className="animate-spin mr-2" size={20} />
              <span>インポート中...（数十秒かかる場合があります）</span>
            </div>
          )}

          {result && !result.success && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-md p-3">
              <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
              <p className="text-sm text-red-700">{result.error}</p>
            </div>
          )}

          {result && result.success && (
            <div className="bg-green-50 border border-green-200 rounded-md p-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="text-green-500" size={18} />
                <span className="font-medium text-green-800">インポート完了！</span>
              </div>
              <div className="text-sm text-green-700 space-y-1">
                <p>リスト名: {result.listName}</p>
                <p>取得件数: {result.total}件</p>
                <p>インポート: {result.imported}件</p>
                {result.skipped && result.skipped > 0 && (
                  <p>スキップ（登録済み）: {result.skipped}件</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            閉じる
          </button>
          <button
            onClick={handleImport}
            disabled={loading || !url.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Upload size={18} />
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}
