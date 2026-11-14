'use client';

import { apiFetch } from '@/lib/api-fetch';
import { displayableItemImageUrl } from '@/lib/capture/image-hosts';
import { linkableHttpUrl } from '@/lib/http-url';

import { useEffect, useRef, useState } from 'react';
import { Item } from '@/types';
import { Trash2, Undo2, X, ExternalLink } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';

interface TrashItem extends Item {
  days_left: number;
}

type PendingPurge =
  | { kind: 'item'; id: number; name: string }
  | { kind: 'empty'; count: number };

export default function TrashView() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<PendingPurge | null>(null);
  const [busy, setBusy] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchItems = async () => {
    try {
      const res = await apiFetch('/api/trash');
      if (!res.ok) throw new Error(`Failed to fetch trash: ${res.status}`);
      const data = await res.json();
      // 非配列レスポンス（エラーJSON等）を配列stateに入れない
      if (!Array.isArray(data)) throw new Error('Unexpected response format');
      setItems(data);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to fetch trash:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 取得関数の中の setState は await のあと。effect から直接呼ぶと新しい react-hooks が同期 setState と誤認する。
    void (async () => { await fetchItems(); })();
  }, []);

  // 読み込み失敗時の再試行
  const handleRetry = () => {
    setLoadError(false);
    setLoading(true);
    fetchItems();
  };

  const handleRestore = async (id: number) => {
    await apiFetch(`/api/trash/${id}`, { method: 'POST' });
    fetchItems();
  };

  const openItemPurge = (item: TrashItem) => {
    if (inFlightRef.current) return;
    setPurgeError(null);
    setPending({ kind: 'item', id: item.id, name: item.name });
  };

  const openEmptyPurge = () => {
    if (inFlightRef.current || items.length === 0) return;
    setPurgeError(null);
    setPending({ kind: 'empty', count: items.length });
  };

  const closePurge = () => {
    if (inFlightRef.current) return;
    setPending(null);
    setPurgeError(null);
  };

  const confirmPurge = async () => {
    if (!pending || inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setPurgeError(null);
    try {
      const path = pending.kind === 'item' ? `/api/trash/${pending.id}` : '/api/trash';
      // 失敗案内はダイアログ内だけにする（バナーと二重にしない）。
      const res = await apiFetch(path, { method: 'DELETE' }, { notifyError: false });
      if (!res.ok) {
        setPurgeError(`削除に失敗しました（HTTP ${res.status}）。もう一度試せます。`);
        return;
      }
      setPending(null);
      await fetchItems();
    } catch {
      setPurgeError('通信に失敗しました。接続を確認して、もう一度試せます。');
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-500 dark:text-slate-400">読み込み中...</div>;
  }

  if (loadError) {
    return (
      <div className="text-center py-8 text-slate-500 dark:text-slate-400">
        <p>読み込みに失敗しました</p>
        <button
          onClick={handleRetry}
          className="mt-3 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
        >
          再試行
        </button>
      </div>
    );
  }

  const dialogTitle = pending?.kind === 'empty' ? 'ゴミ箱を空にする' : '完全に削除しますか？';
  const dialogConfirmLabel = pending?.kind === 'empty' ? 'ゴミ箱を空にする' : '完全に削除';
  const dialogDescription = pending?.kind === 'empty' ? (
    <>
      <p>{pending.count}件のアイテムを全件削除します。</p>
      <p className="font-medium text-red-600 dark:text-red-400">この操作は元に戻せません。</p>
    </>
  ) : pending ? (
    <>
      <p>
        「{pending.name}」を完全に削除します。
      </p>
      <p className="font-medium text-red-600 dark:text-red-400">この操作は元に戻せません。</p>
    </>
  ) : null;

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trash2 className="text-slate-500 dark:text-slate-400" size={24} />
          <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">ゴミ箱 ({items.length}件)</h2>
        </div>
        {items.length > 0 && (
          <button
            onClick={openEmptyPurge}
            className="px-3 py-1.5 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors dark:bg-red-950/40 dark:hover:bg-red-900/50"
          >
            ゴミ箱を空にする
          </button>
        )}
      </div>
      
      <p className="text-sm text-slate-500 dark:text-slate-400">
        削除したアイテムは7日間保持され、その後自動的に完全削除されます。
      </p>

      {items.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <Trash2 size={48} className="mx-auto mb-4 opacity-30" />
          <p>ゴミ箱は空です</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const image = displayableItemImageUrl(item.image_url);
            return (
            <div key={item.id} className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 flex items-center gap-4">
              {/* 画像 */}
              <div className="w-16 h-16 flex-shrink-0 bg-slate-100 dark:bg-slate-700 rounded">
                {image ? (
                  <img
                    src={image}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-contain rounded opacity-60"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
                    No Image
                  </div>
                )}
              </div>

              {/* 情報 */}
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-slate-700 dark:text-slate-200 truncate">{item.name}</h4>
                <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 dark:text-slate-400 flex-wrap">
                  <span>¥{item.current_price?.toLocaleString() || '---'}</span>
                  {item.category_name && (
                    <span
                      className="px-2 py-0.5 rounded text-xs"
                      style={{
                        backgroundColor: `${item.category_color}20`,
                        color: item.category_color || '#666',
                      }}
                    >
                      {item.category_name}
                    </span>
                  )}
                  <span className="text-red-500">
                    あと{item.days_left}日で削除
                  </span>
                </div>
              </div>

              {/* アクション */}
              <div className="flex items-center gap-1">
                {linkableHttpUrl(item.url) && (
                  <a
                    href={linkableHttpUrl(item.url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-blue-500 p-2"
                    title="商品ページを開く"
                  >
                    <ExternalLink size={18} />
                  </a>
                )}
                <button
                  onClick={() => handleRestore(item.id)}
                  className="text-green-500 hover:text-green-600 p-2"
                  title="元に戻す"
                >
                  <Undo2 size={18} />
                </button>
                <button
                  onClick={() => openItemPurge(item)}
                  className="text-red-400 hover:text-red-600 p-2"
                  title="完全に削除"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pending != null}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={dialogConfirmLabel}
        busy={busy}
        error={purgeError}
        onConfirm={() => { void confirmPurge(); }}
        onCancel={closePurge}
      />
    </div>
  );
}
