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
  const groups: T[][] = [];
  const urlIndex = new Map<string, number>();
  const listingIndex = new Map<string, number>();
  for (const candidate of candidates) {
    const url = normalizedCandidateUrl(candidate);
    const listing = listingKey(candidate);
    const existing = (url ? urlIndex.get(url) : undefined) ?? listingIndex.get(listing);
    if (existing == null) {
      const index = groups.length;
      groups.push([candidate]);
      if (url) urlIndex.set(url, index);
      listingIndex.set(listing, index);
      continue;
    }
    groups[existing].push(candidate);
    if (url) urlIndex.set(url, existing);
    listingIndex.set(listing, existing);
  }
  return groups.map((group) => group.reduce(preferDuplicate));
}

// 同じ掲載は1件。価格が違うときは安い方を残し、同じ価格なら商品URLをアフィリエイトより先に残す。
function preferDuplicate<T extends CaptureCandidate>(current: T, next: T): T {
  if (next.price < current.price) return next;
  if (current.price < next.price) return current;
  if (affiliateUrl(current.url) && !affiliateUrl(next.url)) return next;
  return current;
}

function affiliateUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'hb.afl.rakuten.co.jp';
  } catch {
    return false;
  }
}
