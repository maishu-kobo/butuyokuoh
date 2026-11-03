import { GuestError } from './guest';
import { ITEM_URL_ERROR } from './http-url';
import { normalizeItemName, sanitizeStoredItemUrl } from './item-input';

export type ExtensionAddItemInput = {
  name: string;
  url: string;
  price?: number | null;
  imageUrl?: string | null;
  priority?: number;
  categoryId?: string | null;
};

/** 一括 import の1件。価格・画像はクライアントから来ても使わない（#276）。 */
export type ExtensionImportItemInput = {
  name: string;
  url: string;
};

/** 拡張 add 用。不正なら GuestError(400)。 */
export function requireExtensionAddItem(item: unknown): {
  name: string;
  url: string;
  priority: number;
  categoryId: string | null;
} {
  if (!item || typeof item !== 'object') {
    throw new GuestError(400, 'INVALID_INPUT', '商品名とURLは必須です');
  }
  const rec = item as Record<string, unknown>;
  if (typeof rec.name !== 'string' || typeof rec.url !== 'string') {
    throw new GuestError(400, 'INVALID_INPUT', '商品名とURLは必須です');
  }
  const name = normalizeItemName(rec.name);
  const url = sanitizeStoredItemUrl(rec.url);
  if (!name || !url) {
    throw new GuestError(400, 'INVALID_INPUT', !url ? ITEM_URL_ERROR : '商品名とURLは必須です');
  }
  return {
    name,
    url,
    priority: typeof rec.priority === 'number' ? rec.priority : 3,
    categoryId: typeof rec.categoryId === 'string' || rec.categoryId === null
      ? (rec.categoryId as string | null)
      : null,
  };
}

/**
 * 拡張 import 用。空なら GuestError(400)。
 * 各要素の価格・画像は捨て、名前と URL だけ返す（整形は呼び出し側）。
 */
export function requireExtensionImportItems(items: unknown): ExtensionImportItemInput[] {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new GuestError(400, 'INVALID_INPUT', 'インポートするアイテムがありません');
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object') {
      return { name: '', url: '' };
    }
    const rec = item as Record<string, unknown>;
    return {
      name: typeof rec.name === 'string' ? rec.name : '',
      url: typeof rec.url === 'string' ? rec.url : '',
    };
  });
}
