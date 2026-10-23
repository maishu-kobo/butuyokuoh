import { canonicalCandidateImageUrl } from './image-hosts';
import { formatPriceFetchedAt } from './rakuten-price-note';

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
