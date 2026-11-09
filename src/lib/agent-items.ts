// エージェント REST / MCP 共通の品目操作。
// 新規登録の価格・画像は item-input のサーバ取得だけを使う。取得に失敗して空のままの
// current_price / image_url は、update_item / PATCH で一度だけ埋められる（#382）。

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AGENT_RATE_LIMITS } from '@/lib/agent-access-limits';
import { assertOwnedRelations } from '@/lib/api-access';
import { markItemAddedByAgent, type AgentAuthContext } from '@/lib/agent-token';
import { displayableItemImageUrl } from '@/lib/capture/image-hosts';
import { getDb } from '@/lib/db';
import { GuestError } from '@/lib/guest';
import { ITEM_URL_ERROR } from '@/lib/http-url';
import {
  activeUrlConflictMessage,
  fetchServerItemMedia,
  findCleanedStoredUrlRegistration,
  normalizeItemName,
  restoreTrashedItem,
  RESTORED_FROM_TRASH_MESSAGE,
  sanitizeStoredItemUrl,
  URL_IN_TRASH_MESSAGE,
  type FetchServerItemMediaOptions,
  type ServerItemMedia,
} from '@/lib/item-input';
import { isCalendarDate, localCalendarDate } from '@/lib/local-date';
import { BlockedTargetError, resolvedPublicAddress, type MemberFetchDeps } from '@/lib/member-fetch';
import { annotateSpend, photoSpendDecisions, userSpendInput } from '@/lib/photo-spend';
import { publicPageUrl } from '@/lib/public-page';
import type { Item } from '@/types';

export const AGENT_NOTES_MAX = 2000;

export type AgentItemStatus = 'active' | 'trashed' | 'purchased' | 'all';

/** 1商品に属する店ページ（写真グループの店行、または単独品目そのもの） */
export type AgentStoreView = {
  item_id: number;
  url: string;
  store: string;
  source: string;
  current_price: number | null;
  image_url: string | null;
  /** 直近のサーバ取得の結果（'failed' など）。未取得なら null */
  scrape_status: string | null;
  /** 取得失敗の理由。成功・未取得なら null */
  scrape_error: string | null;
};

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
  /**
   * 直近のサーバ取得の結果（'failed' など）と理由。取得に失敗して current_price / image_url が
   * null のとき、update_item / PATCH で埋めてよい（#382）。
   */
  scrape_status: string | null;
  scrape_error: string | null;
  /** 1商品としての店一覧（写真グループなら複数。単独は1件） */
  stores: AgentStoreView[];
};

/** 1回の呼び出しで受け付ける店 URL 上限。add_url の分あたり上限と同じ定数から取る。 */
export const MAX_AGENT_PRODUCT_URLS = AGENT_RATE_LIMITS.add_url;

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
    throw new GuestError(400, 'INVALID_INPUT', `${field} は YYYY-MM-DD 形式の実在する日付です（例: 2026-11-03）`);
  }
  if (!isCalendarDate(raw)) {
    throw new GuestError(
      400,
      'INVALID_INPUT',
      `${field} は実在する暦日にしてください（例: 2026-13-45 や 2026-02-30 は不可）`,
    );
  }
  return raw;
}

/** 新規登録の価格・画像はサーバ取得のみ。エージェントが値を付けてきたら分かりやすく拒否する。 */
function rejectAgentClientMediaFields(body: Record<string, unknown>): void {
  if (
    body.current_price !== undefined
    || body.image_url !== undefined
  ) {
    throw new GuestError(
      400,
      'INVALID_INPUT',
      '価格と画像はサーバー取得のみです。エージェントからは指定できません',
    );
  }
  rejectAgentMediaAliases(body);
}

/**
 * 価格・画像の別名（price / original_price / target_price / imageUrl）は、新規・更新のどちらでも受け付けない。
 * 更新で埋められる公式名は current_price と image_url だけ（#382）。
 */
function rejectAgentMediaAliases(body: Record<string, unknown>): void {
  if (
    body.price !== undefined
    || body.original_price !== undefined
    || body.target_price !== undefined
    || body.imageUrl !== undefined
  ) {
    throw new GuestError(
      400,
      'INVALID_INPUT',
      '価格と画像はサーバー取得のみです。エージェントからは指定できません',
    );
  }
}

const MANUAL_PRICE_HELP = 'current_price は 0 より大きい有限の数（円）です。取得済みの価格は変更できず、null で消すこともできません';
const MANUAL_IMAGE_HELP = 'image_url は公開されている画像の https URL です。取得済みの画像は変更できず、空にすることもできません';

/** 取得に失敗して空の品目へエージェントが埋める値。どちらも undefined なら媒体の更新なし。 */
export type AgentManualMedia = {
  price?: number;
  imageUrl?: string;
};

function normalizeManualPrice(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new GuestError(400, 'INVALID_INPUT', MANUAL_PRICE_HELP);
  }
  return raw;
}

/**
 * 画面の画像表示（displayableItemImageUrl）と同じ安全性に加え、公開ホストの https だけ通す。
 * data: / javascript: / http: / 認証情報・ポート付き / localhost や .local 等は 400。
 * 名前解決（私設アドレスの拒否）はここではせず、認証後に assertAgentPublicUrl で行う。
 */
function normalizeManualImageUrl(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new GuestError(400, 'INVALID_INPUT', MANUAL_IMAGE_HELP);
  }
  const value = raw.trim();
  const displayable = displayableItemImageUrl(value);
  let parsed: URL | null = null;
  try {
    parsed = publicPageUrl(value);
  } catch {
    parsed = null;
  }
  if (!displayable || displayable !== value || !parsed || parsed.protocol !== 'https:') {
    throw new GuestError(400, 'INVALID_INPUT', MANUAL_IMAGE_HELP);
  }
  return value;
}

/** update_item / PATCH の current_price / image_url を構文だけ検査する（ネットワークは使わない）。 */
function parseAgentManualMedia(body: Record<string, unknown>): AgentManualMedia {
  const manual: AgentManualMedia = {};
  if (body.current_price !== undefined) {
    manual.price = normalizeManualPrice(body.current_price);
  }
  if (body.image_url !== undefined) {
    manual.imageUrl = normalizeManualImageUrl(body.image_url);
  }
  return manual;
}

/**
 * 空のフィールドだけ埋められる。取得済み（または既に埋めた）値は 409 で守る。
 * 混在ボディ（メモ + 価格など）も、ここで拒否されれば何も書かない。
 */
function assertManualMediaFillable(row: Record<string, unknown>, manual: AgentManualMedia): void {
  const blocked: string[] = [];
  if (manual.price !== undefined && row.current_price != null) blocked.push('価格（current_price）');
  if (manual.imageUrl !== undefined && row.image_url != null) blocked.push('画像（image_url）');
  if (blocked.length > 0) {
    throw new GuestError(
      409,
      'MEDIA_ALREADY_SET',
      `${blocked.join('と')}は既に入っているため変更できません。空のときだけ埋められます`,
    );
  }
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

/**
 * add_item_by_url 用。`url` と `urls` をまとめて整形・重複除去する。
 * 呼び出し側の価格・画像はここでは見ない。
 */
export function parseAgentProductUrls(body: Record<string, unknown>): string[] {
  const collected: string[] = [];
  if (body.urls !== undefined) {
    if (!Array.isArray(body.urls)) {
      throw new GuestError(400, 'INVALID_INPUT', 'urls は配列で指定してください');
    }
    if (body.urls.length === 0) {
      throw new GuestError(400, 'INVALID_INPUT', 'urls は1件以上必要です');
    }
    if (body.urls.length > MAX_AGENT_PRODUCT_URLS) {
      throw new GuestError(400, 'INVALID_INPUT', `urls は${MAX_AGENT_PRODUCT_URLS}件までです`);
    }
    for (const entry of body.urls) {
      collected.push(requireHttpUrl(entry));
    }
  }
  if (body.url !== undefined && body.url !== null && body.url !== '') {
    collected.push(requireHttpUrl(body.url));
  }
  if (collected.length === 0) {
    throw new GuestError(400, 'INVALID_INPUT', 'URLは必須です');
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of collected) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  if (unique.length > MAX_AGENT_PRODUCT_URLS) {
    throw new GuestError(400, 'INVALID_INPUT', `urls は${MAX_AGENT_PRODUCT_URLS}件までです`);
  }
  return unique;
}

/**
 * 書き込みボディの共通検査（価格・画像の拒否または構文検査、日付の暦日チェック）。
 * レート消費・監査より前に呼ぶ。ネットワークは使わない。
 * allowManualMedia（update_item）では current_price / image_url の構文だけ見て、別名は拒否する。
 */
export function assertAgentWriteFields(
  body: Record<string, unknown>,
  options: { allowManualMedia?: boolean } = {},
): void {
  if (options.allowManualMedia) {
    rejectAgentMediaAliases(body);
    parseAgentManualMedia(body);
  } else {
    rejectAgentClientMediaFields(body);
  }
  if (body.planned_purchase_date !== undefined) {
    normalizeOptionalDate(body.planned_purchase_date, 'planned_purchase_date');
  }
  if (body.purchased_at !== undefined) {
    normalizeOptionalDate(body.purchased_at, 'purchased_at');
  }
}

/**
 * レート消費の前に、URL 件数と attach 先を検査する。
 * 上限超えは 400、手作業比較グループは 409。いずれもレートはまだ触らない。
 */
export function assertAgentUrlAddPreflight(
  userId: number,
  body: Record<string, unknown>,
  db: Database.Database = getDb(),
): { urls: string[]; units: number } {
  assertAgentWriteFields(body);
  const urls = parseAgentProductUrls(body);
  const attachId = body.item_id === undefined
    ? undefined
    : normalizeOptionalId(body.item_id, 'item_id');
  if (attachId === null) {
    throw new GuestError(400, 'INVALID_INPUT', 'item_id が不正です');
  }
  if (attachId !== undefined) {
    assertAgentAttachTarget(userId, attachId, db);
  }
  return { urls, units: urls.length };
}

/** 既存品目へ店を足せるか。手作業比較グループは拒否（写真グループへ勝手に移さない）。 */
export function assertAgentAttachTarget(
  userId: number,
  itemId: number,
  db: Database.Database = getDb(),
): { groupId: number | null; existing: Record<string, unknown> } {
  const existing = getOwnedItemOrThrow(userId, itemId, db);
  if (existing.deleted_at) {
    throw new GuestError(409, 'ITEM_TRASHED', 'ゴミ箱の品目には店を足せません。先に復元してください');
  }
  const existingGroupId = existing.comparison_group_id == null
    ? null
    : Number(existing.comparison_group_id);
  if (existingGroupId == null) {
    return { groupId: null, existing };
  }
  const group = db.prepare(
    'SELECT id, origin FROM comparison_groups WHERE id = ? AND user_id = ?',
  ).get(existingGroupId, userId) as { id: number; origin: string | null } | undefined;
  if (!group) {
    return { groupId: null, existing };
  }
  if (group.origin === 'photo') {
    return { groupId: group.id, existing };
  }
  throw new GuestError(
    409,
    'MANUAL_GROUP',
    '手作業の比較グループに入っている品目には店を足せません。グループから外してから再度追加してください',
  );
}

function storeLabel(source: string, sourceName: string | null | undefined): string {
  const named = typeof sourceName === 'string' ? sourceName.trim() : '';
  if (named) return named;
  if (source === 'yahoo') return 'Yahoo!ショッピング';
  if (source === 'rakuten') return '楽天';
  if (source === 'amazon') return 'Amazon';
  return source || 'その他';
}

function toStoreView(row: Record<string, unknown>): AgentStoreView {
  return {
    item_id: Number(row.id),
    url: String(row.url ?? ''),
    store: storeLabel(String(row.source ?? 'other'), row.source_name as string | null),
    source: String(row.source ?? 'other'),
    current_price: (row.current_price as number | null) ?? null,
    image_url: (row.image_url as string | null) ?? null,
    scrape_status: (row.scrape_status as string | null) ?? null,
    scrape_error: (row.scrape_error as string | null) ?? null,
  };
}

function photoGroupStores(
  db: Database.Database,
  userId: number,
  groupId: number,
): AgentStoreView[] {
  const rows = db.prepare(`
    SELECT id, url, source, source_name, current_price, image_url, scrape_status, scrape_error
    FROM items
    WHERE user_id = ? AND comparison_group_id = ? AND deleted_at IS NULL
    ORDER BY sort_order ASC, id ASC
  `).all(userId, groupId) as Record<string, unknown>[];
  return rows.map(toStoreView);
}

function storesForItemRow(
  db: Database.Database,
  userId: number,
  row: Record<string, unknown>,
): AgentStoreView[] {
  const groupId = row.comparison_group_id == null ? null : Number(row.comparison_group_id);
  if (groupId != null) {
    const group = db.prepare(
      'SELECT origin FROM comparison_groups WHERE id = ? AND user_id = ?',
    ).get(groupId, userId) as { origin: string | null } | undefined;
    if (group?.origin === 'photo') {
      const stores = photoGroupStores(db, userId, groupId);
      if (stores.length > 0) return stores;
    }
  }
  return [toStoreView(row)];
}

const PUBLIC_URL_HELP = '公開されている商品ページのHTTP(S) URLを指定してください';
const PUBLIC_IMAGE_HELP = '公開されている画像の https URL を指定してください。内部アドレスへ解決するホストは使えません';

/**
 * 保存前に SSRF ガード（publicPageUrl + 名前解決）。fetchPublicMember と同じ公開判定。
 * 名前解決を伴うので、認証・スコープ検査のあとに呼ぶ。
 */
export async function assertAgentPublicUrl(
  url: string,
  deps?: Pick<MemberFetchDeps, 'resolve'>,
  help: string = PUBLIC_URL_HELP,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = publicPageUrl(url);
  } catch {
    throw new GuestError(400, 'URL_BLOCKED', help);
  }
  try {
    await resolvedPublicAddress(parsed, deps?.resolve);
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      throw new GuestError(400, 'URL_BLOCKED', help);
    }
    throw new GuestError(400, 'URL_BLOCKED', help);
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
  db: Database.Database,
  userId: number,
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
    scrape_status: (row.scrape_status as string | null) ?? null,
    scrape_error: (row.scrape_error as string | null) ?? null,
    stores: storesForItemRow(db, userId, row),
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
  return { items: rows.map((row) => rowToView(row, dupes, db, userId)), total };
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
  return rowToView(row, duplicateCleanedUrls(db, userId), db, userId);
}

function assertUrlAvailableOrThrow(
  db: Database.Database,
  userId: number,
  url: string,
  allowTrashRestore: boolean,
  excludeItemId?: number,
): number | null {
  const state = findCleanedStoredUrlRegistration(db, userId, url, excludeItemId);
  if (state.kind === 'free') return null;
  if (state.kind === 'active') {
    throw new GuestError(409, 'URL_TAKEN', activeUrlConflictMessage(state.location));
  }
  if (!allowTrashRestore) {
    throw new GuestError(409, 'URL_IN_TRASH', URL_IN_TRASH_MESSAGE);
  }
  return state.match.id;
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
): { item: AgentItemView; restoredFromTrash: boolean } {
  const trashId = assertUrlAvailableOrThrow(db, auth.userId, input.url, true);
  if (trashId != null) {
    restoreTrashedItem(db, auth.userId, trashId);
    return { item: getAgentItem(auth.userId, trashId, db), restoredFromTrash: true };
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
    recordMediaFetchFailure(db, auth.userId, itemId, input.url, input.media);
    if (input.media.price != null) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, input.media.price);
    }
    markItemAddedByAgent(itemId, auth.token.id, auth.userId, db);
    return itemId;
  }).immediate();

  return { item: getAgentItem(auth.userId, result, db), restoredFromTrash: false };
}

type PreparedStore = {
  url: string;
  media: ServerItemMedia;
  scrapedName: string | null;
};

export type AgentMediaFetchError = { url: string; code: 'BOT_CHALLENGE' | 'FETCH_FAILED'; message: string };

function mediaFetchErrors(url: string, media: ServerItemMedia): AgentMediaFetchError[] {
  if (url.startsWith('manual://') || media.price != null || media.imageUrl != null) return [];
  return [{
    url,
    code: media.scraped?.failureCode ?? 'FETCH_FAILED',
    message: media.scraped?.note ?? '価格と画像を取得できませんでした。時間をおいて再試行するか、別の店のURLを使ってください。',
  }];
}

/**
 * 取得中に同じ URL がゴミ箱へ入り、insertAgentItem が新規ではなく復元した場合の応答。
 * 取得前の復元と同じ形にし、取得結果は保存しない（#364）。
 */
function restoredFromTrashResult(item: AgentItemView): {
  item: AgentItemView;
  media_fetched: boolean;
  media_fetch_errors: AgentMediaFetchError[];
  restored_from_trash: boolean;
  restore_message: string;
} {
  return {
    item,
    media_fetched: false,
    media_fetch_errors: [],
    restored_from_trash: true,
    restore_message: RESTORED_FROM_TRASH_MESSAGE,
  };
}

function recordMediaFetchFailure(db: Database.Database, userId: number, itemId: number, url: string, media: ServerItemMedia) {
  const failure = mediaFetchErrors(url, media)[0];
  if (failure) {
    db.prepare(`UPDATE items SET last_scraped_at = datetime('now'), scrape_status = 'failed', scrape_error = ?
      WHERE id = ? AND user_id = ?`).run(failure.message, itemId, userId);
  }
}

async function prepareStoreMedia(
  auth: AgentAuthContext,
  url: string,
  mediaOptions: FetchServerItemMediaOptions,
): Promise<PreparedStore> {
  await assertAgentPublicUrl(url, mediaOptions.deps);
  const media = await fetchServerItemMedia(url, {
    ...mediaOptions,
    accountType: 'member',
    userId: auth.userId,
  });
  rejectBlockedScrape(media);
  // 呼び出し側の price / image はここでは絶対に使わない
  const scrapedName = media.scraped && !media.scraped.name.includes('取得')
    ? normalizeItemName(media.scraped.name)
    : null;
  return {
    url,
    media: {
      ...media,
      price: media.price,
      imageUrl: media.imageUrl,
    },
    scrapedName,
  };
}

function createPhotoComparisonGroup(
  db: Database.Database,
  userId: number,
  name: string,
  priority: number,
): number {
  return Number(db.prepare(`
    INSERT INTO comparison_groups (user_id, name, priority, origin, capture_id, budget_item_id)
    VALUES (?, ?, ?, 'photo', NULL, NULL)
  `).run(userId, name, priority).lastInsertRowid);
}

function syncProductFieldsOnGroup(
  db: Database.Database,
  userId: number,
  groupId: number,
  fields: {
    name: string;
    priority: number;
    quantity: number;
    notes: string | null;
    planned_purchase_date: string | null;
    category_id: number | null;
  },
): void {
  db.prepare(`
    UPDATE items
    SET name = ?, priority = ?, quantity = ?, notes = ?,
      planned_purchase_date = ?, category_id = ?, updated_at = datetime('now')
    WHERE user_id = ? AND comparison_group_id = ? AND deleted_at IS NULL
  `).run(
    fields.name,
    fields.priority,
    fields.quantity,
    fields.notes,
    fields.planned_purchase_date,
    fields.category_id,
    userId,
    groupId,
  );
  db.prepare(`
    UPDATE comparison_groups SET name = ?, priority = ? WHERE id = ? AND user_id = ?
  `).run(fields.name, fields.priority, groupId, userId);
}

function nextSortOrder(db: Database.Database, userId: number, groupId: number): number {
  const row = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) AS max_order
    FROM items WHERE user_id = ? AND comparison_group_id = ?
  `).get(userId, groupId) as { max_order: number };
  return Number(row.max_order) + 1;
}

/**
 * URL 1本・既存品目なし → 従来どおり単独品目。
 * URL 2本以上、または既存品目へ店を足す → origin='photo' のグループにまとめる。
 */
export async function addAgentItemByUrl(
  auth: AgentAuthContext,
  body: Record<string, unknown>,
  mediaOptions: FetchServerItemMediaOptions = {},
  db: Database.Database = getDb(),
): Promise<{
  item: AgentItemView;
  stores: AgentStoreView[];
  media_fetched: boolean;
  media_fetch_errors: AgentMediaFetchError[];
  restored_from_trash?: boolean;
  restore_message?: string;
}> {
  rejectAgentClientMediaFields(body);
  const urls = parseAgentProductUrls(body);
  const attachId = body.item_id === undefined
    ? undefined
    : normalizeOptionalId(body.item_id, 'item_id');
  if (attachId === null) {
    throw new GuestError(400, 'INVALID_INPUT', 'item_id が不正です');
  }

  const nameFromInput = body.name === undefined || body.name === null
    ? null
    : normalizeItemName(String(body.name));
  if (body.name != null && nameFromInput === null) {
    throw new GuestError(400, 'INVALID_INPUT', '商品名を入力してください');
  }

  // 従来互換: URL 1本・既存指定なしはグループを作らない。
  // ゴミ箱のみの一致は Web/拡張と同じく scrape より先に復元する（#365 / Bugbot）。
  if (urls.length === 1 && attachId === undefined) {
    const singleUrl = urls[0];
    const trashId = assertUrlAvailableOrThrow(db, auth.userId, singleUrl, true);
    if (trashId != null) {
      restoreTrashedItem(db, auth.userId, trashId);
      const item = getAgentItem(auth.userId, trashId, db);
      return {
        item,
        stores: item.stores,
        media_fetched: false,
        media_fetch_errors: [],
        restored_from_trash: true,
        restore_message: RESTORED_FROM_TRASH_MESSAGE,
      };
    }

    const prepared = await prepareStoreMedia(auth, singleUrl, mediaOptions);
    const name = nameFromInput ?? prepared.scrapedName;
    if (!name) {
      throw new GuestError(
        422,
        'NAME_REQUIRED',
        `${prepared.media.scraped?.note ? `${prepared.media.scraped.note} ` : ''}商品名を取得できませんでした。name を指定して再度追加してください`,
      );
    }
    const inserted = insertAgentItem(auth, {
      name,
      url: prepared.url,
      media: prepared.media,
      priority: normalizePriority(body.priority),
      quantity: normalizeQuantity(body.quantity),
      notes: normalizeNotes(body.notes),
      planned_purchase_date: normalizeOptionalDate(body.planned_purchase_date, 'planned_purchase_date') ?? null,
      category_id: normalizeOptionalId(body.category_id, 'category_id') ?? null,
      comparison_group_id: normalizeOptionalId(body.comparison_group_id, 'comparison_group_id') ?? null,
    }, db);
    if (inserted.restoredFromTrash) {
      return { ...restoredFromTrashResult(inserted.item), stores: inserted.item.stores };
    }
    return {
      item: inserted.item,
      stores: inserted.item.stores,
      media_fetched: prepared.media.price != null || prepared.media.imageUrl != null,
      media_fetch_errors: mediaFetchErrors(prepared.url, prepared.media),
    };
  }

  let existing: Record<string, unknown> | null = null;
  let groupId: number | null = null;
  if (attachId !== undefined) {
    // 手作業比較グループは 409（写真グループへ移さない）
    const attach = assertAgentAttachTarget(auth.userId, attachId, db);
    existing = attach.existing;
    groupId = attach.groupId;
  }

  const preparedList: PreparedStore[] = [];
  for (const url of urls) {
    // 複数店・既存への店追加では自動復元しない（マージが曖昧なため）
    assertUrlAvailableOrThrow(db, auth.userId, url, false);
    preparedList.push(await prepareStoreMedia(auth, url, mediaOptions));
  }

  const priority = body.priority !== undefined
    ? normalizePriority(body.priority)
    : (existing ? Number(existing.priority) || 3 : 3);
  const quantity = body.quantity !== undefined
    ? normalizeQuantity(body.quantity)
    : (existing ? Number(existing.quantity) || 1 : 1);
  const notes = body.notes !== undefined
    ? normalizeNotes(body.notes)
    : (existing ? ((existing.notes as string | null) ?? null) : null);
  const planned = body.planned_purchase_date !== undefined
    ? (normalizeOptionalDate(body.planned_purchase_date, 'planned_purchase_date') ?? null)
    : (existing ? ((existing.planned_purchase_date as string | null) ?? null) : null);
  const categoryId = body.category_id !== undefined
    ? (normalizeOptionalId(body.category_id, 'category_id') ?? null)
    : (existing ? ((existing.category_id as number | null) ?? null) : null);

  let productName = nameFromInput;
  if (!productName && existing) {
    productName = normalizeItemName(String(existing.name ?? '')) ?? String(existing.name ?? '');
  }
  if (!productName) {
    for (const prepared of preparedList) {
      if (prepared.scrapedName) {
        productName = prepared.scrapedName;
        break;
      }
    }
  }

  const savable = preparedList.filter((prepared) => productName || prepared.scrapedName);
  if (!productName && savable.length === 0) {
    throw new GuestError(
      422,
      'NAME_REQUIRED',
      `${preparedList.find(entry => entry.media.scraped?.note)?.media.scraped?.note ?? ''} 商品名を取得できませんでした。name を指定して再度追加してください`.trim(),
    );
  }
  if (!productName) {
    productName = savable[0].scrapedName as string;
  }

  // 名前が無い店は保存しない（商品名が取れていれば商品名で埋める）
  const toInsert = preparedList.filter((prepared) => Boolean(productName || prepared.scrapedName));
  if (toInsert.length === 0) {
    throw new GuestError(
      422,
      'NAME_REQUIRED',
      '商品名を取得できませんでした。name を指定して再度追加してください',
    );
  }

  assertOwnedRelations(db, auth.userId, { category_id: categoryId });

  const faceId = db.transaction(() => {
    let targetGroupId = groupId;
    if (targetGroupId == null) {
      targetGroupId = createPhotoComparisonGroup(db, auth.userId, productName as string, priority);
      if (existing) {
        db.prepare(`
          UPDATE items
          SET comparison_group_id = ?, name = ?, priority = ?, quantity = ?, notes = ?,
            planned_purchase_date = ?, category_id = ?, sort_order = 0,
            updated_at = datetime('now')
          WHERE id = ? AND user_id = ?
        `).run(
          targetGroupId,
          productName,
          priority,
          quantity,
          notes,
          planned,
          categoryId,
          Number(existing.id),
          auth.userId,
        );
      }
    } else {
      syncProductFieldsOnGroup(db, auth.userId, targetGroupId, {
        name: productName as string,
        priority,
        quantity,
        notes,
        planned_purchase_date: planned,
        category_id: categoryId,
      });
    }

    let sortOrder = nextSortOrder(db, auth.userId, targetGroupId);
    let firstNewId: number | null = null;
    for (const prepared of toInsert) {
      assertUrlAvailableOrThrow(db, auth.userId, prepared.url, false);
      const inserted = db.prepare(`
        INSERT INTO items (
          user_id, name, url, image_url, current_price, original_price,
          source, source_name, priority, planned_purchase_date,
          comparison_group_id, category_id, notes, quantity, sort_order, added_by_agent_token_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auth.userId,
        productName,
        prepared.url,
        prepared.media.imageUrl,
        prepared.media.price,
        prepared.media.price,
        prepared.media.source,
        prepared.media.sourceName,
        priority,
        planned,
        targetGroupId,
        categoryId,
        notes,
        quantity,
        sortOrder,
        auth.token.id,
      );
      const itemId = Number(inserted.lastInsertRowid);
      recordMediaFetchFailure(db, auth.userId, itemId, prepared.url, prepared.media);
      if (prepared.media.price != null) {
        db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, prepared.media.price);
      }
      markItemAddedByAgent(itemId, auth.token.id, auth.userId, db);
      if (firstNewId == null) firstNewId = itemId;
      sortOrder += 1;
    }

    return firstNewId ?? (existing ? Number(existing.id) : null);
  }).immediate();

  if (faceId == null) {
    throw new GuestError(500, 'SAVE_FAILED', '商品を保存できませんでした');
  }

  const item = getAgentItem(auth.userId, faceId, db);
  const mediaFetched = toInsert.some(
    (prepared) => prepared.media.price != null || prepared.media.imageUrl != null,
  );
  return {
    item, stores: item.stores, media_fetched: mediaFetched,
    media_fetch_errors: toInsert.flatMap(prepared => mediaFetchErrors(prepared.url, prepared.media)),
  };
}

export async function addAgentItem(
  auth: AgentAuthContext,
  body: Record<string, unknown>,
  mediaOptions: FetchServerItemMediaOptions = {},
  db: Database.Database = getDb(),
): Promise<{
  item: AgentItemView;
  media_fetched: boolean;
  media_fetch_errors: AgentMediaFetchError[];
  restored_from_trash?: boolean;
  restore_message?: string;
}> {
  rejectAgentClientMediaFields(body);
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

  // ゴミ箱のみの一致は scrape より先に復元する（#365 / Bugbot）
  if (!url.startsWith('manual://')) {
    const trashId = assertUrlAvailableOrThrow(db, auth.userId, url, true);
    if (trashId != null) {
      restoreTrashedItem(db, auth.userId, trashId);
      const item = getAgentItem(auth.userId, trashId, db);
      return {
        item,
        media_fetched: false,
        media_fetch_errors: [],
        restored_from_trash: true,
        restore_message: RESTORED_FROM_TRASH_MESSAGE,
      };
    }
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
  const inserted = insertAgentItem(auth, {
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

  if (inserted.restoredFromTrash) {
    return restoredFromTrashResult(inserted.item);
  }
  return {
    item: inserted.item,
    media_fetched: mediaFetched,
    media_fetch_errors: mediaFetchErrors(url, media),
  };
}

export type UpdateAgentItemOptions = {
  /** 画像ホストの名前解決の差し替え（テスト用）。省略時は dns.lookup */
  deps?: Pick<MemberFetchDeps, 'resolve'>;
};

const ITEM_TRASHED_UPDATE_MESSAGE = 'ゴミ箱の品目は更新できません。先に復元してください';

/**
 * 名前・メモ・優先度・数量・予定日・カテゴリ・比較グループ・URL に加え、
 * サーバ取得に失敗して空のままの current_price / image_url を一度だけ埋める（#382）。
 *
 * 順序: 別名の拒否と媒体の構文検査（400）→ 所有・ゴミ箱（404 / 409）→ 他フィールドの検査（400）
 * → 空でない媒体の拒否（409）→ 画像ホストの名前解決（認証後。400 URL_BLOCKED）
 * → 書き込みトランザクションで状態を読み直し、全フィールドを一括更新。
 * 名前解決の間にゴミ箱へ入る・別の書き手が価格を入れる競合は、トランザクション内の再検査で丸ごと拒否する。
 */
export async function updateAgentItem(
  auth: AgentAuthContext,
  itemId: number,
  body: Record<string, unknown>,
  db: Database.Database = getDb(),
  options: UpdateAgentItemOptions = {},
): Promise<AgentItemView> {
  // 別名（price / original_price / target_price / imageUrl）は常に拒否。公式名は構文だけ先に見る。
  rejectAgentMediaAliases(body);
  const manual = parseAgentManualMedia(body);

  const existing = getOwnedItemOrThrow(auth.userId, itemId, db);
  if (existing.deleted_at) {
    throw new GuestError(409, 'ITEM_TRASHED', ITEM_TRASHED_UPDATE_MESSAGE);
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

  let newUrl: string | undefined;
  if (body.url !== undefined) {
    const currentUrl = String(existing.url);
    if (typeof body.url === 'string' && body.url === currentUrl) {
      // 未変更。#275 と同じく整形しない
    } else {
      const cleaned = requireHttpUrl(body.url);
      if (cleaned !== currentUrl) {
        // 更新時は他品目のゴミ箱 URL も使えない（別品目を巻き込むため）
        assertUrlAvailableOrThrow(db, auth.userId, cleaned, false, itemId);
      }
      newUrl = cleaned;
      updates.push('url = ?', 'source_item_code = NULL', 'price_fetched_at = NULL');
      values.push(cleaned);
    }
  }

  // 価格・画像は空のフィールドだけ埋める。取得済みの値はクライアント値で壊さない（#336 / #382）。
  assertManualMediaFillable(existing, manual);
  const guards: string[] = [];
  if (manual.price !== undefined) {
    updates.push('current_price = ?');
    values.push(manual.price);
    guards.push('current_price IS NULL');
  }
  if (manual.imageUrl !== undefined) {
    updates.push('image_url = ?');
    values.push(manual.imageUrl);
    guards.push('image_url IS NULL');
  }

  if (updates.length === 0) {
    throw new GuestError(400, 'INVALID_INPUT', '更新する項目がありません');
  }

  // 名前解決はここだけ。認証・スコープ・入力検査を通ったあとに行う。
  if (manual.imageUrl !== undefined) {
    await assertAgentPublicUrl(manual.imageUrl, options.deps, PUBLIC_IMAGE_HELP);
  }

  updates.push("updated_at = datetime('now')");
  const sql = `UPDATE items SET ${updates.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL${
    guards.length ? ` AND ${guards.join(' AND ')}` : ''
  }`;

  db.transaction(() => {
    // 名前解決の間に状態が変わっていないか、書き込みロックの中で読み直す。
    const row = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(itemId, auth.userId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new GuestError(404, 'ITEM_NOT_FOUND', '品目が見つかりません');
    }
    if (row.deleted_at) {
      throw new GuestError(409, 'ITEM_TRASHED', ITEM_TRASHED_UPDATE_MESSAGE);
    }
    assertManualMediaFillable(row, manual);
    if (newUrl !== undefined && newUrl !== String(row.url)) {
      assertUrlAvailableOrThrow(db, auth.userId, newUrl, false, itemId);
    }
    const changed = db.prepare(sql).run(...values, itemId, auth.userId).changes;
    if (!changed) {
      // 再検査を通った直後なので通常は来ない。来たら何も書かずに止める。
      throw new GuestError(409, 'MEDIA_ALREADY_SET', '品目の状態が変わったため更新しませんでした。取り直してから再度お試しください');
    }
    if (manual.price !== undefined) {
      db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, manual.price);
    }
  }).immediate();

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
