import { isAmazonProductPage } from './amazon-product';
import { consumeAgentRates, recordAgentAudit, type AgentAuthContext } from './agent-token';
import { getDb } from './db';
import { requireExtensionImportItems } from './extension-item-input';
import { GuestError } from './guest';
import { ITEM_URL_MAX } from './http-url';
import { prepareWishlistImport } from './wishlist-import';

export const MAX_WISHLIST_IMPORT_ITEMS = 100;

function wishlistProductSource(url: string) {
  if (!/^https:\/\//i.test(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return null;
  if (isAmazonProductPage(parsed)) return 'amazon';
  if (parsed.hostname === 'item.rakuten.co.jp' && /^\/[^/]+\/[^/]+\/?$/.test(parsed.pathname)) return 'rakuten';
  if (parsed.hostname === 'books.rakuten.co.jp' && /^\/rb\/\d+\/?$/.test(parsed.pathname)) return 'rakuten';
  if (parsed.hostname === 'product.rakuten.co.jp' && /^\/product\/.+/.test(parsed.pathname)) return 'rakuten';
  return null;
}

export function importAgentWishlist(auth: AgentAuthContext, input: Record<string, unknown>) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_WISHLIST_IMPORT_ITEMS) {
    throw new GuestError(400, 'INVALID_INPUT', `items は1〜${MAX_WISHLIST_IMPORT_ITEMS}件で指定してください`);
  }
  const items = requireExtensionImportItems(input.items);
  const db = getDb();
  try {
    return db.transaction(() => {
      // リンクだけを移行する呼び出しは、1バッチにつき書き込みの分枠を1回消費する。
      consumeAgentRates(auth.token.id, ['add'], 1, db);
      const save = prepareWishlistImport(db, auth.userId, auth.token.id);
      const results = items.map((item) => {
        if (item.url.length > ITEM_URL_MAX) return { status: 'invalid' } as const;
        return save(item, wishlistProductSource);
      });
      const counts = { total: results.length, added: 0, restored: 0, existing: 0, failed: 0 };
      for (const result of results) {
        if (result.status === 'invalid') counts.failed++;
        else counts[result.status]++;
      }
      recordAgentAudit(auth.token.id, auth.userId, 'wishlist.import', counts, db);
      return { ...counts, results };
    }).immediate();
  } catch (error) {
    if (error instanceof GuestError && error.code === 'AGENT_RATE_LIMITED') {
      recordAgentAudit(auth.token.id, auth.userId, 'auth.rate_limited', { tool: 'import_wishlist_items' }, db);
    }
    throw error;
  }
}
