import { formatJapaneseDateTime } from '../local-date';

// 楽天の価格を1時間より長く置くときに、価格の隣へ出す注意書き。

export const RAKUTEN_PRICE_NOTE = '価格は楽天市場の商品価格です。価格は変動する場合があります。';

export function formatPriceFetchedAt(value: string): string {
  return formatJapaneseDateTime(value);
}

export function rakutenPriceCaption(item: {
  source_item_code?: string | null;
  price_fetched_at?: string | null;
}): { fetchedAt: string; note: string } | null {
  const code = item.source_item_code ?? '';
  if (!code.startsWith('rakuten:')) return null;
  const itemCode = code.slice('rakuten:'.length).trim();
  if (!itemCode || !item.price_fetched_at) return null;
  return { fetchedAt: formatPriceFetchedAt(item.price_fetched_at), note: RAKUTEN_PRICE_NOTE };
}
