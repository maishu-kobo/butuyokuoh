import { recoverTsukumoImage } from './tsukumo-image';
import { getDb } from './db';
import { consumeGuestRate, guestLimit, GuestError } from './guest';
import {
  fetchPublicPage,
  isBotChallengedHtml,
  publicPageUrl,
  PublicPageError,
  PRODUCT_FETCH_BLOCKED_HELP,
  scrapeFailedHelp,
} from './public-page';
import { productFetchGuestDeps } from './product-fetch-port';
import { parseProductHtml } from './product-html';
import { extractAmazonProduct, isAmazonHost, isAmazonProductPage } from './amazon-product';
import { isUnusableScrape } from './scraper';

export async function scrapeGuestUrl(url: string, userId: number) {
  const db = getDb();
  // Shared by preview, add and refresh. A new cookie cannot reset the global cap.
  db.transaction(() => {
    consumeGuestRate(`scrape:${userId}`, guestLimit('SCRAPES_PER_MINUTE', 5), db);
    consumeGuestRate('scrape:global', guestLimit('GLOBAL_SCRAPES_PER_MINUTE', 30), db);
  }).immediate();
  try {
    const page = await fetchPublicPage(url, productFetchGuestDeps() ?? {});
    const resolvedUrl = new URL(page.url);
    if (isAmazonHost(resolvedUrl.hostname) && !isAmazonProductPage(resolvedUrl)) {
      throw new GuestError(422, 'SCRAPE_FAILED', 'Amazonの商品ページを確認できませんでした。商品ページをブラウザで開き、そのURLを貼り直してください。');
    }
    if (isBotChallengedHtml(page.html)) {
      throw new GuestError(422, 'SCRAPE_FAILED', PRODUCT_FETCH_BLOCKED_HELP);
    }
    let result = isAmazonProductPage(resolvedUrl) ? extractAmazonProduct(page.html) : parseProductHtml(page.html, page.url);
    if (!result.failureCode && !result.imageUrl) {
      result = await recoverTsukumoImage(page.url, isUnusableScrape(result) ? undefined : result) ?? result;
    }
    if (result.failureCode || !result.name || result.name === '不明な商品' || isUnusableScrape(result)) {
      throw new GuestError(422, 'SCRAPE_FAILED', scrapeFailedHelp(result));
    }
    result.name = result.name.slice(0, 200);
    if (result.price !== null && (!Number.isFinite(result.price) || result.price < 0 || result.price > 1_000_000_000)) result.price = null;
    if (result.imageUrl) {
      try { result.imageUrl = publicPageUrl(result.imageUrl).href; } catch { result.imageUrl = null; }
    }
    if (!result.price && !result.note) result.note = '価格は取得できませんでした。商品は保存できます。価格は「編集」から入力・変更できます。';
    return result;
  } catch (error) {
    if (error instanceof PublicPageError) {
      // 転送後の失敗で入力した商品の画像を使わない。基準は最後に検証した URL だけ。
      if (error.status >= 500 && error.url) {
        const recovered = await recoverTsukumoImage(error.url);
        if (recovered) return recovered;
      }
      throw new GuestError(error.status, 'SCRAPE_FAILED', error.message);
    }
    throw error;
  }
}
