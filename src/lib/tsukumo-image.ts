import { request } from 'node:https';
import type { ScrapedItem } from './scraper';
import { productImageHeadFixture } from './product-fetch-port';

/** ツクモ公式の商品番号と、その番号に対応する主画像の固定パス。 */
function tsukumoCatalogImage(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://shop.tsukumo.co.jp' || url.username || url.password) return null;
  const productNumber = /^\/goods\/(\d{13})\/?$/.exec(url.pathname)?.[1];
  if (!productNumber) return null;
  const path = `/image/item/${productNumber}_1.jpg`;
  return { productNumber, path, imageUrl: `https://cdn.tsukumo.co.jp${path}` };
}

function checkCatalogImage(path: string): Promise<boolean> {
  return new Promise(resolve => {
    // 接続先は常に公式 CDN。入力から得た数字はパスだけに使う。転送は追わない。
    const head = request({
      hostname: 'cdn.tsukumo.co.jp',
      method: 'HEAD',
      path,
      signal: AbortSignal.timeout(3000),
    }, response => {
      response.resume();
      resolve(isJpeg(response.statusCode, response.headers['content-type'], response.headers['content-length']));
    });
    head.on('error', () => resolve(false));
    head.end();
  });
}

function isJpeg(status?: number, type?: string | null, length?: string | null): boolean {
  return status === 200 && /^image\/jpeg(?:\s*;|$)/i.test(type ?? '') && length !== '0';
}

export async function recoverTsukumoImage(url: string, item?: ScrapedItem): Promise<ScrapedItem | null> {
  if (item?.imageUrl) return null;
  const catalog = tsukumoCatalogImage(url);
  if (!catalog) return null;

  const fixture = productImageHeadFixture(catalog.imageUrl);
  const available = fixture
    ? isJpeg(fixture.status, fixture.headers.get('content-type'), fixture.headers.get('content-length'))
    : await checkCatalogImage(catalog.path);
  if (!available) return null;

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
