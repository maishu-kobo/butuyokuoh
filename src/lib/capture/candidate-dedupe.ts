// 候補は店ごとの id だけだと、別 URL の同じ掲載が残る。
// 正規化した商品 URL が同じもの、または店・正規化した商品名・価格が同じ組を、それぞれ直接まとめる。
// URL と listing key をまたいで推移的には連結しない。
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
  const afterUrl = collapseByKey(candidates, (candidate) => normalizedCandidateUrl(candidate));
  return collapseByKey(afterUrl, (candidate) => listingKey(candidate));
}

function collapseByKey<T extends CaptureCandidate>(
  candidates: readonly T[],
  keyOf: (candidate: T) => string | null,
): T[] {
  const groups = new Map<string, T>();
  const order: string[] = [];
  const unkeyed: T[] = [];
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (key == null) {
      unkeyed.push(candidate);
      continue;
    }
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, candidate);
      order.push(key);
      continue;
    }
    groups.set(key, preferDuplicate(existing, candidate));
  }
  return [...order.map((key) => groups.get(key)!), ...unkeyed];
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
