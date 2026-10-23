// 選んだ候補の表のIDだけを受け取り、保存済みの行から登録する。ページは取りに行かない。
// 新しい候補が1件のときは比較グループを作らない。2件以上のときだけ1つの比較グループにする。
import type Database from 'better-sqlite3';
import { CaptureMessages, isAllowedCandidateUrl, type CaptureSite } from './contract';
import { canonicalCandidateImageUrl } from './image-hosts';

export const ALREADY_REGISTERED_LABEL = '登録済み' as const;

const MAX_CANDIDATES = 20;
const MEMBER_ONLY = 'この機能はログイン後に利用できます';
const CANDIDATE_MISSING = '候補が見つかりません';

export type CandidateChoice =
  | { selectable: true; label: null }
  | { selectable: false; label: typeof ALREADY_REGISTERED_LABEL };

export type SkippedCandidate = {
  candidateId: number;
  code: 'ALREADY_REGISTERED';
  error: typeof ALREADY_REGISTERED_LABEL;
};

export type RegisterFailure = {
  ok: false;
  status: number;
  error: { code: string; error: string; skipped?: SkippedCandidate[] };
};

export type RegisterCaptureResult =
  | {
      ok: true;
      created: boolean;
      comparisonGroupId: number | null;
      itemIds: number[];
      skipped: SkippedCandidate[];
    }
  | RegisterFailure;

type CandidateRow = {
  id: number;
  user_id: number;
  capture_id: number;
  source: string;
  name: string;
  url: string;
  image_url: string | null;
  price: number | null;
  source_item_code: string | null;
  price_fetched_at: string | null;
  expires_at: number;
};

const SOURCE_LABEL: Record<CaptureSite, string> = {
  yahoo: 'Yahoo!ショッピング',
  rakuten: '楽天',
};

export function candidateRegistration(db: Database.Database, userId: number, url: string): CandidateChoice {
  const existing = db.prepare('SELECT id FROM items WHERE user_id = ? AND url = ? LIMIT 1').get(userId, url);
  if (existing) return { selectable: false, label: ALREADY_REGISTERED_LABEL };
  return { selectable: true, label: null };
}

export function listCaptureCandidateChoices(
  db: Database.Database,
  userId: number,
  captureId: number,
  now = Date.now(),
): { id: number; selectable: boolean; label: typeof ALREADY_REGISTERED_LABEL | null }[] {
  const rows = db.prepare(
    `SELECT id, url FROM capture_candidates
     WHERE user_id = ? AND capture_id = ? AND expires_at > ?
     ORDER BY id`,
  ).all(userId, captureId, now) as { id: number; url: string }[];
  return rows.map((row) => {
    const choice = candidateRegistration(db, userId, row.url);
    return { id: row.id, selectable: choice.selectable, label: choice.label };
  });
}

export function registerCapturedCandidates(
  db: Database.Database,
  userId: number,
  candidateIds: unknown,
  now = Date.now(),
): RegisterCaptureResult {
  const parsed = parseStoredCandidateIds(candidateIds);
  if (!parsed.ok) return parsed;
  const user = db.prepare('SELECT account_type FROM users WHERE id = ?').get(userId) as { account_type: string } | undefined;
  if (!user || user.account_type !== 'member') {
    return { ok: false, status: 403, error: { code: 'INVALID_INPUT', error: MEMBER_ONLY } };
  }

  const run = db.transaction(() => registerLocked(db, userId, parsed.ids, now));
  return run.immediate();
}

function registerLocked(db: Database.Database, userId: number, ids: number[], now: number): RegisterCaptureResult {
  const loaded = loadOwnedCandidates(db, userId, ids);
  if (!loaded.ok) return loaded;
  const captureIds = new Set(loaded.rows.map((row) => row.capture_id));
  if (captureIds.size !== 1) return invalid();

  const captureId = loaded.rows[0].capture_id;
  const capture = db.prepare(
    'SELECT id, estimated_name, comparison_group_id, status, registered_item_id FROM captures WHERE id = ? AND user_id = ?',
  ).get(captureId, userId) as {
    id: number;
    estimated_name: string | null;
    comparison_group_id: number | null;
    status: string;
    registered_item_id: number | null;
  } | undefined;
  if (!capture) return missing();
  if (capture.comparison_group_id != null) {
    return {
      ok: true,
      created: false,
      comparisonGroupId: capture.comparison_group_id,
      itemIds: groupItemIds(db, userId, capture.comparison_group_id),
      skipped: [],
    };
  }
  if (capture.status === 'registered') {
    return {
      ok: true,
      created: false,
      comparisonGroupId: null,
      itemIds: plainItemIds(db, userId, capture.id, capture.registered_item_id),
      skipped: [],
    };
  }

  for (const row of loaded.rows) {
    if (row.expires_at <= now || !isCaptureSite(row.source) || !isAllowedCandidateUrl(row.source, row.url)) return missing();
  }

  const skipped: SkippedCandidate[] = [];
  const fresh: CandidateRow[] = [];
  const seen = new Set<string>();
  for (const row of loaded.rows) {
    if (seen.has(row.url) || !candidateRegistration(db, userId, row.url).selectable) {
      skipped.push({ candidateId: row.id, code: 'ALREADY_REGISTERED', error: ALREADY_REGISTERED_LABEL });
      continue;
    }
    seen.add(row.url);
    fresh.push(row);
  }
  if (fresh.length === 0) {
    return {
      ok: false,
      status: 409,
      error: { code: 'ALREADY_REGISTERED', error: ALREADY_REGISTERED_LABEL, skipped },
    };
  }

  if (fresh.length === 1) {
    const itemId = insertCandidate(db, userId, fresh[0], null, 0);
    const linked = db.prepare(
      `UPDATE captures
       SET status = 'registered', registered_item_id = ?
       WHERE id = ? AND user_id = ? AND comparison_group_id IS NULL AND status != 'registered'`,
    ).run(itemId, capture.id, userId);
    if (linked.changes !== 1) {
      throw new Error('capture was already registered');
    }
    return { ok: true, created: true, comparisonGroupId: null, itemIds: [itemId], skipped };
  }

  const groupName = plainName(capture.estimated_name, plainName(fresh[0].name, '商品'));
  const groupId = Number(db.prepare(
    `INSERT INTO comparison_groups (user_id, name, priority, origin, capture_id, budget_item_id)
     VALUES (?, ?, 3, 'photo', ?, NULL)`,
  ).run(userId, groupName, capture.id).lastInsertRowid);

  const itemIds = fresh.map((row, index) => insertCandidate(db, userId, row, groupId, index));

  const linked = db.prepare(
    `UPDATE captures
     SET comparison_group_id = ?, status = 'registered'
     WHERE id = ? AND user_id = ? AND comparison_group_id IS NULL`,
  ).run(groupId, capture.id, userId);
  if (linked.changes !== 1) {
    throw new Error('capture group was already registered');
  }
  return { ok: true, created: true, comparisonGroupId: groupId, itemIds, skipped };
}

function loadOwnedCandidates(
  db: Database.Database,
  userId: number,
  ids: number[],
): { ok: true; rows: CandidateRow[] } | RegisterFailure {
  const rows: CandidateRow[] = [];
  const select = db.prepare(
    `SELECT id, user_id, capture_id, source, name, url, image_url, price, source_item_code, price_fetched_at, expires_at
     FROM capture_candidates WHERE id = ?`,
  );
  for (const id of ids) {
    const row = select.get(id) as CandidateRow | undefined;
    if (!row || row.user_id !== userId) return missing();
    rows.push(row);
  }
  return { ok: true, rows };
}

function insertCandidate(
  db: Database.Database,
  userId: number,
  row: CandidateRow,
  groupId: number | null,
  sortOrder: number,
): number {
  const site = row.source as CaptureSite;
  const price = usablePrice(row.price);
  const itemId = Number(db.prepare(
    `INSERT INTO items (
      user_id, name, url, image_url, current_price, original_price, source, source_name,
      source_item_code, price_fetched_at, priority, quantity, comparison_group_id, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, 1, ?, ?)`,
  ).run(
    userId,
    plainName(row.name, '商品'),
    row.url,
    storedImage(site, row.image_url),
    price,
    price,
    site,
    SOURCE_LABEL[site],
    itemCode(site, row.id, row.source_item_code),
    storedFetchedAt(row.price_fetched_at),
    groupId,
    sortOrder,
  ).lastInsertRowid);
  if (price != null) {
    db.prepare('INSERT INTO price_history (item_id, price) VALUES (?, ?)').run(itemId, price);
  }
  return itemId;
}

function plainItemIds(
  db: Database.Database,
  userId: number,
  captureId: number,
  registeredItemId: number | null,
): number[] {
  if (registeredItemId != null) {
    const row = db.prepare('SELECT id FROM items WHERE id = ? AND user_id = ?').get(registeredItemId, userId) as { id: number } | undefined;
    return row ? [row.id] : [];
  }
  // 商品 id を残す前の行は、候補 URL に一致する商品が1件のときだけそれを返す。
  const matched = (db.prepare(
    `SELECT id FROM items
     WHERE user_id = ?
       AND url IN (SELECT url FROM capture_candidates WHERE user_id = ? AND capture_id = ?)
     ORDER BY id`,
  ).all(userId, userId, captureId) as { id: number }[]).map((row) => row.id);
  return matched.length === 1 ? matched : [];
}

function groupItemIds(db: Database.Database, userId: number, groupId: number): number[] {
  return (db.prepare(
    'SELECT id FROM items WHERE user_id = ? AND comparison_group_id = ? ORDER BY sort_order, id',
  ).all(userId, groupId) as { id: number }[]).map((row) => row.id);
}

function parseStoredCandidateIds(input: unknown): { ok: true; ids: number[] } | RegisterFailure {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CANDIDATES) return invalid();
  const ids: number[] = [];
  for (const value of input) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid();
    ids.push(value);
  }
  if (new Set(ids).size !== ids.length) return invalid();
  return { ok: true, ids };
}

function invalid(): RegisterFailure {
  return { ok: false, status: 400, error: { code: 'INVALID_INPUT', error: CaptureMessages.registerInput } };
}

function missing(): RegisterFailure {
  return { ok: false, status: 404, error: { code: 'CANDIDATE_NOT_FOUND', error: CANDIDATE_MISSING } };
}

function isCaptureSite(source: string): source is CaptureSite {
  return source === 'yahoo' || source === 'rakuten';
}

function usablePrice(price: number | null): number | null {
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0) return null;
  return price;
}

function storedImage(site: CaptureSite, image: string | null): string | null {
  if (!image) return null;
  return canonicalCandidateImageUrl(site, image);
}

function itemCode(site: CaptureSite, id: number, stored: string | null): string {
  if (stored && stored.length <= 200 && !/[\u0000-\u0020]/.test(stored) && stored.startsWith(`${site}:`)) return stored;
  return `${site}:${id}`;
}

function storedFetchedAt(value: string | null): string | null {
  if (!value || value.length > 40 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (!/^[\d:+TZ. -]{1,40}$/.test(value)) return null;
  return value;
}

function plainName(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned || fallback;
}
