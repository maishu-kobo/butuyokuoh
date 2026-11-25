import type { ComparisonGroup, Item } from '@/types';
import { wishlistRows } from '@/lib/capture/list-card';

// 購入だけを商品単位にする。カテゴリ変更などで使う選択済みIDは変更しない。
export function bulkPurchaseItems(
  items: readonly Item[], groups: readonly ComparisonGroup[], selected: ReadonlySet<number>,
): Item[] {
  const eligible = items.filter(item => selected.has(item.id) && !item.is_purchased && !item.deleted_at);
  const byId = new Map(eligible.map(item => [item.id, item]));
  return wishlistRows(eligible, groups).map(row => {
    if (row.kind === 'item') return row.item;
    // shopsは価格、同額・価格不明ならID順。絞り込みで選んだ店舗の外には出さない。
    const offers = row.shops.map(shop => byId.get(shop.itemId)!);
    return offers.find(item => item.countsInTotal === true) ?? offers[0];
  });
}
