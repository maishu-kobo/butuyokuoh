import { tokenizer, tokTypes } from 'acorn';
import { Parser } from 'htmlparser2';
import { isBotChallengedHtml, PRODUCT_FETCH_BLOCKED_HELP } from './public-page';
import type { ScrapedItem } from './scraper';

export const PRODUCT_WAITING_HELP = '販売サイトのボット対策による待機ページが返されたため、価格と画像を取得できませんでした。商品ページをブラウザで確認し、時間をおいて再試行するか、別の店のURLを使ってください。商品名を入力して手動で追加することもできます。';

/** HTTP 200 でも商品ではない botfailover テンプレートを解析前に除外する。 */
function isProductWaitingPage(html: string): boolean {
  const title = html.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1]
    .replace(/\s+/g, ' ').trim();
  return !!title && /^hang tight!\s*routing to checkout(?:\.{0,3}|…)?$/i.test(title);
}

function parseYenPrice(value: unknown): number | null {
  const price = Number(String(value).replace(/[,¥￥\s]/g, ''));
  return Number.isFinite(price) && price > 0 && price <= 1_000_000_000 ? Math.round(price) : null;
}

function parseOgYenAmount(content: string | undefined): number | null {
  if (!content) return null;
  const amount = content.replace(/^[¥￥]\s*/, '');
  // 円は整数。表示用の .00 / ,00 を除いたあと、桁区切りは3桁ずつに限定する。
  const whole = amount.replace(/[.,]0{1,2}$/, '');
  if (/^\d+$/.test(whole)) return parseYenPrice(whole);
  const grouped = whole.match(/^[1-9]\d{0,2}([., '\u2019\u00a0\u202f])\d{3}(?:\1\d{3})*$/);
  if (!grouped || grouped[1] === amount[whole.length]) return null;
  return parseYenPrice(whole.replace(/\D/g, ''));
}

// JavaScript は実行せず、文字列やコメントを除いた Shopify.theme への代入を読む。
function assignsShopifyTheme(script: string): boolean {
  if (!script.includes('Shopify')) return false;
  try {
    const tokens = tokenizer(script, { ecmaVersion: 'latest' });
    for (const token of tokens) {
      if (token.type !== tokTypes.name || script.slice(token.start, token.end) !== 'Shopify') continue;
      if (tokens.getToken().type !== tokTypes.dot) continue;
      const property = tokens.getToken();
      if (property.type === tokTypes.name && script.slice(property.start, property.end) === 'theme' && tokens.getToken().type === tokTypes.eq) {
        return true;
      }
    }
  } catch {
    // 読めないスクリプトは店舗判定の根拠にしない。
  }
  return false;
}

// ページに明示された通貨・金額と、実際に読み込むテーマの手掛かりを一度に読む。
function storePriceMetadata(html: string, pageUrl: string) {
  let currency: string | undefined;
  let amount: string | undefined;
  let shopifyTheme = false;
  let inlineScript = false;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'meta') {
        const key = (attrs.property || attrs.name || '').toLowerCase();
        const content = attrs.content?.trim();
        if (key === 'og:price:currency' && content) currency ??= content.toUpperCase();
        if (key === 'og:price:amount' && content) amount ??= content;
        return;
      }
      const type = (attrs.type ?? '').trim().toLowerCase();
      const script = tag === 'script' && ['', 'module', 'text/javascript', 'application/javascript'].includes(type);
      inlineScript = script && !attrs.src;
      const stylesheet = tag === 'link' && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('stylesheet');
      const resource = script ? attrs.src : stylesheet ? attrs.href : undefined;
      if (!resource || shopifyTheme) return;
      const url = URL.parse(resource, pageUrl);
      if (url?.hostname === 'cdn.shopify.com' && (url.protocol === 'https:' || url.protocol === 'http:')) {
        shopifyTheme = true;
      }
    },
    ontext(text) {
      if (inlineScript && !shopifyTheme && assignsShopifyTheme(text)) shopifyTheme = true;
    },
    onclosetag(tag) {
      if (tag === 'script') inlineScript = false;
    },
  });
  parser.end(html);
  return { currency, amount, shopifyTheme };
}

/**
 * Apple Store の構成（buy-）ページ。モデル未選択で単一価格が無い。
 * ページ内の「月額」「最低購入金額」「修理サービス料」などを商品価格と誤認しやすい。
 */
export function isAppleShopBuyPage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host !== 'www.apple.com' && host !== 'apple.com') return false;
    return /\/shop\/buy[-/]/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// 分割払い・月額・保証修理料など、商品本体の売価ではない円表記の近傍語。
const NON_PRODUCT_PRICE_HINT =
  /分割|月々|\/\s*月|円\s*\/\s*月|最低購入|ペイディ|あと払い|サービス料|AppleCare|修理|損傷|月額|金利|手数料|送料|配送料/;

function yenMatchLooksLikeProductPrice(html: string, index: number, matched: string): boolean {
  const start = Math.max(0, index - 80);
  const end = Math.min(html.length, index + matched.length + 48);
  return !NON_PRODUCT_PRICE_HINT.test(html.slice(start, end));
}

function firstProductYenMatch(
  html: string,
  pattern: RegExp,
): number | null {
  for (const match of html.matchAll(pattern)) {
    if (match.index == null) continue;
    if (!yenMatchLooksLikeProductPrice(html, match.index, match[0])) continue;
    const extracted = parseInt(match[1].replace(/,/g, ''), 10);
    if (extracted > 0) return extracted;
  }
  return null;
}

/** meta の content。空文字や空白だけのときは未取得。 */
function metaContent(html: string, propertyOrName: string): string | null {
  const key = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match =
    html.match(new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*content="([^"]*)"`, 'i')) ||
    html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*(?:property|name)="${key}"`, 'i'));
  const value = match?.[1]?.replace(/&amp;/g, '&').trim() ?? '';
  return value || null;
}

function firstImgSrc(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const src = match?.[1]?.replace(/&amp;/g, '&').trim() ?? '';
    if (src) return src;
  }
  return null;
}

/**
 * JSON-LD `<script>` の本文だけを返す。
 * タグ全体を取って `<script>` を置換除去すると、不完全な複数文字サニタイズとして
 * CodeQL に指摘されるので、キャプチャで中身だけ取り出す。
 */
function jsonLdScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const body = match[1]?.trim();
    if (body) bodies.push(body);
  }
  return bodies;
}

function parseJsonLdScripts(html: string): unknown[] {
  const parsed: unknown[] = [];
  for (const body of jsonLdScriptBodies(html)) {
    try {
      parsed.push(JSON.parse(body));
    } catch {
      // JSONパース失敗は無視
    }
  }
  return parsed;
}

/** JSON-LD の image（文字列・配列・ImageObject・@graph）から最初の URL。 */
function jsonLdImageUrl(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === 'string') {
    const value = data.trim();
    return value || null;
  }
  if (Array.isArray(data)) {
    for (const entry of data) {
      const found = jsonLdImageUrl(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if ('image' in record) {
    const fromImage = jsonLdImageUrl(record.image);
    if (fromImage) return fromImage;
  }
  if (typeof record.url === 'string' && /imageobject/i.test(String(record['@type'] ?? ''))) {
    const value = record.url.trim();
    if (value) return value;
  }
  if (Array.isArray(record['@graph'])) {
    return jsonLdImageUrl(record['@graph']);
  }
  return null;
}

function extractJsonLdImage(html: string): string | null {
  for (const data of parseJsonLdScripts(html)) {
    const found = jsonLdImageUrl(data);
    if (found) return found;
  }
  return null;
}

/**
 * 商品画像 URL の候補。取れなければ null（プレースホルダは作らない）。
 * ツクモのように og:image が空で、id=mainimg が figure 側にあるページ向けに
 * 親要素の class/id も見る。
 */
function extractProductImageUrl(html: string): string | null {
  const fromMeta = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  if (fromMeta) return fromMeta;

  const fromJsonLd = extractJsonLdImage(html);
  if (fromJsonLd) return fromJsonLd;

  // EC-CUBE系: class="picture" の画像
  const fromPicture = firstImgSrc(html, [
    /<img[^>]*class="[^"]*picture[^"]*"[^>]*src="([^"]+)"/i,
    /<img[^>]*src="([^"]+)"[^>]*class="[^"]*picture[^"]*"/i,
  ]);
  if (fromPicture) return fromPicture;

  // img 自身の class/id に product / main / item
  const fromImgAttr = firstImgSrc(html, [
    /<img[^>]*(?:class|id)="[^"]*(?:product|main|item)[^"]*"[^>]*src="([^"]+)"/i,
    /<img[^>]*src="([^"]+)"[^>]*(?:class|id)="[^"]*(?:product|main|item)[^"]*"/i,
  ]);
  if (fromImgAttr) return fromImgAttr;

  // 親（figure/div など）の class/id に product|main|item|picture がある内側の img
  // 例: <figure id="mainimg"><img src="https://cdn.../image/item/....jpg"></figure>
  const fromParent = firstImgSrc(html, [
    /<(?:figure|div|span|a|section)[^>]*(?:class|id)="[^"]*(?:product|main|item|picture)[^"]*"[^>]*>[\s\S]{0,800}?<img\b[^>]*\bsrc="([^"]+)"/i,
  ]);
  if (fromParent) return fromParent;

  return null;
}

// Pure parser shared by member scraping and the bounded guest HTTP client.
export function parseProductHtml(html: string, sanitizedUrl: string): ScrapedItem {
  const hostname = new URL(sanitizedUrl).hostname;
  if (isBotChallengedHtml(html)) {
    return {
      name: '取得失敗',
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
      note: PRODUCT_FETCH_BLOCKED_HELP,
      failureCode: 'BOT_CHALLENGE',
    };
  }
  if (isProductWaitingPage(html)) {
    return {
      name: '取得失敗', price: null, imageUrl: null, source: 'other', sourceName: null,
      note: PRODUCT_WAITING_HELP, failureCode: 'BOT_CHALLENGE',
    };
  }
  const appleBuyPage = isAppleShopBuyPage(sanitizedUrl);
  // タイトルから商品名
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let name = titleMatch ? titleMatch[1].trim() : '不明な商品';
  // タイトルのクリーンアップ: 改行、HTMLエンティティ、サイト名の区切り文字などを除去
  name = name
    .replace(/\n/g, ' ')                    // 改行をスペースに
    .replace(/&ndash;/g, '-')               // &ndash; を - に
    .replace(/&mdash;/g, '-')               // &mdash; を - に
    .replace(/&amp;/g, '&')                 // &amp; を & に
    .replace(/&quot;/g, '"')                // &quot; を " に
    .replace(/&#39;/g, "'")                 // &#39; を ' に
    .replace(/\s*[-|–—]\s*[^-|–—]+$/g, '')  // 末尾のサイト名部分を除去 ("- SITE_NAME" など)
    .replace(/\s+/g, ' ')                   // 連続スペースを単一に
    .trim();

  // JSON-LDから価格取得を試行（script タグ置換はせず本文キャプチャのみ）
  let price: number | null = null;
  for (const raw of parseJsonLdScripts(html)) {
    if (price) break;
    if (!raw || typeof raw !== 'object') continue;
    const data = raw as {
      hasVariant?: Array<{ offers?: { price?: unknown; priceCurrency?: string } }>;
      offers?: { price?: unknown; priceCurrency?: string } | Array<{ price?: unknown; priceCurrency?: string }>;
      '@graph'?: Array<{ offers?: { price?: unknown; priceCurrency?: string } }>;
    };

    // hasVariant配列をチェック（Shopifyなど）- JPYを優先
    if (data.hasVariant && Array.isArray(data.hasVariant)) {
      for (const variant of data.hasVariant) {
        if (variant.offers?.price && variant.offers?.priceCurrency === 'JPY') {
          price = parseYenPrice(variant.offers.price);
          break;
        }
      }
    }

    // 直接のoffers（JPYを優先）
    if (!price && data.offers) {
      // offersが配列の場合
      if (Array.isArray(data.offers)) {
        for (const offer of data.offers) {
          if (offer.price && (offer.priceCurrency === 'JPY' || !offer.priceCurrency)) {
            price = parseYenPrice(offer.price);
            break;
          }
        }
      } else if (data.offers.price) {
        // offersがオブジェクトの場合
        if (data.offers.priceCurrency === 'JPY' || !data.offers.priceCurrency) {
          price = parseYenPrice(data.offers.price);
        }
      }
    }

    // @graphをチェック
    if (!price && data['@graph']) {
      for (const item of data['@graph']) {
        if (item.offers?.price) {
          if (item.offers.priceCurrency === 'JPY' || !item.offers.priceCurrency) {
            price = parseYenPrice(item.offers.price);
            break;
          }
        }
      }
    }
  }

  // Shopify/EC サイトのJSON価格取得（JPY通貨を優先）
  if (!price) {
    // "price":"NNNNN","priceCurrency":"JPY" パターン（引用符付き価格）
    const jpyQuotedMatch = html.match(/"price"\s*:\s*"(\d+)"\s*,\s*"priceCurrency"\s*:\s*"JPY"/);
    if (jpyQuotedMatch) {
      price = parseInt(jpyQuotedMatch[1], 10);
    }
  }
  
  if (!price && /og:price:|shopify/i.test(html)) {
    const { currency, amount, shopifyTheme } = storePriceMetadata(html, sanitizedUrl);
    if (currency === 'JPY') price = parseOgYenAmount(amount);
    if (!price && shopifyTheme && (!currency || currency === 'JPY')) {
      const minorUnits = html.match(/"price":(\d{5,})/);
      if (minorUnits) price = Math.round(Number(minorUnits[1]) / 100);
    }
  }

  // フォールバック: HTMLから価格パターンを検索。
  // Apple の構成ページは単一価格が無く、月額・修理料・最低購入金額を拾いやすいので
  // JSON-LD / og:price 以外の緩い円表記フォールバックは使わない（価格未取得）。
  if (!price && !appleBuyPage) {
    // EC-CUBE系サイトの販売価格（price02_default）を優先
    const eccubePriceMatch = html.match(/id="price02_default">([\d,]+)/);
    if (eccubePriceMatch) {
      price = parseInt(eccubePriceMatch[1].replace(/,/g, ''), 10);
    }
  }

  if (!price && !appleBuyPage) {
    // 「販売価格」の近くにある価格を探す（より厳密なパターン）
    // 「販売価格: 1,234円」や「販売価格：¥1,234」のような形式
    const salePriceMatch = html.match(/販売価格[\s：:]*¥?\s*([\d,]+)/);
    if (salePriceMatch) {
      const extracted = parseInt(salePriceMatch[1].replace(/,/g, ''), 10);
      if (extracted >= 100) { // 100円未満は除外
        price = extracted;
      }
    }
  }

  if (!price && !appleBuyPage) {
    // まず価格用のクラス/ID内の価格を探す（0円を除外）
    const structuredPriceMatches = html.matchAll(/<[^>]*(?:class|id)="[^"]*price[^"]*"[^>]*>\s*¥?\s*([\d,]+)/gi);
    for (const match of structuredPriceMatches) {
      if (match.index != null && !yenMatchLooksLikeProductPrice(html, match.index, match[0])) continue;
      const extracted = parseInt(match[1].replace(/,/g, ''), 10);
      if (extracted > 0) {
        price = extracted;
        break;
      }
    }
  }

  if (!price && !appleBuyPage) {
    // data-price属性
    const dataPriceMatch = html.match(/data-price="([\d,]+)"/);
    if (dataPriceMatch) {
      const extracted = parseInt(dataPriceMatch[1].replace(/,/g, ''), 10);
      if (extracted > 0) {
        price = extracted;
      }
    }
  }

  if (!price && !appleBuyPage) {
    // 一般的な価格パターン。分割払い・月額・保証修理料などの近傍は除外する。
    price = firstProductYenMatch(html, /([\d,]+)円/g);
  }

  if (!price && !appleBuyPage) {
    price = firstProductYenMatch(html, /¥\s*([\d,]+)/g)
      ?? firstProductYenMatch(html, /JPY\s*([\d,]+)/gi);
  }

  // 画像。空の og:image は未取得扱い。親要素に main/product がある img も拾う。
  let imageUrl = extractProductImageUrl(html);

  // Resolve relative/CDN images and prefer HTTPS on secure product pages.
  if (imageUrl) {
    try {
      const image = new URL(imageUrl.replace(/&amp;/g, '&'), sanitizedUrl);
      if (image.protocol === 'http:' && sanitizedUrl.startsWith('https:')) image.protocol = 'https:';
      imageUrl = ['https:', 'http:'].includes(image.protocol) ? image.href : null;
    } catch { imageUrl = null; }
  }

  // ホスト名からソース名を生成
  const sourceName = hostname.replace(/^www\./, '').split('.')[0];

  return {
    name,
    price,
    imageUrl,
    source: 'other',
    sourceName: sourceName.charAt(0).toUpperCase() + sourceName.slice(1),
  };
}
