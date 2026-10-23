import { canonicalCandidateImageUrl } from './image-hosts';
import { formatPriceFetchedAt } from './rakuten-price-note';

const SOURCE_BADGE: Record<string, string> = {
  amazon: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
  rakuten: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  yahoo: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200',
  other: 'bg-gray-100 text-gray-800 dark:bg-slate-600 dark:text-gray-100',
};

const SOURCE_BY_SITE: Record<string, string> = {
  Amazon: 'amazon',
  '楽天': 'rakuten',
  'Yahoo!ショッピング': 'yahoo',
  'その他': 'other',
};

export function sourceBadgeClass(source: string): string {
  return SOURCE_BADGE[source] ?? SOURCE_BADGE.other;
}

export function uniqueShopTags(shops: readonly { site: string; shopName: string }[]): { label: string; source: string }[] {
  const seen = new Set<string>();
  const tags: { label: string; source: string }[] = [];
  for (const shop of shops) {
    const label = shopBadgeText(shop.site, shop.shopName);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    tags.push({ label, source: SOURCE_BY_SITE[shop.site] ?? 'other' });
  }
  return tags;
}

export function shopBadgeText(site: string, shopName: string): string {
  const shop = shopName.trim();
  const place = site.trim();
  if (shop && shop !== place) return shop;
  return place || shop;
}

export function formatListTimestamp(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  const formatted = formatPriceFetchedAt(raw);
  return formatted === raw ? '' : formatted;
}

export function photoImageUrl(source: string, raw: string | null | undefined): string | null {
  if ((source !== 'yahoo' && source !== 'rakuten') || !raw) return null;
  return canonicalCandidateImageUrl(source, raw);
}

export function photoFaceItemId(card: { shops: readonly { itemId: number; purchased: boolean }[] }): number {
  const face = card.shops.find((shop) => !shop.purchased) ?? card.shops[0];
  return face.itemId;
}

// 写真グループ（2店以上）はページ再取得が 409 になる。ボタンは出さない。
// 1件の登録は URL 商品と同じく、再取得ボタンを残す。
export function offersPriceRefresh(shopCount: number): boolean {
  return shopCount < 2;
}
