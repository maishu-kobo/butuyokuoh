/** ツクモ公式の商品番号と、その番号に対応する主画像の固定パス。 */
export function tsukumoCatalogImage(value: string | null | undefined) {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://shop.tsukumo.co.jp' || url.username || url.password) return null;
  const productNumber = /^\/goods\/(\d{13})\/?$/.exec(url.pathname)?.[1];
  if (!productNumber) return null;
  const path = `/image/item/${productNumber}_1.jpg`;
  return { productNumber, path, imageUrl: `https://cdn.tsukumo.co.jp${path}` };
}
