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
