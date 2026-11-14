import { amazonUsdFallbackNote, extractAmazonListing, type AmazonListing } from './amazon-product';
import { switchedAmazonHtml, type AmazonExchange } from './amazon-currency';
import { amazonNeedsJapanDelivery, isAmazonJpHost, switchedAmazonDeliveryHtml } from './amazon-delivery';
import { BlockedTargetError } from './member-fetch';
import type { ScrapedItem } from './scraper';

function asItem(listing: AmazonListing, note?: string): ScrapedItem {
  const item: ScrapedItem = {
    name: listing.name,
    price: listing.price,
    imageUrl: listing.imageUrl,
    source: 'amazon',
    sourceName: 'Amazon',
  };
  if (note) item.note = note;
  return item;
}

function mergeListing(base: AmazonListing, next: AmazonListing): AmazonListing {
  return {
    ...next,
    name: next.name && next.name !== '不明な商品' ? next.name : base.name,
    imageUrl: next.imageUrl ?? base.imageUrl,
    usdPrice: next.usdPrice ?? base.usdPrice,
  };
}

function amazonJpProductUrl(productUrl: string): boolean {
  try { return isAmazonJpHost(new URL(productUrl).hostname); } catch { return false; }
}

export async function resolveAmazonListing(
  productUrl: string,
  html: string,
  exchange: AmazonExchange | null,
): Promise<ScrapedItem> {
  let listing = extractAmazonListing(html);
  if (listing.price != null) return asItem(listing);

  if (exchange && amazonJpProductUrl(productUrl) && amazonNeedsJapanDelivery(html)) {
    try {
      const switched = await switchedAmazonDeliveryHtml(productUrl, html, exchange);
      if (switched) {
        listing = mergeListing(listing, extractAmazonListing(switched));
        if (listing.price != null) return asItem(listing);
      }
    } catch (error) {
      if (error instanceof BlockedTargetError) throw error;
    }
  }

  if (listing.usdPrice == null) return asItem(listing);
  if (!exchange) return asItem(listing, amazonUsdFallbackNote(listing.usdPrice));

  try {
    const switched = await switchedAmazonHtml(productUrl, exchange);
    if (!switched) return asItem(listing, amazonUsdFallbackNote(listing.usdPrice));
    const again = mergeListing(listing, extractAmazonListing(switched));
    if (again.price != null) return asItem(again);
    return asItem(again, amazonUsdFallbackNote(again.usdPrice ?? listing.usdPrice));
  } catch (error) {
    if (error instanceof BlockedTargetError) throw error;
    return asItem(listing, amazonUsdFallbackNote(listing.usdPrice));
  }
}
