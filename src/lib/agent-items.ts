// エージェント REST / MCP 共通の品目操作。価格・画像は item-input のサーバ取得だけを使う。

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { assertOwnedRelations } from '@/lib/api-access';
import { markItemAddedByAgent, type AgentAuthContext } from '@/lib/agent-token';
import { getDb } from '@/lib/db';
import { GuestError } from '@/lib/guest';
import { ITEM_URL_ERROR } from '@/lib/http-url';
import {
  cleanedStoredItemUrlTaken,
  fetchServerItemMedia,
  normalizeItemName,
  sanitizeStoredItemUrl,
  type FetchServerItemMediaOptions,
  type ServerItemMedia,
} from '@/lib/item-input';
import { localCalendarDate } from '@/lib/local-date';
import { BlockedTargetError, resolvedPublicAddress, type MemberFetchDeps } from '@/lib/member-fetch';
import { annotateSpend, photoSpendDecisions, userSpendInput } from '@/lib/photo-spend';
import { publicPageUrl } from '@/lib/public-page';
import type { Item } from '@/types';

export const AGENT_NOTES_MAX = 2000;

export type AgentItemStatus = 'active' | 'trashed' | 'purchased' | 'all';

export type AgentItemView = {
  id: number;
  name: string;
  url: string;
  image_url: string | null;
  current_price: number | null;
  original_price: number | null;
  source: string;
  source_name: string | null;
  priority: number;
  planned_purchase_date: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  comparison_group_id: number | null;
  comparison_group_name: string | null;
  notes: string | null;
  quantity: number;
  is_purchased: boolean;
  purchased_at: string | null;
  deleted_at: string | null;
  added_by_agent: boolean;
  added_by_agent_token_id: number | null;
  created_at: string;
  updated_at: string;
  /** 同じクリーン後 URL がゴミ箱や別ステータスにもあるとき true */
  has_url_duplicate: boolean;
};

function normalizeNotes(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new GuestError(400, 'INVALID_INPUT', 'メモは文字列で指定してください');
  }
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.length > AGENT_NOTES_MAX) {
    throw new GuestError(400, 'INVALID_INPUT', `メモは${AGENT_NOTES_MAX}文字以内にしてください`);
  }
  return cleaned;
}

function normalizePriority(raw: unknown, fallback = 3): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > 5) {
    throw new GuestError(400, 'INVALID_INPUT', '優先度は1〜5の整数です');
  }
  return raw;
}

function normalizeQuantity(raw: unknown, fallback = 1): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > 999) {
    throw new GuestError(400, 'INVALID_INPUT', '数量は1〜999の整数です');
  }
  return raw;
}

function normalizeOptionalDate(raw: unknown, field: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new GuestError(400, 'INVALID_INPUT', `${field} は YYYY-MM-DD 形式です`);
  }
  return raw;
}

function normalizeOptionalId(raw: unknown, field: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new GuestError(400, 'INVALID_INPUT', `${field} が不正です`);
  }
  return raw;
}

function requireHttpUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new GuestError(400, 'INVALID_INPUT', 'URLは必須です');
  }
  const cleaned = sanitizeStoredItemUrl(raw);
  if (!cleaned || cleaned.startsWith('manual://')) {
    throw new GuestError(400, 'INVALID_INPUT', ITEM_URL_ERROR);
  }
  return cleaned;
}

const PUBLIC_URL_HELP = '公開されている商品ページのHTTP(S) URLを指定してください';

/** 保存前に SSRF ガード（publicPageUrl + 名前解決）。fetchPublicMember と同じ公開判定。 */
export async function assertAgentPublicUrl(
  url: string,
  deps?: Pick<MemberFetchDeps, 'resolve'>,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = publicPageUrl(url);
  } catch {
    throw new GuestError(400, 'URL_BLOCKED', PUBLIC_URL_HELP);
  }
  try {
    await resolvedPublicAddress(parsed, deps?.resolve);
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      throw new GuestError(400, 'URL_BLOCKED', PUBLIC_URL_HELP);
    }
    throw new GuestError(400, 'URL_BLOCKED', PUBLIC_URL_HELP);
  }
}

function rejectBlockedScrape(media: ServerItemMedia): void {
  const name = media.scraped?.name?.trim() || '';
  if (name === '無効なURL') {
    throw new GuestError(400, 'URL_BLOCKED', PUBLIC_URL_HELP);
  }
}

function rowToView(
  row: Record<string, unknown>,
  duplicateUrls: Set<string>,
): AgentItemView {
  const url = String(row.url ?? '');
  const cleaned = sanitizeStoredItemUrl(url) ?? url;
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    url,
    image_url: (row.image_url as string | null) ?? null,
    current_price: (row.current_price as number | null) ?? null,
    original_price: (row.original_price as number | null) ?? null,
    source: String(row.source ?? 'other'),
    source_name: (row.source_name as string | null) ?? null,
    priority: Number(row.priority ?? 3),
    planned_purchase_date: (row.planned_purchase_date as string | null) ?? null,
    category_id: (row.category_id as number | null) ?? null,
    category_name: (row.category_name as string | null) ?? null,
    category_color: (row.category_color as string | null) ?? null,
    comparison_group_id: (row.comparison_group_id as number | null) ?? null,
    comparison_group_name: (row.comparison_group_name as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    quantity: Number(row.quantity ?? 1),
    is_purchased: Boolean(row.is_purchased),
    purchased_at: (row.purchased_at as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
    added_by_agent: row.added_by_agent_token_id != null,
    added_by_agent_token_id: (row.added_by_agent_token_id as number | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    has_url_duplicate: duplicateUrls.has(cleaned),
  };
}

function duplicateCleanedUrls(db: Database.Database, userId: number): Set<string> {
  const rows = db.prepare('SELECT url FROM items WHERE user_id = ?').all(userId) as { url: string }[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cleaned = sanitizeStoredItemUrl(row.url) ?? row.url;
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [url, count] of counts) {
    if (count > 1) dupes.add(url);
  }
  return dupes;
}

export function getOwnedItemOrThrow(
  userId: number,
  itemId: number,
  db: Database.Database = getDb(),
): Record<string, unknown> {
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  const row = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(itemId, userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  return row;
}

export function listAgentItems(
  userId: number,
  options: {
    q?: string;
    status?: AgentItemStatus;
    limit?: number;
    offset?: number;
  } = {},
  db: Database.Database = getDb(),
): { items: AgentItemView[]; total: number } {
  const status: AgentItemStatus = options.status ?? 'active';
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 100);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const q = typeof options.q === 'string' ? options.q.trim().slice(0, 200) : '';

  const where: string[] = ['i.user_id = ?'];
  const params: unknown[] = [userId];

  if (status === 'active') {
    where.push('i.deleted_at IS NULL', 'i.is_purchased = 0');
  } else if (status === 'trashed') {
    where.push('i.deleted_at IS NOT NULL');
  } else if (status === 'purchased') {
    where.push('i.deleted_at IS NULL', 'i.is_purchased = 1');
  }

  if (q) {
    where.push('(i.name LIKE ? OR IFNULL(i.notes, \'\') LIKE ? OR i.url LIKE ? OR IFNULL(cat.name, \'\') LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like);
  }

  const whereSql = where.join(' AND ');
  const total = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM items i
    LEFT JOIN categories cat ON i.category_id = cat.id AND cat.user_id = i.user_id
    WHERE ${whereSql}
  `).get(...params) as { count: number }).count;

  const rows = db.prepare(`
    SELECT
      i.*,
      cat.name AS category_name,
      cat.color AS category_color,
      cg.name AS comparison_group_name
    FROM items i
    LEFT JOIN categories cat ON i.category_id = cat.id AND cat.user_id = i.user_id
    LEFT JOIN comparison_groups cg ON i.comparison_group_id = cg.id AND cg.user_id = i.user_id
    WHERE ${whereSql}
    ORDER BY
      CASE WHEN i.deleted_at IS NOT NULL THEN 1 ELSE 0 END ASC,
      i.is_purchased ASC,
      i.priority ASC,
      i.sort_order ASC,
      i.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Record<string, unknown>[];

  const dupes = duplicateCleanedUrls(db, userId);
  return { items: rows.map((row) => rowToView(row, dupes)), total };
}

export function getAgentItem(
  userId: number,
  itemId: number,
  db: Database.Database = getDb(),
): AgentItemView {
  const row = db.prepare(`
    SELECT
      i.*,
      cat.name AS category_name,
      cat.color AS category_color,
      cg.name AS comparison_group_name
    FROM items i
    LEFT JOIN categories cat ON i.category_id = cat.id AND cat.user_id = i.user_id
    LEFT JOIN comparison_groups cg ON i.comparison_group_id = cg.id AND cg.user_id = i.user_id
    WHERE i.id = ? AND i.user_id = ?
  `).get(itemId, userId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  return rowToView(row, duplicateCleanedUrls(db, userId));
}

function insertAgentItem(
  auth: AgentAuthContext,
  input: {
    name: string;
    url: string;
    media: ServerItemMedia;
    priority: number;
    quantity: number;
    notes: string | null;
    planned_purchase_date: string | null;
    category_id: number | null;
    comparison_group_id: number | null;
  },
  db: Database.Database,
): AgentItemView {
  if (cleanedStoredItemUrlTaken(db, auth.userId, input.url)) {
    throw new GuestError(409, 'URL_TAKEN', 'このURLは既に登録されています（ゴミ箱内を含む）');
  }

  assertOwnedRelations(db, auth.userId, {
    category_id: input.category_id,
    comparison_group_id: input.comparison_group_id,
  });

  const result = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO items (
        user_id, name, url, image_url, current_price, original_price,
        source, source_name, priority, planned_purchase_date,
        comparison_group_id, category_id, notes, quantity, added_by_agent_token_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auth.userId,
      input.name,
      input.url,
      input.media.imageUrl,
      input.media.price,
      input.media.price,
      input.media.source,
      input.media.sourceName,
      input.priority,
      input.planned_purchase_date,
      input.comparison_group_id,
      input.category_id,
      input.notes,
      input.quantity,
      auth.token.id,
    );
    const itemId = Number(inserted.lastInsertRowid);
    if (input.media.price != null) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, input.media.price);
    }
    markItemAddedByAgent(itemId, auth.token.id, auth.userId, db);
    return itemId;
  }).immediate();

  return getAgentItem(auth.userId, result, db);
}

export async function addAgentItemByUrl(
  auth: AgentAuthContext,
  body: Record<string, unknown>,
  mediaOptions: FetchServerItemMediaOptions = {},
  db: Database.Database = getDb(),
): Promise<{ item: AgentItemView; media_fetched: boolean }> {
  const url = requireHttpUrl(body.url);
  await assertAgentPublicUrl(url, mediaOptions.deps);
  const nameFromInput = body.name === undefined || body.name === null
    ? null
    : normalizeItemName(String(body.name));
  if (body.name != null && nameFromInput === null) {
    throw new GuestError(400, 'INVALID_INPUT', '商品名を入力してください');
  }

  const media = await fetchServerItemMedia(url, {
    ...mediaOptions,
    accountType: 'member',
    userId: auth.userId,
  });
  rejectBlockedScrape(media);
  const scrapedName = media.scraped && !media.scraped.name.includes('取得')
    ? normalizeItemName(media.scraped.name)
    : null;
  const name = nameFromInput ?? scrapedName;
  if (!name) {
    throw new GuestError(
      422,
      'NAME_REQUIRED',
      '商品名を取得できませんでした。name を指定して再度追加してください',
    );
  }

  const item = insertAgentItem(auth, {
    name,
    url,
    media: {
      ...media,
      // 取得失敗時は価格・画像を空にする（決定事項）
      price: media.price,
      imageUrl: media.imageUrl,
    },
    priority: normalizePriority(body.priority),
    quantity: normalizeQuantity(body.quantity),
    notes: normalizeNotes(body.notes),
    planned_purchase_date: normalizeOptionalDate(body.planned_purchase_date, 'planned_purchase_date') ?? null,
    category_id: normalizeOptionalId(body.category_id, 'category_id') ?? null,
    comparison_group_id: normalizeOptionalId(body.comparison_group_id, 'comparison_group_id') ?? null,
  }, db);

  return { item, media_fetched: media.price != null || media.imageUrl != null };
}

export async function addAgentItem(
  auth: AgentAuthContext,
  body: Record<string, unknown>,
  mediaOptions: FetchServerItemMediaOptions = {},
  db: Database.Database = getDb(),
): Promise<{ item: AgentItemView; media_fetched: boolean }> {
  const name = typeof body.name === 'string' ? normalizeItemName(body.name) : null;
  if (!name) {
    throw new GuestError(400, 'INVALID_INPUT', '商品名は必須です');
  }

  let url: string;
  if (body.url === undefined || body.url === null || body.url === '') {
    url = `manual://${randomUUID()}`;
  } else {
    url = requireHttpUrl(body.url);
  }

  let media: ServerItemMedia;
  let mediaFetched = false;
  if (url.startsWith('manual://')) {
    media = {
      price: null,
      imageUrl: null,
      source: 'other',
      sourceName: null,
      scraped: null,
    };
  } else {
    await assertAgentPublicUrl(url, mediaOptions.deps);
    media = await fetchServerItemMedia(url, {
      ...mediaOptions,
      accountType: 'member',
      userId: auth.userId,
    });
    rejectBlockedScrape(media);
    mediaFetched = media.price != null || media.imageUrl != null;
  }

  // クライアントの price / image_url は無視する
  const item = insertAgentItem(auth, {
    name,
    url,
    media,
    priority: normalizePriority(body.priority),
    quantity: normalizeQuantity(body.quantity),
    notes: normalizeNotes(body.notes),
    planned_purchase_date: normalizeOptionalDate(body.planned_purchase_date, 'planned_purchase_date') ?? null,
    category_id: normalizeOptionalId(body.category_id, 'category_id') ?? null,
    comparison_group_id: normalizeOptionalId(body.comparison_group_id, 'comparison_group_id') ?? null,
  }, db);

  return { item, media_fetched: mediaFetched };
}

export function updateAgentItem(
  auth: AgentAuthContext,
  itemId: number,
  body: Record<string, unknown>,
  db: Database.Database = getDb(),
): AgentItemView {
  const existing = getOwnedItemOrThrow(auth.userId, itemId, db);
  if (existing.deleted_at) {
    throw new GuestError(409, 'ITEM_TRASHED', 'ゴミ箱の品目は更新できません。先に復元してください');
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? normalizeItemName(body.name) : null;
    if (!name) throw new GuestError(400, 'INVALID_INPUT', '商品名を入力してください');
    updates.push('name = ?');
    values.push(name);
  }

  if (body.notes !== undefined) {
    updates.push('notes = ?');
    values.push(normalizeNotes(body.notes));
  }

  if (body.priority !== undefined) {
    updates.push('priority = ?');
    values.push(normalizePriority(body.priority, Number(existing.priority) || 3));
  }

  if (body.quantity !== undefined) {
    updates.push('quantity = ?');
    values.push(normalizeQuantity(body.quantity, Number(existing.quantity) || 1));
  }

  if (body.planned_purchase_date !== undefined) {
    updates.push('planned_purchase_date = ?');
    values.push(normalizeOptionalDate(body.planned_purchase_date, 'planned_purchase_date') ?? null);
  }

  if (body.category_id !== undefined) {
    const categoryId = normalizeOptionalId(body.category_id, 'category_id') ?? null;
    assertOwnedRelations(db, auth.userId, { category_id: categoryId });
    updates.push('category_id = ?');
    values.push(categoryId);
  }

  if (body.comparison_group_id !== undefined) {
    const groupId = normalizeOptionalId(body.comparison_group_id, 'comparison_group_id') ?? null;
    assertOwnedRelations(db, auth.userId, { comparison_group_id: groupId });
    updates.push('comparison_group_id = ?');
    values.push(groupId);
  }

  if (body.url !== undefined) {
    const currentUrl = String(existing.url);
    if (typeof body.url === 'string' && body.url === currentUrl) {
      // 未変更。#275 と同じく整形しない
    } else {
      const cleaned = requireHttpUrl(body.url);
      if (cleaned !== currentUrl && cleanedStoredItemUrlTaken(db, auth.userId, cleaned, itemId)) {
        throw new GuestError(409, 'URL_TAKEN', 'このURLは既に登録されています（ゴミ箱内を含む）');
      }
      updates.push('url = ?', 'source_item_code = NULL', 'price_fetched_at = NULL');
      values.push(cleaned);
    }
  }

  // 価格・画像はエージェントから直接書き換えさせない
  if (body.current_price !== undefined || body.price !== undefined || body.image_url !== undefined || body.imageUrl !== undefined) {
    throw new GuestError(
      400,
      'INVALID_INPUT',
      '価格と画像はサーバー取得のみです。エージェントからは変更できません',
    );
  }

  if (updates.length === 0) {
    throw new GuestError(400, 'INVALID_INPUT', '更新する項目がありません');
  }

  updates.push("updated_at = datetime('now')");
  values.push(itemId, auth.userId);
  const changed = db.prepare(
    `UPDATE items SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
  ).run(...values).changes;
  if (!changed) {
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  return getAgentItem(auth.userId, itemId, db);
}

export function purchaseAgentItem(
  auth: AgentAuthContext,
  itemId: number,
  body: Record<string, unknown> = {},
  db: Database.Database = getDb(),
): AgentItemView {
  const existing = getOwnedItemOrThrow(auth.userId, itemId, db);
  if (existing.deleted_at) {
    throw new GuestError(409, 'ITEM_TRASHED', 'ゴミ箱の品目は購入済みにできません');
  }
  const purchasedAt = body.purchased_at === undefined
    ? localCalendarDate(new Date(), 'Asia/Tokyo')
    : (normalizeOptionalDate(body.purchased_at, 'purchased_at') ?? localCalendarDate(new Date(), 'Asia/Tokyo'));

  const changed = db.prepare(`
    UPDATE items
    SET is_purchased = 1, purchased_at = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(purchasedAt, itemId, auth.userId).changes;
  if (!changed) {
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  return getAgentItem(auth.userId, itemId, db);
}

export function trashAgentItem(
  auth: AgentAuthContext,
  itemId: number,
  db: Database.Database = getDb(),
): AgentItemView {
  getOwnedItemOrThrow(auth.userId, itemId, db);
  const changed = db.prepare(`
    UPDATE items
    SET deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(itemId, auth.userId).changes;
  if (!changed) {
    // 既にゴミ箱でも所有者なら現状を返す（冪等）
    const current = getAgentItem(auth.userId, itemId, db);
    if (current.deleted_at) return current;
    throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
  }
  return getAgentItem(auth.userId, itemId, db);
}

export function listAgentCategories(userId: number, db: Database.Database = getDb()) {
  return db.prepare(`
    SELECT c.id, c.name, c.color, c.icon, c.sort_order, c.created_at,
      COUNT(i.id) AS item_count
    FROM categories c
    LEFT JOIN items i
      ON c.id = i.category_id AND i.user_id = c.user_id
      AND i.is_purchased = 0 AND i.deleted_at IS NULL
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `).all(userId);
}

export function getAgentPriceHistory(
  userId: number,
  itemId: number,
  db: Database.Database = getDb(),
) {
  getOwnedItemOrThrow(userId, itemId, db);
  return db.prepare(`
    SELECT id, item_id, price, recorded_at
    FROM price_history
    WHERE item_id = ?
    ORDER BY recorded_at ASC, id ASC
  `).all(itemId);
}

export function getAgentBudgetSummary(
  userId: number,
  month?: string | null,
  db: Database.Database = getDb(),
) {
  if (month != null && month !== '' && !/^\d{4}-\d{2}$/.test(month)) {
    throw new GuestError(400, 'INVALID_INPUT', 'month は YYYY-MM 形式です');
  }

  const decisions = photoSpendDecisions(...userSpendInput(db, userId));
  let query = `
    SELECT i.*, g.name AS comparison_group_name, g.origin AS group_origin,
      CASE WHEN g.origin = 'photo' THEN g.budget_item_id ELSE NULL END AS budget_selected_item_id
    FROM items i
    LEFT JOIN comparison_groups g ON g.id = i.comparison_group_id AND g.user_id = i.user_id
    WHERE i.is_purchased = 0
      AND i.user_id = ?
      AND i.deleted_at IS NULL
      AND i.planned_purchase_date IS NOT NULL
  `;
  const params: (string | number)[] = [userId];
  if (month) {
    query += ` AND strftime('%Y-%m', i.planned_purchase_date) = ?`;
    params.push(month);
  }
  query += ` ORDER BY i.planned_purchase_date ASC`;

  const dated = annotateSpend(db.prepare(query).all(...params) as Item[], decisions);
  const undated = annotateSpend(db.prepare(`
    SELECT i.*, g.name AS comparison_group_name, g.origin AS group_origin,
      CASE WHEN g.origin = 'photo' THEN g.budget_item_id ELSE NULL END AS budget_selected_item_id
    FROM items i
    LEFT JOIN comparison_groups g ON g.id = i.comparison_group_id AND g.user_id = i.user_id
    WHERE i.is_purchased = 0
      AND i.user_id = ?
      AND i.deleted_at IS NULL
      AND (i.planned_purchase_date IS NULL OR i.planned_purchase_date = '')
    ORDER BY i.priority ASC, i.created_at DESC
  `).all(userId) as Item[], decisions);

  const byMonth: Record<string, { total: number; item_count: number; item_ids: number[] }> = {};
  for (const item of dated) {
    if (!item.planned_purchase_date) continue;
    const key = item.planned_purchase_date.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = { total: 0, item_count: 0, item_ids: [] };
    const decision = decisions.get(item.id);
    const amount = decision ? decision.amount : (item.current_price || 0) * (item.quantity || 1);
    if (!decision || decision.countsInTotal) {
      byMonth[key].total += amount;
      byMonth[key].item_count += 1;
      byMonth[key].item_ids.push(item.id);
    }
  }

  let undatedTotal = 0;
  const undatedIds: number[] = [];
  for (const item of undated) {
    const decision = decisions.get(item.id);
    const amount = decision ? decision.amount : (item.current_price || 0) * (item.quantity || 1);
    if (!decision || decision.countsInTotal) {
      undatedTotal += amount;
      undatedIds.push(item.id);
    }
  }

  const monthsTotal = Object.values(byMonth).reduce((sum, entry) => sum + entry.total, 0);
  return {
    months: byMonth,
    undated: { total: undatedTotal, item_count: undatedIds.length, item_ids: undatedIds },
    grand_total: monthsTotal + undatedTotal,
  };
}
