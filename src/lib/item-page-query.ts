import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { filterHomeItems, type HomeListQuery, type HomeSortBy } from './home-wishlist';
import { annotateSpend, moneyTotals, photoSpendDecisions, userSpendInput } from './photo-spend';
import { planItemPage } from './item-page-plan.mjs';
import type { Item } from '../types';

export class ItemPageError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type IndexRow = Pick<Item, 'id' | 'name' | 'notes' | 'category_id' | 'priority' |
  'comparison_group_id' | 'current_price' | 'created_at' | 'sort_order'> & {
  category_name: string | null;
  comparison_group_origin: string | null;
  group_priority: number | null;
};
type Cursor = { v: 1; revision: string; offset: number };
const SORTS = new Set<HomeSortBy>(['priority', 'price_asc', 'price_desc', 'date_new', 'date_old', 'name']);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function numberParam(value: string | null, name: string, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value == null || value === '') return null;
  if (!/^[1-9]\d*$/.test(value)) throw new ItemPageError(400, 'INVALID_QUERY', name + ' is invalid');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new ItemPageError(400, 'INVALID_QUERY', name + ' is invalid');
  return number;
}

export function parseItemPageQuery(params: URLSearchParams) {
  const sort = params.get('sort') ?? 'priority';
  if (!SORTS.has(sort as HomeSortBy)) throw new ItemPageError(400, 'INVALID_QUERY', 'sort is invalid');
  const searchQuery = params.get('q') ?? '';
  if (searchQuery.length > 200) throw new ItemPageError(400, 'INVALID_QUERY', 'q is too long');
  const query: HomeListQuery = {
    selectedCategory: numberParam(params.get('category'), 'category'),
    selectedPriority: numberParam(params.get('priority'), 'priority', 5),
    selectedGroup: numberParam(params.get('group'), 'group'),
    searchQuery, sortBy: sort as HomeSortBy,
  };
  const limit = numberParam(params.get('limit'), 'limit', 100) ?? 50;
  let cursor: Cursor | null = null;
  const raw = params.get('cursor');
  if (raw != null) {
    try {
      if (raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if (parsed.v !== 1 || typeof parsed.revision !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.revision)
          || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error();
      cursor = { v: 1, revision: parsed.revision, offset: parsed.offset };
    } catch { throw new ItemPageError(400, 'INVALID_CURSOR', '追加読み込みの情報が不正です'); }
  }
  return { query, limit, cursor };
}

/**
 * Read one consistent DB snapshot. The thin search/order index remains O(N);
 * full item fields and price histories are fetched only for the requested page.
 * No schema changes, writes, caches, live EC calls, or production data fixtures.
 */
export function readItemPage(database: Database.Database, userId: number, params: URLSearchParams) {
  const { query, limit, cursor } = parseItemPageQuery(params);
  return database.transaction(() => {
    const index = database.prepare(`
      SELECT i.id, i.name, i.notes, i.category_id, i.priority, i.comparison_group_id,
        i.current_price, i.created_at, i.sort_order, cat.name AS category_name,
        cg.origin AS comparison_group_origin, cg.priority AS group_priority
      FROM items i
      LEFT JOIN categories cat ON cat.id = i.category_id AND cat.user_id = i.user_id
      LEFT JOIN comparison_groups cg ON cg.id = i.comparison_group_id AND cg.user_id = i.user_id
      WHERE i.user_id = ? AND i.is_purchased = 0 AND i.deleted_at IS NULL
      ORDER BY COALESCE(cg.priority, i.priority), i.sort_order, i.created_at DESC, i.id
    `).all(userId) as IndexRow[];
    const [spendItems, spendGroups] = userSpendInput(database, userId);
    const decisions = photoSpendDecisions(spendItems, spendGroups);
    const filtered = filterHomeItems(index, query);
    // Include sort/filter values and all budget inputs, not timestamps alone:
    // edits in the same second, a delete/add pair, or another tab must invalidate.
    const revision = digest([1, userId, query, limit, index, spendItems, spendGroups]);
    if (cursor && cursor.revision !== revision) {
      throw new ItemPageError(409, 'LIST_CHANGED', '一覧が更新されました。先頭から読み込み直してください');
    }
    let page;
    try { page = planItemPage(filtered, cursor?.offset ?? 0, limit); }
    catch { throw new ItemPageError(400, 'INVALID_CURSOR', '追加読み込みの位置が不正です'); }
    const rows = page.ids.length ? database.prepare(`
      WITH visible AS (
        SELECT i.* FROM items i
        WHERE i.user_id = ? AND i.is_purchased = 0 AND i.deleted_at IS NULL
          AND i.id IN (SELECT value FROM json_each(?))
      ), ranked AS (
        SELECT h.item_id, h.price,
          ROW_NUMBER() OVER (PARTITION BY h.item_id ORDER BY h.recorded_at DESC, h.id DESC) AS rn
        FROM price_history h WHERE h.item_id IN (SELECT id FROM visible)
      )
      SELECT i.*, cg.name AS comparison_group_name,
        cg.origin AS comparison_group_origin, cg.origin AS group_origin,
        cg.priority AS group_priority, cat.name AS category_name, cat.color AS category_color,
        prev.price AS previous_price
      FROM visible i
      LEFT JOIN comparison_groups cg ON cg.id = i.comparison_group_id AND cg.user_id = i.user_id
      LEFT JOIN categories cat ON cat.id = i.category_id AND cat.user_id = i.user_id
      LEFT JOIN ranked prev ON prev.item_id = i.id AND prev.rn = 2
    `).all(userId, JSON.stringify(page.ids)) as Item[] : [];
    const byId = new Map(annotateSpend(rows, decisions).map(row => [row.id, row]));
    const items = page.ids.map(id => {
      const row = byId.get(id);
      if (!row) throw new Error('Inconsistent item snapshot');
      return row;
    });
    const prices = filtered.map(row => row.current_price).filter((value): value is number => Boolean(value));
    return {
      items, revision,
      totalCount: index.length, matchedCount: filtered.length, rowCount: page.rowCount,
      totalAmount: moneyTotals(spendItems, decisions).wishlistTotal,
      lowestPriceInGroup: query.selectedGroup && prices.length ? Math.min(...prices) : null,
      // Lightweight identities preserve whole-result selection / refresh-all semantics.
      matchedIds: filtered.map(row => row.id), allIds: index.map(row => row.id),
      nextCursor: page.nextOffset == null ? null : Buffer.from(JSON.stringify({
        v: 1, revision, offset: page.nextOffset,
      } satisfies Cursor)).toString('base64url'),
    };
  })();
}
