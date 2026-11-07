import type { ScrapedItem } from './scraper';
import { productImageHeadFixture } from './product-fetch-port';

/** ツクモ公式の商品番号と、その番号に対応する主画像の固定パス。 */
function tsukumoCatalogImage(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://shop.tsukumo.co.jp' || url.username || url.password) return null;
  const productNumber = /^\/goods\/(\d{13})\/?$/.exec(url.pathname)?.[1];
  if (!productNumber) return null;
  return { productNumber, imageUrl: `https://cdn.tsukumo.co.jp/image/item/${productNumber}_1.jpg` };
}

export async function recoverTsukumoImage(url: string, item?: ScrapedItem): Promise<ScrapedItem | null> {
  if (item?.imageUrl) return null;
  const catalog = tsukumoCatalogImage(url);
  if (!catalog) return null;

  // 既知の CDN の固定パスだけを照会する。別のページや代替画像への転送は使わない。
  try {
    const response = productImageHeadFixture(catalog.imageUrl) ?? await fetch(catalog.imageUrl, {
      method: 'HEAD', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 200 || !/^image\/jpeg(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
        response.headers.get('content-length') === '0') return null;
  } catch { return null; }

  if (item) return { ...item, imageUrl: catalog.imageUrl };
  return {
    name: `ツクモの商品（${catalog.productNumber}）`,
    nameIsFallback: true,
    price: null,
    imageUrl: catalog.imageUrl,
    source: 'other',
    sourceName: 'ツクモ',
    note: '商品画像を取得しました。商品名と価格は取得できなかったため、商品番号で表示します。「編集」から変更できます。',
  };
}
