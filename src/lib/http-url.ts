// 商品URLは http/https だけをリンクにする。manual:// は URL なし商品の内部識別子で、画面のリンクにはしない。
export function linkableHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isStorableItemUrl(value: string): boolean {
  if (value.startsWith('manual://')) return !/[\u0000-\u001f\s]/.test(value);
  return linkableHttpUrl(value) !== null;
}

export const ITEM_URL_ERROR = 'URLは http または https を指定してください';

/** 広告経由の長い URL を受け付ける。保存前にトラッキングを落とす。 */
export const ITEM_URL_MAX = 8192;
export const ITEM_IMAGE_URL_MAX = 2048;
