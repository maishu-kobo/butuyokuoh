import { request } from 'node:https';
import type { ScrapedItem } from './scraper';
import { productImageHeadFixture } from './product-fetch-port';
import { tsukumoCatalogImage } from './tsukumo-catalog';

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

  if (item) return { ...item, imageUrl: catalog.imageUrl, imageIsFallback: true };
  return {
    name: `ツクモの商品（${catalog.productNumber}）`,
    nameIsFallback: true,
    price: null,
    imageUrl: catalog.imageUrl,
    imageIsFallback: true,
    source: 'other',
    sourceName: 'ツクモ',
    note: '商品画像を確認しました。商品名と価格は取得できませんでした。「編集」から入力・変更できます。',
  };
}
