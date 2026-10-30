// 候補は店ごとの id だけだと、別 URL の同じ掲載が残る。
// 正規化した商品 URL と、店・正規化した商品名・価格が同じ組は、先の1件だけ残す。
import type { CaptureCandidate, CaptureSite } from './contract';
import { rakutenProductIdentity } from './rakuten-link';

export function normalizedCandidateUrl(candidate: { site: CaptureSite; url: string }): string | null {
  const raw = candidate.site === 'rakuten' ? (rakutenProductIdentity(candidate.url) ?? candidate.url) : candidate.url;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
}

export function normalizedListingTitle(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ja-JP');
}

export function listingKey(candidate: { shopName: string; title: string; price: number }): string {
  const shop = candidate.shopName.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ja-JP');
  return `${shop}\0${normalizedListingTitle(candidate.title)}\0${candidate.price}`;
}

export function dedupeCandidates<T extends CaptureCandidate>(candidates: readonly T[]): T[] {
  const seenUrls = new Set<string>();
  const seenListings = new Set<string>();
  const kept: T[] = [];
  for (const candidate of candidates) {
    const url = normalizedCandidateUrl(candidate);
    const listing = listingKey(candidate);
    if ((url && seenUrls.has(url)) || seenListings.has(listing)) continue;
    if (url) seenUrls.add(url);
    seenListings.add(listing);
    kept.push(candidate);
  }
  return kept;
}
