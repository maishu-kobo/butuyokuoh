import { recoverTsukumoImage } from './tsukumo-image';
import { getDb } from './db';
import { consumeGuestRate, guestLimit, GuestError } from './guest';
import {
  fetchPublicPage,
  isBotChallengedHtml,
  publicPageUrl,
  PublicPageError,
  PRODUCT_FETCH_BLOCKED_HELP,
  PRODUCT_FETCH_BLOCKED_HELP_GUEST,
  scrapeFailedHelp,
} from './public-page';
import { productAmazonExchange, productFetchGuestDeps } from './product-fetch-port';
import { parseProductHtml, PRODUCT_WAITING_HELP, PRODUCT_WAITING_HELP_GUEST } from './product-html';
import { amazonUsdFallbackNote, extractAmazonListing, isAmazonHost, isAmazonProductPage } from './amazon-product';
import { liveAmazonExchange, switchedAmazonHtml } from './amazon-currency';
import { isUnusableScrape, type ScrapedItem } from './scraper';

function guestScrapeFailedHelp(
  scraped: { name?: string | null; note?: string | null; failureCode?: string | null } | null,
): string {
  const note = scraped?.note?.trim() || '';
  if (note === PRODUCT_WAITING_HELP || note === PRODUCT_WAITING_HELP_GUEST) {
    return PRODUCT_WAITING_HELP_GUEST;
  }
  return scrapeFailedHelp(scraped, { forGuest: true });
}

async function amazonGuestPrice(productUrl: string, html: string): Promise<ScrapedItem> {
  const listing = extractAmazonListing(html);
  const result: ScrapedItem = {
    name: listing.name,
    price: listing.price,
    imageUrl: listing.imageUrl,
    source: listing.source,
    sourceName: listing.sourceName,
  };
  if (result.price != null || listing.usdPrice == null) return result;
  const exchange = productAmazonExchange() ?? liveAmazonExchange();
  try {
    const switched = await switchedAmazonHtml(productUrl, exchange);
    if (!switched) return { ...result, note: amazonUsdFallbackNote(listing.usdPrice) };
    const again = extractAmazonListing(switched);
    if (again.price != null) {
      return {
        ...result,
        name: again.name && again.name !== '不明な商品' ? again.name : result.name,
        price: again.price,
        imageUrl: again.imageUrl ?? result.imageUrl,
      };
    }
    return { ...result, note: amazonUsdFallbackNote(again.usdPrice ?? listing.usdPrice) };
  } catch {
    return { ...result, note: amazonUsdFallbackNote(listing.usdPrice) };
  }
}

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
      // 追加失敗時は未保存なので「編集」案内の AMAZON_BOT_NOTE は使わない（#408 Bugbot）。
      throw new GuestError(422, 'SCRAPE_FAILED', PRODUCT_FETCH_BLOCKED_HELP_GUEST);
    }
    let result = isAmazonProductPage(resolvedUrl)
      ? await amazonGuestPrice(page.url, page.html)
      : parseProductHtml(page.html, page.url);
    if (!result.failureCode && !result.imageUrl) {
      result = await recoverTsukumoImage(page.url, isUnusableScrape(result) ? undefined : result) ?? result;
    }
    if (result.failureCode || !result.name || result.name === '不明な商品' || isUnusableScrape(result)) {
      throw new GuestError(422, 'SCRAPE_FAILED', guestScrapeFailedHelp(result));
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
      // 一般の取得失敗（404・非HTML 等の PRODUCT_FETCH_HELP）はボット扱いにしない。
      // 本物の制限文だけゲスト向け（手動追加）に差し替える（#408 Bugbot）。
      const message =
        error.message === PRODUCT_FETCH_BLOCKED_HELP
          ? PRODUCT_FETCH_BLOCKED_HELP_GUEST
          : error.message;
      throw new GuestError(error.status, 'SCRAPE_FAILED', message);
    }
    throw error;
  }
}
