import { Parser } from 'htmlparser2';
import { isBotChallengedHtml, PRODUCT_FETCH_BLOCKED_HELP } from './public-page';
import { tsukumoCatalogImage } from './tsukumo-catalog';
import type { ScrapedItem } from './scraper';

export const PRODUCT_WAITING_HELP = '販売サイトのボット対策による待機ページが返されたため、価格と画像を取得できませんでした。商品ページをブラウザで確認し、時間をおいて再試行するか、別の店のURLを使ってください。商品名を入力して手動で追加することもできます。';

/** HTTP 200 でも商品ではない botfailover テンプレートを解析前に除外する。 */
function isProductWaitingPage(html: string): boolean {
  const title = html.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1]
    .replace(/\s+/g, ' ').trim();
  return !!title && /^hang tight!\s*routing to checkout(?:\.{0,3}|…)?$/i.test(title);
}

/**
 * 表示・構造化データの円価格。不完全な断片（例: 切り途中の "4,"）や壊れた桁区切りは捨てる。
 * 数値はそのまま範囲だけ見る。スクレイプ結果を「事実の価格」として残す前の共通ガード。
 */
export function parseYenPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 && value <= 1_000_000_000 ? Math.round(value) : null;
  }
  const text = String(value ?? '').replace(/[¥￥\s]/g, '').trim();
  if (!text) return null;
  // 1234 / 1,234 / 12,345,678（任意で小数）。末尾カンマや 12,34 は拒否。
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null;
  const price = Number(text.replace(/,/g, ''));
  return Number.isFinite(price) && price > 0 && price <= 1_000_000_000 ? Math.round(price) : null;
}

const titleEntities: Record<string, string> = {
  '&ndash;': '-', '&mdash;': '-', '&amp;': '&', '&quot;': '"', '&#39;': "'",
};

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
    const extracted = parseYenPrice(match[1]);
    if (extracted != null) return extracted;
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

function resolveProductImage(src: string | null, pageUrl: string): string | null {
  if (!src) return null;
  try {
    const image = new URL(src, pageUrl);
    if (image.protocol === 'http:' && pageUrl.startsWith('https:')) image.protocol = 'https:';
    return ['https:', 'http:'].includes(image.protocol) ? image.href : null;
  } catch { return null; }
}

// ツクモの共有用画像は小さいため、商品ページで表示する figure#mainimg の写真を優先する。
function tsukumoMainImage(html: string, pageUrl: string): string | null {
  let figureDepth = 0;
  let image: string | null = null;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'figure' && (figureDepth || attrs.id === 'mainimg')) figureDepth++;
      if (figureDepth && tag === 'img' && attrs.src?.trim()) {
        image = resolveProductImage(attrs.src.trim(), pageUrl);
        if (image) parser.pause();
      }
    },
    onclosetag(tag) {
      if (tag === 'figure' && figureDepth) figureDepth--;
    },
  });
  parser.end(html);
  return image;
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
  const isTsukumoProduct = tsukumoCatalogImage(sanitizedUrl) !== null;
  // タイトルから商品名
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let name = titleMatch ? titleMatch[1].trim() : '不明な商品';
  // タイトルのクリーンアップ: 改行、HTMLエンティティ、サイト名の区切り文字などを除去
  name = name
    .replace(/\n/g, ' ')                    // 改行をスペースに
    .replace(/&(?:ndash|mdash|amp|quot|#39);/g, entity => titleEntities[entity])
    .replace(isTsukumoProduct ? /\s*[｜|–—-]\s*ツクモ公式通販サイト$/ : /\s*[-|–—]\s*[^-|–—]+$/, '')
    .replace(/\s+/g, ' ')                   // 連続スペースを単一に
    .trim();

  // Apple の構成（buy-）ページはモデル未選択で単一の売価が無い。
  // 月額・最低購入・修理料に加え、JSON-LD / og:price に載る「から」価格も誤認しやすいので
  // 構造化データも含めて価格は常に未取得（#327 / #397）。
  let price: number | null = null;
  if (!appleBuyPage) {
    // JSON-LDから価格取得を試行（script タグ置換はせず本文キャプチャのみ）
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
        price = parseYenPrice(jpyQuotedMatch[1]);
      }
    }

    if (!price) {
      // Shopifyサイトのセント単位価格（Shopifyかどうかを確認）
      const isShopify = html.includes('cdn.shopify.com') || html.includes('Shopify.theme');
      if (isShopify) {
        // Shopifyの場合、"price":NNNNNN (5桁以上、セント単位) をJPYとみなす
        const shopifyPriceMatch = html.match(/"price":(\d{5,})/);
        if (shopifyPriceMatch) {
          // 100で割って円に変換
          price = parseYenPrice(Math.round(parseInt(shopifyPriceMatch[1], 10) / 100));
        }
      }
    }

    // og:price:amount メタタグから価格取得（通貨がJPYの場合のみ）
    if (!price) {
      const ogCurrencyMatch = html.match(/<meta[^>]*property="og:price:currency"[^>]*content="([^"]+)"/);
      const currency = ogCurrencyMatch ? ogCurrencyMatch[1] : null;

      if (currency === 'JPY') {
        const ogPriceMatch = html.match(/<meta[^>]*property="og:price:amount"[^>]*content="([^"]+)"/) ||
                             html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:price:amount"/);
        if (ogPriceMatch) {
          price = parseYenPrice(ogPriceMatch[1]);
        }
      }
    }

    // フォールバック: HTMLから価格パターンを検索。
    if (!price) {
      // EC-CUBE系サイトの販売価格（price02_default）を優先
      const eccubePriceMatch = html.match(/id="price02_default">([\d,]+)/);
      if (eccubePriceMatch) {
        price = parseYenPrice(eccubePriceMatch[1]);
      }
    }

    if (!price) {
      // 「販売価格」の近くにある価格を探す（より厳密なパターン）
      // 「販売価格: 1,234円」や「販売価格：¥1,234」のような形式
      const salePriceMatch = html.match(/販売価格[\s：:]*¥?\s*([\d,]+)/);
      if (salePriceMatch) {
        const extracted = parseYenPrice(salePriceMatch[1]);
        if (extracted != null && extracted >= 100) { // 100円未満は除外
          price = extracted;
        }
      }
    }

    if (!price) {
      // まず価格用のクラス/ID内の価格を探す（0円・不完全断片を除外）
      const structuredPriceMatches = html.matchAll(/<[^>]*(?:class|id)="[^"]*price[^"]*"[^>]*>\s*¥?\s*([\d,]+)/gi);
      for (const match of structuredPriceMatches) {
        if (match.index != null && !yenMatchLooksLikeProductPrice(html, match.index, match[0])) continue;
        const extracted = parseYenPrice(match[1]);
        if (extracted != null) {
          price = extracted;
          break;
        }
      }
    }

    if (!price) {
      // data-price属性
      const dataPriceMatch = html.match(/data-price="([\d,]+)"/);
      if (dataPriceMatch) {
        price = parseYenPrice(dataPriceMatch[1]);
      }
    }

    if (!price) {
      // 一般的な価格パターン。分割払い・月額・保証修理料などの近傍は除外する。
      price = firstProductYenMatch(html, /([\d,]+)円/g);
    }

    if (!price) {
      price = firstProductYenMatch(html, /¥\s*([\d,]+)/g)
        ?? firstProductYenMatch(html, /JPY\s*([\d,]+)/gi);
    }
  }

  const mainImage = isTsukumoProduct ? tsukumoMainImage(html, sanitizedUrl) : null;
  const imageUrl = mainImage ?? resolveProductImage(
    extractProductImageUrl(html)?.replace(/&amp;/g, '&') ?? null, sanitizedUrl,
  );

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
