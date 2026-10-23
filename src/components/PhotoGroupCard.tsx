'use client';

import { apiFetch } from '@/lib/api-fetch';
import { formatYen, type WishlistRow } from '@/lib/capture/list-card';
import { photoGroupDeleteIds, photoShopDeleteIds } from '@/lib/capture/photo-group-actions';
import { formatListTimestamp, offersPriceRefresh, photoImageUrl, shopBadgeText } from '@/lib/capture/photo-card-view';
import { useState } from 'react';
import SortableItemCard from './SortableItemCard';
import type { Category, ComparisonGroup, Item } from '@/types';

type PhotoCard = Extract<WishlistRow, { kind: 'photo' }>;

export default function PhotoGroupCard({
  card,
  item,
  onUpdate,
  categories,
  comparisonGroups,
  isDragEnabled,
  selectionMode,
  isSelected,
  onToggleSelect,
  shopsOpen = false,
}: {
  card: PhotoCard;
  item: Item;
  onUpdate: () => void;
  categories?: Category[];
  comparisonGroups?: ComparisonGroup[];
  isDragEnabled?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
  shopsOpen?: boolean;
}) {
  const [open, setOpen] = useState(shopsOpen);
  const [busyId, setBusyId] = useState<number | null>(null);
  const memberIds = card.shops.map((shop) => shop.itemId);

  async function deleteGroup(faceId: number) {
    const ids = photoGroupDeleteIds(memberIds, faceId);
    await Promise.all(ids.map((id) => apiFetch(`/api/items/${id}`, { method: 'DELETE' })));
    onUpdate();
  }

  async function deleteShop(shopId: number) {
    const ids = photoShopDeleteIds(memberIds, shopId);
    if (ids.length === 0) return;
    setBusyId(shopId);
    try {
      await Promise.all(ids.map((id) => apiFetch(`/api/items/${id}`, { method: 'DELETE' })));
      onUpdate();
    } finally {
      setBusyId(null);
    }
  }
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
    <>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-600 dark:text-gray-300">
        <span data-testid="photo-group-low">最安 {low}</span>
        <span data-testid="photo-group-range">{card.rangeText}</span>
        <span>{card.shops.length}件</span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `${card.name}のショップを閉じる` : `${card.name}のショップを見る`}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-h-[24px] min-w-[24px] items-center text-blue-600 hover:text-blue-700"
        >
          {open ? 'ショップを閉じる' : 'ショップを見る'}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-3 text-sm" data-testid="photo-shop-list">
          {card.shops.map((shop) => {
            const when = formatListTimestamp(shop.fetchedAt);
            return (
              <li key={shop.itemId} className="border-t border-gray-100 pt-3 dark:border-slate-700">
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
                  <button
                    type="button"
                    disabled={busyId === shop.itemId}
                    onClick={() => { void deleteShop(shop.itemId); }}
                    aria-label={`${shop.name}を削除`}
                    className="min-h-[24px] min-w-[24px] px-3 py-1 text-sm text-red-400 hover:text-red-600 disabled:opacity-50"
                  >
                    削除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  return (
    <div data-testid="photo-group-card">
      <SortableItemCard
        item={item}
        displayImageUrl={displayImageUrl}
        heading={card.name}
        info={shops}
        onUpdate={onUpdate}
        onDelete={(id) => { void deleteGroup(id); }}
        groupMemberIds={memberIds}
        categories={categories}
        comparisonGroups={comparisonGroups}
        isLowestPrice={item.current_price != null && item.current_price === card.minPrice}
        isDragEnabled={isDragEnabled}
        selectionMode={selectionMode}
        isSelected={isSelected}
        onToggleSelect={onToggleSelect}
        offerPriceRefresh={offersPriceRefresh(card.shops.length)}
        shopCount={card.shops.length}
      />
    </div>
  );
}
