'use client';

import { useState, useEffect } from 'react';
import { X, Upload, AlertCircle, CheckCircle, Loader2, Info, ExternalLink } from 'lucide-react';

interface ImportWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

interface SkippedItem {
  name: string;
  reason: string;
}

interface ImportResult {
  success: boolean;
  listName?: string;
  source?: string;
  total?: number;
  imported?: number;
  skipped?: number;
  skippedItems?: SkippedItem[];
  importedItems?: string[];
  message?: string;
  error?: string;
}

type ValidationState = 'idle' | 'valid' | 'invalid';

export default function ImportWishlistModal({ isOpen, onClose, onImported }: ImportWishlistModalProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [showSkippedDetails, setShowSkippedDetails] = useState(false);

  // URLバリデーション
  useEffect(() => {
    if (!url.trim()) {
      setValidation('idle');
      return;
    }
    
    const isAmazon = /amazon\.(co\.jp|jp|com)\/.*wishlist/i.test(url);
    const isRakuten = /rakuten\.co\.jp/i.test(url);
    
    setValidation(isAmazon || isRakuten ? 'valid' : 'invalid');
  }, [url]);

  const handleImport = async () => {
    if (!url.trim() || validation !== 'valid') return;

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
        if (data.imported > 0) {
          onImported();
        }
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
    setShowSkippedDetails(false);
    onClose();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      // クリップボードアクセス失敗
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="wa-card rounded-lg max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gofun)]">
          <h2 className="font-medium text-[var(--sumi)]">{
            result?.success ? 'インポート完了' : 'リストをインポート'
          }</h2>
          <button onClick={handleClose} className="text-[var(--nezumi)] hover:text-[var(--sumi)]">
            <X size={18} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* インポート前のフォーム */}
          {!result && (
            <>
              {/* 説明 */}
              <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: 'var(--gofun)' }}>
                <Info size={16} className="flex-shrink-0 mt-0.5 text-[var(--ai)]" />
                <div className="text-xs text-[var(--nezumi)]">
                  <p className="font-medium text-[var(--sumi)] mb-1">Amazonほしいものリストは「公開」設定が必要です</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Amazonのほしいものリストを開く</li>
                    <li>「リストの設定」→「公開/非公開」を「公開」に</li>
                    <li>URLをコピーして下に貼り付け</li>
                  </ol>
                </div>
              </div>

              {/* URL入力 */}
              <div>
                <label className="block text-sm text-[var(--nezumi)] mb-1.5">ウィッシュリストURL</label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://www.amazon.co.jp/hz/wishlist/ls/..."
                      className="wa-input w-full px-3 py-2.5 rounded text-sm pr-10"
                      disabled={loading}
                    />
                    {validation === 'valid' && (
                      <CheckCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
                    )}
                    {validation === 'invalid' && (
                      <AlertCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500" />
                    )}
                  </div>
                  <button
                    onClick={handlePaste}
                    className="px-3 py-2 text-sm rounded border border-[var(--gofun)] text-[var(--nezumi)] hover:bg-[var(--gofun)]"
                    title="貼り付け"
                  >
                    貼付
                  </button>
                </div>
                {validation === 'valid' && (
                  <p className="text-xs text-green-600 mt-1">✓ 有効なURLです</p>
                )}
                {validation === 'invalid' && (
                  <p className="text-xs text-red-500 mt-1">Amazonまたは楽天のウィッシュリストURLを入力してください</p>
                )}
              </div>

              {/* 対応サイト */}
              <div className="text-xs text-[var(--nezumi)]">
                <span className="font-medium">対応:</span> Amazon (co.jp/jp/com) / 楽天お気に入り
              </div>
            </>
          )}

          {/* ローディング */}
          {loading && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="animate-spin text-[var(--ai)] mb-3" size={32} />
              <p className="text-sm text-[var(--sumi)] font-medium">アイテムを取得しています...</p>
              <p className="text-xs text-[var(--nezumi)] mt-1">数十秒かかる場合があります</p>
            </div>
          )}

          {/* エラー */}
          {result && !result.success && (
            <div className="wa-error rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-sm font-medium">インポートに失敗しました</p>
                  <p className="text-sm mt-1">{result.error}</p>
                </div>
              </div>
              <div className="mt-3 text-xs">
                <p className="font-medium mb-1">解決方法:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[var(--sumi)]">
                  <li>リストが「公開」設定になっているか確認</li>
                  <li>URLが正しいか確認</li>
                  <li>時間をおいて再試行</li>
                </ul>
              </div>
            </div>
          )}

          {/* 成功 */}
          {result && result.success && (
            <div className="space-y-4">
              {/* サマリー */}
              <div className="wa-success rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={20} />
                  <span className="font-medium">{result.message}</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-2xl font-bold">{result.imported}</span>
                    <span className="text-[var(--nezumi)] ml-1">件インポート</span>
                  </div>
                  {(result.skipped ?? 0) > 0 && (
                    <div>
                      <span className="text-2xl font-bold text-[var(--nezumi)]">{result.skipped}</span>
                      <span className="text-[var(--nezumi)] ml-1">件スキップ</span>
                    </div>
                  )}
                </div>
              </div>

              {/* インポートされたアイテム */}
              {result.importedItems && result.importedItems.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-[var(--sumi)] mb-2">インポートされたアイテム:</p>
                  <ul className="text-xs text-[var(--nezumi)] space-y-1">
                    {result.importedItems.map((name, i) => (
                      <li key={i} className="truncate">✓ {name}</li>
                    ))}
                    {(result.imported ?? 0) > 5 && (
                      <li className="text-[var(--ai)]">...他 {(result.imported ?? 0) - 5}件</li>
                    )}
                  </ul>
                </div>
              )}

              {/* スキップされたアイテム */}
              {result.skippedItems && result.skippedItems.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowSkippedDetails(!showSkippedDetails)}
                    className="text-sm text-[var(--ai)] hover:underline flex items-center gap-1"
                  >
                    {showSkippedDetails ? '▼' : '▶'} スキップされたアイテムの詳細
                  </button>
                  {showSkippedDetails && (
                    <ul className="mt-2 text-xs space-y-2 max-h-40 overflow-y-auto">
                      {result.skippedItems.map((item, i) => (
                        <li key={i} className="p-2 rounded" style={{ background: 'var(--gofun)' }}>
                          <p className="font-medium text-[var(--sumi)] truncate">{item.name}</p>
                          <p className="text-[var(--nezumi)]">{item.reason}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--gofun)] bg-[var(--gofun)]">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-[var(--nezumi)] hover:text-[var(--sumi)]"
          >
            {result?.success ? '閉じる' : 'キャンセル'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={loading || validation !== 'valid'}
              className="px-4 py-2 text-sm text-white rounded disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: 'var(--ai)' }}
            >
              <Upload size={14} />
              インポート開始
            </button>
          )}
          {result?.success && result.imported === 0 && (
            <button
              onClick={() => setResult(null)}
              className="px-4 py-2 text-sm text-white rounded flex items-center gap-1.5"
              style={{ background: 'var(--ai)' }}
            >
              別のURLで試す
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
