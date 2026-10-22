'use client';

import { apiFetch } from '@/lib/api-fetch';
import { formatYen, type WishlistRow } from '@/lib/capture/list-card';
import { useState } from 'react';

type PhotoCard = Extract<WishlistRow, { kind: 'photo' }>;

export default function PhotoGroupCard({ card, onUpdate }: { card: PhotoCard; onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const low = card.minPrice == null ? '---' : formatYen(card.minPrice);

  async function markPurchased(itemId: number) {
    setBusyId(itemId);
    try {
      await apiFetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_purchased: true }),
      });
      onUpdate();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <article data-testid="photo-group-card" className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{card.name}</h3>
        <p className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100" data-testid="photo-group-low">最安 {low}</p>
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="photo-group-range">{card.rangeText}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{card.shops.length}件</p>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `${card.name}のショップを閉じる` : `${card.name}のショップを見る`}
          onClick={() => setOpen((current) => !current)}
          className="mt-3 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-200"
        >
          {open ? 'ショップを閉じる' : 'ショップを見る'}
        </button>
      </div>
      {open && (
        <ul className="border-t border-gray-100 dark:border-slate-700">
          {card.shops.map((shop) => (
            <li key={shop.itemId} className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 last:border-b-0 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">{shop.name}</span>
                <span>{shop.site}</span>
                <span>{shop.shopName}</span>
                {shop.purchased && <span>購入済み</span>}
                {shop.price != null && shop.price === card.minPrice && <span>最安</span>}
              </div>
              <p className="mt-1 text-gray-700 dark:text-gray-200">{shop.price == null ? '---' : formatYen(shop.price)}</p>
              <p className="text-gray-500 dark:text-gray-400">{shop.fetchedAt ?? '取得日時なし'}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {shop.url && (
                  <a href={shop.url} target="_blank" rel="noopener noreferrer" className="px-3 py-2 text-sm text-blue-600">
                    商品ページ
                  </a>
                )}
                {!shop.purchased && (
                  <button
                    type="button"
                    disabled={busyId === shop.itemId}
                    onClick={() => { void markPurchased(shop.itemId); }}
                    className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                  >
                    購入済みにする
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
