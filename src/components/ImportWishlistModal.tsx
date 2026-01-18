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
        setResult({ success: true, ...data });
        onImported();
      }
    } catch {
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="wa-card rounded-lg max-w-md w-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gofun)]">
          <h2 className="font-medium text-[var(--sumi)]">リストをインポート</h2>
          <button onClick={handleClose} className="text-[var(--nezumi)] hover:text-[var(--sumi)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm text-[var(--nezumi)] mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.amazon.co.jp/hz/wishlist/ls/..."
              className="wa-input w-full px-3 py-2 rounded text-sm"
              disabled={loading}
            />
          </div>

          <p className="text-xs text-[var(--nezumi)]">
            対応: Amazon (co.jp/jp/com) / 楽天お気に入り（公開設定が必要）
          </p>

          {loading && (
            <div className="flex items-center py-3 text-sm text-[var(--nezumi)]">
              <Loader2 className="animate-spin mr-2" size={16} />
              インポート中...
            </div>
          )}

          {result && !result.success && (
            <div className="flex items-start gap-2 wa-error rounded p-2">
              <AlertCircle className="flex-shrink-0 mt-0.5" size={16} />
              <p className="text-sm">{result.error}</p>
            </div>
          )}

          {result && result.success && (
            <div className="wa-success rounded p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle size={16} />
                <span className="text-sm font-medium">完了</span>
              </div>
              <p className="text-xs">
                {result.listName}: {result.imported}件インポート
                {result.skipped ? ` / ${result.skipped}件スキップ` : ''}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--gofun)] bg-[var(--gofun)]">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-sm text-[var(--nezumi)] hover:text-[var(--sumi)]"
          >
            閉じる
          </button>
          <button
            onClick={handleImport}
            disabled={loading || !url.trim()}
            className="px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 flex items-center gap-1"
            style={{ background: 'var(--ai)' }}
          >
            <Upload size={14} />
            インポート
          </button>
        </div>
      </div>
    </div>
  );
}
