import { getDb } from './db';
import { consumeGuestRate, guestLimit, GuestError } from './guest';
import { fetchPublicPage, publicPageUrl, PublicPageError } from './public-page';
import { parseProductHtml } from './product-html';

export async function scrapeGuestUrl(url: string, userId: number) {
  const db = getDb();
  // Shared by preview, add and refresh. A new cookie cannot reset the global cap.
  db.transaction(() => {
    consumeGuestRate(`scrape:${userId}`, guestLimit('SCRAPES_PER_MINUTE', 5), db);
    consumeGuestRate('scrape:global', guestLimit('GLOBAL_SCRAPES_PER_MINUTE', 30), db);
  }).immediate();
  try {
    const page = await fetchPublicPage(url);
    const result = parseProductHtml(page.html, page.url);
    if (!result.name || result.name === '不明な商品') {
      throw new GuestError(422, 'SCRAPE_FAILED', '商品名を取得できませんでした。手動で追加してください');
    }
    result.name = result.name.slice(0, 200);
    if (result.price !== null && (!Number.isFinite(result.price) || result.price < 0 || result.price > 1_000_000_000)) result.price = null;
    if (result.imageUrl) {
      try { result.imageUrl = publicPageUrl(result.imageUrl).href; } catch { result.imageUrl = null; }
    }
    if (!result.price) result.note = '価格を取得できませんでした。編集から価格を入力できます。';
    return result;
  } catch (error) {
    if (error instanceof PublicPageError) throw new GuestError(error.status, 'SCRAPE_FAILED', error.message);
    throw error;
  }
}
