import { Parser } from 'htmlparser2';
import type { ScrapedItem } from './scraper';

export type AmazonListing = ScrapedItem & { usdPrice: number | null };

const USD_NOTE_PREFIX = '新品価格は USD ';
const USD_NOTE_SUFFIX = ' と表示されていました。円への切り替え後も円の新品価格を取得できませんでした。';

/** 円へ切り替えたあとも新品がドルのとき、円の列には入れず残す記録。金額はこの関数が作る。 */
export function amazonUsdFallbackNote(amount: number): string {
  const cents = Math.round(amount * 100) / 100;
  const shown = Number.isInteger(cents) ? String(cents) : cents.toFixed(2);
  return `${USD_NOTE_PREFIX}${shown}${USD_NOTE_SUFFIX}`;
}

export function amazonUsdFallbackNoteText(note: string | null | undefined): string | null {
  if (!note?.startsWith(USD_NOTE_PREFIX) || !note.endsWith(USD_NOTE_SUFFIX)) return null;
  const amount = note.slice(USD_NOTE_PREFIX.length, note.length - USD_NOTE_SUFFIX.length);
  return /^\d+(?:\.\d{1,2})?$/.test(amount) ? note : null;
}

function readUsdAmount(value: string): number | null {
  const match = value.match(/(?:USD|US\$|\$)\s*([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100) / 100;
}

const AMAZON_HOSTS = new Set(['amazon.co.jp', 'www.amazon.co.jp', 'amazon.jp', 'www.amazon.jp', 'amazon.com', 'www.amazon.com']);
export function isAmazonHost(host: string) { return AMAZON_HOSTS.has(host.toLowerCase()); }
export function isAmazonProductPage(url: URL) {
  return isAmazonHost(url.hostname) && /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:[/?]|$)/i.test(url.pathname);
}

// Keep only the product's title, main image and new buy-box price. A whole-page yen
// regex also matches recommendations, crossed-out list prices, installments and
// used/marketplace offers. Book pages put the new price on `#price.header-price`
// (not `.a-price`). `a-text-price` is the struck list price, except when the same
// element is also priceToPay / apexPriceToPay.
// `usdPrice` is the new-item dollar amount in that same slot. It is not the saved
// yen price; the fetcher asks Amazon to show 円 before anything is stored.
export function extractAmazonListing(html: string): AmazonListing {
  const priceRoots = new Set(['corePriceDisplay_desktop_feature_div', 'corePrice_desktop',
    'corePrice_feature_div', 'corePrice_mobile_feature_div', 'corePriceDisplay_mobile_feature_div',
    'apex_desktop', 'apex_mobile', 'price', 'buybox', 'buybox_feature_div', 'desktop_buybox',
    'mobile_buybox', 'booksHeaderSection', 'newBooksSingleBuyingOptionHeader_feature_div']);
  const legacyPrices = new Set(['priceblock_ourprice', 'priceblock_dealprice', 'priceblock_saleprice',
    'price', 'price_inside_buybox', 'newBuyBoxPrice']);
  type Frame = { priceRoot: boolean; ignored: boolean; kind?: 'name' | 'price'; text: string; rank: number };
  const stack: Frame[] = [];
  let name = '', imageUrl: string | null = null;
  const prices: { price: number; rank: number }[] = [];
  const dollarPrices: { price: number; rank: number }[] = [];
  const parser = new Parser({
    onopentag(tag, attrs) {
      const parent = stack[stack.length - 1];
      const classes = new Set((attrs.class || '').split(/\s+/));
      const id = attrs.id || '';
      const payable = classes.has('priceToPay') || classes.has('apexPriceToPay');
      // Struck list price. The amount to pay can also carry a-text-price.
      const listPrice = (classes.has('a-text-price') || classes.has('basisPrice')) && !payable;
      const ignored = Boolean(parent?.ignored || ['script', 'style', 's', 'del'].includes(tag) ||
        'hidden' in attrs || /display\s*:\s*none/i.test(attrs.style || '') ||
        /installment|monthly|payment-plan/i.test(`${id} ${attrs.class || ''}`) ||
        listPrice ||
        ['aok-hidden', 'a-hidden'].some(value => classes.has(value)));
      const priceRoot = Boolean(parent?.priceRoot || priceRoots.has(id) || id.startsWith('newAccordionRow'));
      const bookNewPrice = classes.has('header-price') || classes.has('offer-price');
      const price = !ignored && (legacyPrices.has(id) || (priceRoot && (payable || classes.has('a-price') || bookNewPrice)));
      stack.push({ priceRoot, ignored, kind: !ignored && id === 'productTitle' ? 'name' : price ? 'price' : undefined,
        text: '', rank: payable ? 0 : (legacyPrices.has(id) || bookNewPrice) ? 1 : 2 });
      if (!ignored && tag === 'img' && ['landingImage', 'imgBlkFront', 'main-image'].includes(attrs.id)) {
        let candidate = attrs['data-old-hires'] || attrs.src;
        if (!/^https?:\/\//i.test(candidate || '')) {
          try { candidate = Object.keys(JSON.parse(attrs['data-a-dynamic-image'] || '{}'))[0]; } catch { /* ignore malformed image metadata */ }
        }
        if (/^https?:\/\//i.test(candidate || '')) imageUrl = candidate;
      }
    },
    ontext(text) {
      if (stack[stack.length - 1]?.ignored) return;
      for (const frame of stack) {
        if (frame.kind && frame.text.length < 4096) frame.text += text.slice(0, 4096 - frame.text.length);
      }
    },
    onclosetag(_tag, implied) {
      const frame = stack.pop();
      // An incomplete element at the download boundary must not turn a partial
      // price (e.g. "4," instead of "4,980") into a saved value.
      if (!frame || implied) return;
      if (frame.kind === 'name') name = frame.text.replace(/\s+/g, ' ').trim();
      if (frame.kind === 'price') {
        const value = frame.text.replace(/\s+/g, ' ').trim();
        const match = value.match(/[¥￥]\s*([\d,]+(?:\.\d+)?)/) || value.match(/([\d,]+(?:\.\d+)?)\s*円/);
        const price = match ? Number(match[1].replace(/,/g, '')) : NaN;
        if (price > 0 && price <= 1_000_000_000) prices.push({ price: Math.round(price), rank: frame.rank });
        else {
          const dollars = readUsdAmount(value);
          if (dollars != null) dollarPrices.push({ price: dollars, rank: frame.rank });
        }
      }
    },
  }, { decodeEntities: true });
  parser.end(html);
  prices.sort((a, b) => a.rank - b.rank);
  dollarPrices.sort((a, b) => a.rank - b.rank);
  return {
    name: name || '不明な商品',
    price: prices[0]?.price ?? null,
    usdPrice: dollarPrices[0]?.price ?? null,
    imageUrl,
    source: 'amazon',
    sourceName: 'Amazon',
  };
}

export function extractAmazonProduct(html: string): ScrapedItem {
  const listing = extractAmazonListing(html);
  return {
    name: listing.name,
    price: listing.price,
    imageUrl: listing.imageUrl,
    source: listing.source,
    sourceName: listing.sourceName,
  };
}
