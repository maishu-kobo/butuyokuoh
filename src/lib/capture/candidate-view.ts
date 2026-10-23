import { formatJapaneseDateTime } from '../local-date';
import { canonicalCandidateImageUrl } from './image-hosts';

export function formatCandidateFetchedAt(value: string): string {
  const formatted = formatJapaneseDateTime(value);
  if (formatted === value) return '';
  return formatted;
}

export function candidateThumbnail(item: {
  site: 'yahoo' | 'rakuten';
  title: string;
  imageUrl?: string | null;
}): { src: string; alt: string } | null {
  if (!item.imageUrl) return null;
  const src = canonicalCandidateImageUrl(item.site, item.imageUrl);
  const alt = item.title.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!src || !alt) return null;
  return { src, alt };
}
