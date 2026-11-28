import type Database from 'better-sqlite3';
import { validateMemberInput } from './api-access';
import { GuestError } from './guest';
import { amazonWishlistProductIdentity } from './amazon-product';
import { rakutenProductIdentity } from './capture/rakuten-link';
import {
  classifyStoredUrlMatches, normalizeItemName, sanitizeStoredItemUrl, restoreTrashedItem, type StoredUrlMatch,
} from './item-input';
import type { ExtensionImportItemInput } from './extension-item-input';

// 拡張とMCPで共有する。商品ページを取り直さず、リンクと名前だけで独立した品目を登録する。
export function prepareWishlistImport(db: Database.Database, userId: number, tokenId?: number) {
  // 1回のトランザクション内の索引。以前に保存した計測パラメータ付きURLも1回だけ正規化する。
  const byUrl = new Map<string, StoredUrlMatch[]>();
  const byProduct = new Map<string, StoredUrlMatch[]>();
  function indexRow(row: StoredUrlMatch) {
    const url = sanitizeStoredItemUrl(row.url) ?? row.url;
    const matches = byUrl.get(url) ?? [];
    matches.push(row);
    byUrl.set(url, matches);
    const product = amazonWishlistProductIdentity(row.url) ?? rakutenProductIdentity(row.url);
    if (product) {
      const products = byProduct.get(product) ?? [];
      products.push(row);
      byProduct.set(product, products);
    }
  }
  const stored = db.prepare('SELECT id, name, url, deleted_at, is_purchased FROM items WHERE user_id = ?');
  for (const row of stored.iterate(userId)) indexRow(row as StoredUrlMatch);

  const insert = db.prepare(`
    INSERT INTO items (user_id, name, url, source, source_name, priority, added_by_agent_token_id)
    VALUES (?, ?, ?, ?, ?, 3, ?)
  `);
  return (item: ExtensionImportItemInput, source: string | ((cleanUrl: string) => string | null)) => {
    const name = normalizeItemName(item.name);
    const url = sanitizeStoredItemUrl(item.url);
    if (!name || !url) return { status: 'invalid' } as const;
    try {
      validateMemberInput({ name, url }, 'POST');
    } catch (error) {
      if (error instanceof GuestError) return { status: 'invalid' } as const;
      throw error;
    }

    const store = typeof source === 'function' ? source(url) : source;
    if (!store) return { status: 'invalid' } as const;
    const product = amazonWishlistProductIdentity(url) ?? rakutenProductIdentity(url);
    const matches = byUrl.get(url) ?? [];
    const registration = classifyStoredUrlMatches(product ? matches.concat(byProduct.get(product) ?? []) : matches);
    if (registration.kind === 'active') return { status: 'existing', item_id: registration.match.id } as const;
    if (registration.kind === 'trashed') {
      restoreTrashedItem(db, userId, registration.match.id);
      registration.match.deleted_at = null;
      return { status: 'restored', item_id: registration.match.id } as const;
    }

    const sourceName = store === 'amazon' ? 'Amazon' : store === 'rakuten' ? '楽天市場' : store;
    const row = insert.run(userId, name, url, store, sourceName, tokenId ?? null);
    const id = Number(row.lastInsertRowid);
    indexRow({ id, name, url, deleted_at: null, is_purchased: 0 });
    return { status: 'added', item_id: id } as const;
  };
}
