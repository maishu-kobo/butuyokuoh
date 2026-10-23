'use client';

import { apiFetch } from '@/lib/api-fetch';
import { formatYen, type WishlistRow } from '@/lib/capture/list-card';
import { formatListTimestamp, photoImageUrl, shopBadgeText } from '@/lib/capture/photo-card-view';
import { useState } from 'react';
import SortableItemCard from './SortableItemCard';
import type { Category, ComparisonGroup, Item } from '@/types';

type PhotoCard = Extract<WishlistRow, { kind: 'photo' }>;

export default function PhotoGroupCard({
  card,
  item,
  onUpdate,
  onDelete,
  categories,
  comparisonGroups,
  isDragEnabled,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  card: PhotoCard;
  item: Item;
  onUpdate: () => void;
  onDelete: (id: number) => void;
  categories?: Category[];
  comparisonGroups?: ComparisonGroup[];
  isDragEnabled?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const low = card.minPrice == null ? '---' : formatYen(card.minPrice);
  const displayImageUrl = photoImageUrl(item.source, item.image_url);

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

  const shops = (
    <div className="border-t border-gray-100 dark:border-slate-700 px-4 py-3 text-sm">
      <p className="text-gray-900 dark:text-gray-100" data-testid="photo-group-low">最安 {low}</p>
      <p className="text-gray-600 dark:text-gray-300" data-testid="photo-group-range">{card.rangeText}</p>
      <p className="text-gray-500 dark:text-gray-400">{card.shops.length}件</p>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? `${card.name}のショップを閉じる` : `${card.name}のショップを見る`}
        onClick={() => setOpen((current) => !current)}
        className="mt-2 min-h-[24px] min-w-[24px] px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-200"
      >
        {open ? 'ショップを閉じる' : 'ショップを見る'}
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {card.shops.map((shop) => {
            const when = formatListTimestamp(shop.fetchedAt);
            return (
              <li key={shop.itemId} className="border-t border-gray-100 dark:border-slate-700 pt-3">
                <p className="font-medium text-gray-900 dark:text-gray-100">{shop.name}</p>
                <p className="flex flex-wrap gap-2 text-gray-600 dark:text-gray-300">
                  <span>{shopBadgeText(shop.site, shop.shopName)}</span>
                  {shop.purchased && <span>購入済み</span>}
                  {shop.price != null && shop.price === card.minPrice && <span>最安</span>}
                </p>
                <p className="text-gray-900 dark:text-gray-100">{shop.price == null ? '---' : formatYen(shop.price)}</p>
                <p className="text-gray-500 dark:text-gray-400">{when || '取得日時なし'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {shop.url && (
                    <a href={shop.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[24px] min-w-[24px] items-center px-3 py-2 text-sm text-blue-600">
                      商品ページ
                    </a>
                  )}
                  {!shop.purchased && (
                    <button
                      type="button"
                      disabled={busyId === shop.itemId}
                      onClick={() => { void markPurchased(shop.itemId); }}
                      className="min-h-[24px] min-w-[24px] px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                    >
                      購入済みにする
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div data-testid="photo-group-card">
      <SortableItemCard
        item={item}
        displayImageUrl={displayImageUrl}
        heading={card.name}
        extra={shops}
        onUpdate={onUpdate}
        onDelete={onDelete}
        categories={categories}
        comparisonGroups={comparisonGroups}
        isLowestPrice={item.current_price != null && item.current_price === card.minPrice}
        isDragEnabled={isDragEnabled}
        selectionMode={selectionMode}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}
