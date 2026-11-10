// MCP save_comparison_candidates（#388）。
// 買い物相談で比較中の「異なる商品」を、新規の商品 URL と登録済みの品目 ID の混在で受け取り、
// 1 回の呼び出しで同じ手作業比較グループ（origin = NULL）へ入れる。各候補は独立した商品のまま。
//
// 決めたこと:
// - 外部取得はトランザクションの外。DB への書き込みは 1 つの immediate トランザクションだけで、
//   その中で候補の状態を読み直す。取得の前に見た状態と違っていれば 409 で何も書かない
//   （別のグループや新しいグループへ書き先をすり替えない）。
// - 指定された名前のグループだけを使う。候補が入っている手作業比較グループの名前が要求の名前と
//   同じときだけそこへ足し、違えば 409。名前が同じだけの無関係なグループは探さない。
// - 同じ要求の再送は、まず操作ログの保存記録（要求の指紋）で判定する（表を足さない）。記録の
//   グループと品目 ID がそのまま残っていれば何も書かずに結果を返し、利用者がその後に外した・
//   移した・消したなら 409 で何も書かない（手作業の変更を再送で巻き戻さない）。
// - 既存の商品は移動も復元もしない。ゴミ箱・購入済み・同じ商品の店舗比較（photo）の行、
//   別々の手作業比較グループにいる候補同士、同じ URL の行が複数あって決められない候補は拒否する。
// - write だけのトークンには、ID と操作の結果だけを返す。名前・URL・価格・件数は read があるときだけ。
// - 新規登録の取得・保存・失敗の記録は、add_item_by_url と同じ関数を使う。

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  createAgentComparisonGroup,
  normalizeComparisonGroupName,
} from '@/lib/agent-comparison-groups';
import {
  MAX_AGENT_PRODUCT_URLS,
  agentScrapeFailure,
  getOwnedItemOrThrow,
  insertAgentItem,
  mediaFetchErrors,
  prepareStoreMedia,
  requireHttpUrl,
  type AgentMediaFetchError,
  type PreparedStore,
} from '@/lib/agent-items';
import { recordAgentAudit, type AgentAuthContext, type AgentRateKind } from '@/lib/agent-token';
import { getDb } from '@/lib/db';
import { GuestError } from '@/lib/guest';
import {
  findCleanedStoredUrlMatches,
  findCleanedStoredUrlRegistration,
  normalizeItemName,
  URL_IN_TRASH_MESSAGE,
  type FetchServerItemMediaOptions,
} from '@/lib/item-input';

/** 1 回で受け付ける候補の上限。新規 URL の取得件数が add_url の分あたり上限を超えないようにそろえる。 */
export const MAX_COMPARISON_CANDIDATES = MAX_AGENT_PRODUCT_URLS;
export const MIN_COMPARISON_CANDIDATES = 2;
export const COMPARISON_CANDIDATES_AUDIT_ACTION = 'comparison_candidates.save';

const NOTHING_SAVED = '何も保存・変更していません。';

export type ComparisonCandidateInput =
  | { kind: 'url'; position: number; url: string; name: string | null }
  | { kind: 'item'; position: number; itemId: number };

export type ComparisonCandidatesRequest = {
  name: string;
  candidates: ComparisonCandidateInput[];
};

export type ComparisonCandidateResult = 'created' | 'added_to_group' | 'already_in_group';

export type SavedComparisonCandidate = {
  /** 要求の candidates 内の位置（1 始まり） */
  position: number;
  item_id: number;
  /** この呼び出しでその候補に起きたこと */
  result: ComparisonCandidateResult;
  /** name / url / current_price は、トークンに read があるときだけ返す */
  name?: string;
  url?: string;
  current_price?: number | null;
};

export type SaveComparisonCandidatesResult = {
  status: 'saved' | 'already_saved';
  /** この呼び出しが保存済みの状態を変えたか */
  changed: boolean;
  /** 同じ要求が以前に保存済みで、その結果を返しているか */
  replayed: boolean;
  message: string;
  /** name / item_count は、トークンに read があるときだけ返す */
  group: { id: number; origin: null; created: boolean; name?: string; item_count?: number };
  candidates: SavedComparisonCandidate[];
  item_ids: number[];
  media_fetch_errors: AgentMediaFetchError[];
  replay_of?: {
    saved_at: string;
    group_created: boolean;
    candidates: { position: number; item_id: number; result: ComparisonCandidateResult }[];
  };
};

function refuse(status: number, code: string, message: string, position?: number): GuestError {
  return new GuestError(status, code, `${position ? `候補${position}: ` : ''}${message} ${NOTHING_SAVED}`);
}

/** 既存の検査が投げたエラーに、候補の位置と「何も保存していない」ことを足す。 */
function atPosition(error: unknown, position: number): unknown {
  if (!(error instanceof GuestError)) return error;
  return new GuestError(error.status, error.code, `候補${position}: ${error.message} ${NOTHING_SAVED}`, error.retryAfter);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 引数の構文検査（DB も通信も使わない）。宣言したキーだけを受け、所有者・origin・価格・画像は受け取らない。
 * 候補は「url（新規または既登録の商品ページ）」か「item_id（登録済みの品目）」のどちらか一方。
 */
export function parseComparisonCandidatesInput(body: Record<string, unknown>): ComparisonCandidatesRequest {
  for (const key of Object.keys(body)) {
    if (key !== 'name' && key !== 'candidates') {
      throw refuse(400, 'INVALID_INPUT', `指定できるのは name と candidates だけです（${key} は受け付けません）。`);
    }
  }
  let name: string;
  try {
    name = normalizeComparisonGroupName(body.name);
  } catch (error) {
    if (error instanceof GuestError) throw refuse(error.status, error.code, `${error.message}。`);
    throw error;
  }
  if (!Array.isArray(body.candidates)) {
    throw refuse(400, 'INVALID_INPUT', 'candidates は配列で指定してください。');
  }
  if (body.candidates.length < MIN_COMPARISON_CANDIDATES) {
    throw refuse(
      400,
      'INVALID_INPUT',
      `candidates には異なる商品を${MIN_COMPARISON_CANDIDATES}件以上指定してください。1件だけ登録するなら add_item_by_url を使います。`,
    );
  }
  if (body.candidates.length > MAX_COMPARISON_CANDIDATES) {
    throw refuse(400, 'INVALID_INPUT', `candidates は${MAX_COMPARISON_CANDIDATES}件までです。`);
  }

  const candidates: ComparisonCandidateInput[] = [];
  const seenUrls = new Set<string>();
  const seenIds = new Set<number>();
  body.candidates.forEach((entry, index) => {
    const position = index + 1;
    if (!isPlainObject(entry)) {
      throw refuse(400, 'INVALID_INPUT', '{"url": "…"} か {"item_id": 123} の形で指定してください。', position);
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'url' && key !== 'item_id' && key !== 'name') {
        throw refuse(
          400,
          'INVALID_INPUT',
          `指定できるのは url / item_id / name だけです（${key} は受け付けません。価格と画像はサーバー取得のみです）。`,
          position,
        );
      }
    }
    const hasUrl = entry.url !== undefined && entry.url !== null;
    const hasId = entry.item_id !== undefined && entry.item_id !== null;
    if (hasUrl === hasId) {
      throw refuse(400, 'INVALID_INPUT', 'url か item_id のどちらか一方を指定してください。', position);
    }
    if (hasId) {
      const itemId = entry.item_id;
      if (typeof itemId !== 'number' || !Number.isSafeInteger(itemId) || itemId <= 0) {
        throw refuse(400, 'INVALID_INPUT', 'item_id は正の整数です。', position);
      }
      if (entry.name !== undefined && entry.name !== null) {
        throw refuse(400, 'INVALID_INPUT', '登録済みの商品（item_id）の名前はこのツールでは変えません。name は url の候補にだけ指定できます。', position);
      }
      if (seenIds.has(itemId)) {
        throw refuse(400, 'INVALID_INPUT', '同じ item_id が重複しています。候補は異なる商品にしてください。', position);
      }
      seenIds.add(itemId);
      candidates.push({ kind: 'item', position, itemId });
      return;
    }
    let url: string;
    try {
      url = requireHttpUrl(entry.url);
    } catch (error) {
      throw atPosition(error, position);
    }
    let candidateName: string | null = null;
    if (entry.name !== undefined && entry.name !== null) {
      candidateName = typeof entry.name === 'string' ? normalizeItemName(entry.name) : null;
      if (!candidateName) {
        throw refuse(400, 'INVALID_INPUT', 'name は空でない文字列で指定してください（省略するとサーバーが取得した商品名を使います）。', position);
      }
    }
    if (seenUrls.has(url)) {
      throw refuse(
        400,
        'INVALID_INPUT',
        '同じ商品ページの URL が重複しています。候補は異なる商品にしてください（同じ商品の店舗違いは add_item_by_url の urls）。',
        position,
      );
    }
    seenUrls.add(url);
    candidates.push({ kind: 'url', position, url, name: candidateName });
  });
  return { name, candidates };
}

function candidateKey(candidate: ComparisonCandidateInput): string {
  return candidate.kind === 'url' ? `url:${candidate.url}` : `item:${candidate.itemId}`;
}

/** 操作ログに残す候補の目印。URL そのものはログに書かない。 */
function candidateKeyHash(candidate: ComparisonCandidateInput): string {
  return createHash('sha256').update(candidateKey(candidate), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 同じ要求かどうかの指紋。グループ名（整形後）と候補の組で決まり、候補の順序と、
 * 保存時に落とす計測パラメータには依らない。所有者ごとの操作ログとだけ照合する。
 */
export function comparisonCandidatesFingerprint(request: ComparisonCandidatesRequest): string {
  const keys = request.candidates.map(candidateKey).sort();
  return createHash('sha256')
    .update(JSON.stringify({ version: 1, name: request.name, candidates: keys }), 'utf8')
    .digest('hex');
}

type GroupRef = { id: number; name: string };

/** read が無いトークンには、既存のグループ名を返さない。 */
function groupLabel(group: GroupRef, canRead: boolean): string {
  return canRead ? `「${group.name}」（ID ${group.id}）` : `（ID ${group.id}）`;
}

type ResolvedCandidate =
  /** まだ登録の無い URL。取得して新しい商品として入れる */
  | { state: 'new' }
  /** 登録済みで、どの比較グループにも入っていない */
  | { state: 'ungrouped'; itemId: number }
  /** 登録済みで、手作業比較グループに入っている */
  | { state: 'grouped'; itemId: number; group: GroupRef };

type CandidatesPlan = {
  resolved: ResolvedCandidate[];
  /** 候補の一部（または全部）が既に入っている、要求と同じ名前の手作業比較グループ。無ければ新しく作る */
  targetGroup: GroupRef | null;
  /** 候補がすべて targetGroup に入っていて、書くものが無い */
  unchanged: boolean;
};

function resolveCandidate(
  db: Database.Database,
  userId: number,
  candidate: ComparisonCandidateInput,
  canRead: boolean,
): ResolvedCandidate {
  let row: Record<string, unknown>;
  if (candidate.kind === 'url') {
    // 古いリストには同じ URL の行が複数あることがある。どの行（どのグループ）かを勝手に選ばない。
    const live = findCleanedStoredUrlMatches(db, userId, candidate.url).filter((match) => !match.deleted_at);
    if (live.length > 1) {
      const ids = live.map((match) => match.id).join('、');
      throw refuse(
        409,
        'URL_AMBIGUOUS',
        `この URL と同じ商品ページの登録が複数あります（品目 ID ${ids}。購入済みを含みます）。どれを比較候補にするか決められないので、url の代わりに item_id で1件を指定してください。`,
        candidate.position,
      );
    }
    const registration = findCleanedStoredUrlRegistration(db, userId, candidate.url);
    if (registration.kind === 'free') return { state: 'new' };
    if (registration.kind === 'trashed') {
      // 単品登録と違い、自動では復元しない（複数店の登録と同じ）。
      throw refuse(409, 'URL_IN_TRASH', `${URL_IN_TRASH_MESSAGE}（品目 ID ${registration.match.id}）。`, candidate.position);
    }
    row = getOwnedItemOrThrow(userId, registration.match.id, db);
  } else {
    try {
      row = getOwnedItemOrThrow(userId, candidate.itemId, db);
    } catch (error) {
      throw atPosition(error, candidate.position);
    }
  }

  const itemId = Number(row.id);
  if (row.deleted_at) {
    throw refuse(409, 'ITEM_TRASHED', `品目 ID ${itemId} はゴミ箱にあります。自動では復元しません。Webのゴミ箱タブで元に戻してから指定してください。`, candidate.position);
  }
  if (row.is_purchased) {
    throw refuse(409, 'ITEM_PURCHASED', `品目 ID ${itemId} は購入済みです。購入済みの商品は比較候補にしません。`, candidate.position);
  }
  const groupId = row.comparison_group_id == null ? null : Number(row.comparison_group_id);
  if (groupId == null) return { state: 'ungrouped', itemId };
  const group = db.prepare(
    'SELECT id, name, origin FROM comparison_groups WHERE id = ? AND user_id = ?',
  ).get(groupId, userId) as { id: number; name: string; origin: string | null } | undefined;
  if (!group) return { state: 'ungrouped', itemId };
  if (group.origin != null) {
    throw refuse(
      409,
      'ITEM_IN_STORE_GROUP',
      `品目 ID ${itemId} は同じ商品の店舗比較${groupLabel(group, canRead)}の店の行です。別の商品との比較グループへは移しません。`,
      candidate.position,
    );
  }
  return { state: 'grouped', itemId, group: { id: group.id, name: group.name } };
}

/** 保存済みのグループ名が、要求の名前（整形後）と同じか。 */
function isRequestedGroup(group: GroupRef, requestName: string): boolean {
  try {
    return normalizeComparisonGroupName(group.name) === requestName;
  } catch {
    return false;
  }
}

function planComparisonCandidates(
  db: Database.Database,
  userId: number,
  request: ComparisonCandidatesRequest,
  canRead: boolean,
): CandidatesPlan {
  const resolved = request.candidates.map((candidate) => resolveCandidate(db, userId, candidate, canRead));

  const seenItems = new Map<number, number>();
  resolved.forEach((entry, index) => {
    if (entry.state === 'new') return;
    const earlier = seenItems.get(entry.itemId);
    if (earlier !== undefined) {
      throw refuse(
        400,
        'INVALID_INPUT',
        `候補${earlier}と同じ登録済みの商品（品目 ID ${entry.itemId}）を指しています。候補は異なる商品にしてください。`,
        request.candidates[index].position,
      );
    }
    seenItems.set(entry.itemId, request.candidates[index].position);
  });

  const groups = new Map<number, GroupRef>();
  for (const entry of resolved) {
    if (entry.state === 'grouped') groups.set(entry.group.id, entry.group);
  }
  if (groups.size > 1) {
    const labels = [...groups.values()].map((group) => groupLabel(group, canRead)).join('と');
    throw refuse(
      409,
      'CANDIDATES_IN_DIFFERENT_GROUPS',
      `候補が別々の比較グループ${labels}に入っています。既存の商品は自動では移動しません。まとめ直すなら update_item の comparison_group_id で明示的に移してください。`,
    );
  }
  const [existing] = [...groups.values()];
  if (existing && !isRequestedGroup(existing, request.name)) {
    // 指定された名前とは別のグループ。そこへ足すことも、そこから移すこともしない。
    const index = resolved.findIndex((entry) => entry.state === 'grouped');
    const itemId = (resolved[index] as { itemId: number }).itemId;
    throw refuse(
      409,
      'CANDIDATE_IN_OTHER_GROUP',
      `品目 ID ${itemId} は、指定の「${request.name}」とは別の比較グループ${groupLabel(existing, canRead)}に既に入っています。既存の商品は自動では移動せず、指定と違うグループへ残りを足すこともしません。そのグループへ足すなら name をそのグループの名前にして呼び直し、「${request.name}」へ移すなら先に update_item の comparison_group_id で明示的に外すか移してください。`,
      request.candidates[index].position,
    );
  }
  const targetGroup = existing ?? null;
  return {
    resolved,
    targetGroup,
    unchanged: targetGroup != null && resolved.every((entry) => entry.state === 'grouped'),
  };
}

/** 取得の前後で、候補の実体（どの行か）と所属と書き先が同じかを比べるための形。 */
function planSignature(plan: CandidatesPlan): string {
  return JSON.stringify({
    target: plan.targetGroup?.id ?? null,
    resolved: plan.resolved.map((entry) => (
      entry.state === 'new' ? ['new'] : [entry.state, entry.itemId, entry.state === 'grouped' ? entry.group.id : null]
    )),
  });
}

type ReplayRecord = NonNullable<SaveComparisonCandidatesResult['replay_of']>;

function isCandidateResult(value: unknown): value is ComparisonCandidateResult {
  return value === 'created' || value === 'added_to_group' || value === 'already_in_group';
}

type CandidateRow = {
  id: number;
  name: string;
  url: string;
  current_price: number | null;
  image_url: string | null;
  scrape_status: string | null;
  scrape_error: string | null;
  deleted_at: string | null;
  is_purchased: number;
  comparison_group_id: number | null;
};

function candidateRow(db: Database.Database, userId: number, itemId: number): CandidateRow | undefined {
  return db.prepare(`
    SELECT id, name, url, current_price, image_url, scrape_status, scrape_error,
      deleted_at, is_purchased, comparison_group_id
    FROM items WHERE id = ? AND user_id = ?
  `).get(itemId, userId) as CandidateRow | undefined;
}

/** 以前に成功した同じ要求の保存記録と、その記録どおりに残っている現在の行。 */
type IntactReceipt = {
  group: GroupRef;
  replayOf: ReplayRecord;
  /** 要求の候補と同じ順 */
  rows: CandidateRow[];
};

/**
 * 同じ指紋で成功した保存を、所有者自身の操作ログから探す（最新の 1 件。件数では切らない。
 * 残っているのは操作ログの保持期間 AGENT_AUDIT_RETENTION_DAYS の間）。
 * - 記録が無い（または読めない）: null。現在の状態だけで判定する。
 * - 記録のグループと品目 ID がそのまま残っている: その結果を返す（何も書かない再送）。
 * - 記録のあとで候補が外された・移された・ゴミ箱や購入済みになった・消された: 409。
 *   利用者の変更を再送で巻き戻さない。現在の所属は見ずに、記録した ID そのものを確かめる。
 */
function findIntactReceipt(
  db: Database.Database,
  userId: number,
  request: ComparisonCandidatesRequest,
  fingerprint: string,
): IntactReceipt | null {
  const row = db.prepare(`
    SELECT meta, created_at FROM agent_audit_log
    WHERE user_id = ? AND action = ?
      AND CASE WHEN json_valid(meta) THEN json_extract(meta, '$.request_fingerprint') END = ?
    ORDER BY id DESC LIMIT 1
  `).get(userId, COMPARISON_CANDIDATES_AUDIT_ACTION, fingerprint) as { meta: string; created_at: string } | undefined;
  if (!row) return null;
  const meta = JSON.parse(row.meta) as unknown;
  if (!isPlainObject(meta) || typeof meta.group_id !== 'number' || !Array.isArray(meta.results)) return null;
  const byKey = new Map<string, { itemId: number; result: ComparisonCandidateResult }>();
  for (const entry of meta.results) {
    if (!isPlainObject(entry) || typeof entry.key !== 'string' || typeof entry.item_id !== 'number' || !isCandidateResult(entry.result)) {
      return null;
    }
    byKey.set(entry.key, { itemId: entry.item_id, result: entry.result });
  }
  const recorded = request.candidates.map((candidate) => byKey.get(candidateKeyHash(candidate)));
  if (recorded.some((entry) => !entry)) return null;

  const group = db.prepare(
    'SELECT id, name FROM comparison_groups WHERE id = ? AND user_id = ? AND origin IS NULL',
  ).get(meta.group_id, userId) as GroupRef | undefined;
  const rows = recorded.map((entry) => candidateRow(db, userId, entry!.itemId));
  const intact = group != null && rows.every((item) => (
    item != null && !item.deleted_at && !item.is_purchased && item.comparison_group_id === group.id
  ));
  if (!intact) {
    throw refuse(
      409,
      'SAVED_REQUEST_CHANGED',
      `同じ依頼は ${row.created_at}（UTC）に保存済みですが、そのあとで保存した内容が変更されています（候補が比較グループから外された・移された・ゴミ箱や購入済みになった・削除された、など）。利用者の変更を上書きしないよう、送り直しでは元に戻しません。改めてまとめたいと利用者が言ったときだけ、別のグループ名で呼び直すか、update_item の comparison_group_id で入れてください。`,
    );
  }
  return {
    group,
    rows: rows as CandidateRow[],
    replayOf: {
      saved_at: row.created_at,
      group_created: meta.group_created === true,
      candidates: recorded.map((entry, index) => ({
        position: request.candidates[index].position,
        item_id: entry!.itemId,
        result: entry!.result,
      })),
    },
  };
}

type Inspection =
  | { replay: IntactReceipt; plan?: undefined }
  | { replay?: undefined; plan: CandidatesPlan };

/** 保存記録の照合が先。記録が無いときだけ、現在の状態から書く内容を決める。 */
function inspectRequest(
  db: Database.Database,
  auth: AgentAuthContext,
  request: ComparisonCandidatesRequest,
  fingerprint: string,
): Inspection {
  const replay = findIntactReceipt(db, auth.userId, request, fingerprint);
  if (replay) return { replay };
  return { plan: planComparisonCandidates(db, auth.userId, request, auth.scopes.includes('read')) };
}

export type ComparisonCandidatesRate = { kinds: AgentRateKind[]; units: number };

/**
 * レート消費と外部取得の前に行う検査。構文・所有者・保存記録・候補の状態で確実に失敗する要求は、
 * ここで拒否して上限を減らさない。消費する上限は既存の登録と同じ数え方にそろえる。
 * - 新規 URL があれば、その件数分の add / add_url / add_day（add_item_by_url と同じ）
 * - 取得は無いがグループを作るなら add / add_day を 1（create_comparison_group と同じ）
 * - 既存グループへ登録済みの商品を足すだけ、または再送（変更なし）は消費しない（update_item と同じ）
 * ここを通ったあとの失敗（取得の失敗、422、取得中の状態変化による 409）では、消費した分は戻らない。
 */
export function assertComparisonCandidatesPreflight(
  auth: AgentAuthContext,
  body: Record<string, unknown>,
  db: Database.Database = getDb(),
): { request: ComparisonCandidatesRequest; rate: ComparisonCandidatesRate | null } {
  const request = parseComparisonCandidatesInput(body);
  const { plan } = inspectRequest(db, auth, request, comparisonCandidatesFingerprint(request));
  if (!plan || plan.unchanged) return { request, rate: null };
  const newUrls = plan.resolved.filter((entry) => entry.state === 'new').length;
  if (newUrls > 0) return { request, rate: { kinds: ['add', 'add_url', 'add_day'], units: newUrls } };
  if (!plan.targetGroup) return { request, rate: { kinds: ['add', 'add_day'], units: 1 } };
  return { request, rate: null };
}

function activeGroupItemCount(db: Database.Database, userId: number, groupId: number): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM items
    WHERE user_id = ? AND comparison_group_id = ? AND deleted_at IS NULL AND is_purchased = 0
  `).get(userId, groupId) as { count: number }).count;
}

/** 保存済みの行から、価格も画像も取れなかった取得失敗を組み立てる（再送の応答用）。 */
function storedFetchError(row: CandidateRow): AgentMediaFetchError[] {
  if (row.current_price != null || row.image_url != null) return [];
  const failure = agentScrapeFailure(row.scrape_status, row.scrape_error);
  return failure ? [{ url: row.url, code: failure.code, message: failure.message }] : [];
}

const RECEIPT_ONLY_NOTE = ' このトークンには read 権限が無いため、ID と操作の結果だけを返します（商品名・URL・価格・グループ名・件数は返しません）。';

/**
 * 応答の group / candidates を組み立てる。write だけのトークンには、書き込みの確認に要る
 * ID と操作の結果だけを返し、既存の商品名・URL・価格・グループ名・件数は read があるときだけ足す。
 */
function describeSaved(
  db: Database.Database,
  auth: AgentAuthContext,
  group: GroupRef,
  groupCreated: boolean,
  entries: { position: number; row: CandidateRow; result: ComparisonCandidateResult }[],
): Pick<SaveComparisonCandidatesResult, 'group' | 'candidates' | 'item_ids'> {
  const canRead = auth.scopes.includes('read');
  return {
    group: {
      id: group.id,
      origin: null,
      created: groupCreated,
      ...(canRead ? { name: group.name, item_count: activeGroupItemCount(db, auth.userId, group.id) } : {}),
    },
    candidates: entries.map(({ position, row, result }) => ({
      position,
      item_id: row.id,
      result,
      ...(canRead ? { name: row.name, url: row.url, current_price: row.current_price } : {}),
    })),
    item_ids: entries.map(({ row }) => row.id),
  };
}

type PreparedCandidate = { prepared: PreparedStore; name: string };

export type SaveComparisonCandidatesOptions = {
  mediaOptions?: FetchServerItemMediaOptions;
  /** 操作ログの scope / 指紋 / 結果に足す追加情報（MCP はツール名） */
  auditMeta?: Record<string, unknown>;
};

/**
 * 比較候補を 1 回で保存する。
 *
 * 順序: 構文検査（400）→ 保存記録の照合と候補の状態の検査（404 / 409。確実に失敗する要求は外へ
 * 取りに行かない）→ 新規 URL の公開判定と取得（トランザクションの外。逐次）→ immediate トランザクションで
 * もう一度照合と検査を行い、グループ作成・商品登録・所属変更・操作ログをまとめて書く。
 * 取得の間に同じ要求が先に保存を終えていれば、何も書かずにその結果を返す。それ以外で候補の実体・
 * 所属・書き先が取得の前と違っていれば 409 で何も残さない。
 */
export async function saveAgentComparisonCandidates(
  auth: AgentAuthContext,
  body: Record<string, unknown>,
  options: SaveComparisonCandidatesOptions = {},
  db: Database.Database = getDb(),
): Promise<SaveComparisonCandidatesResult> {
  const request = parseComparisonCandidatesInput(body);
  const fingerprint = comparisonCandidatesFingerprint(request);
  const canRead = auth.scopes.includes('read');
  const note = canRead ? '' : RECEIPT_ONLY_NOTE;
  const first = inspectRequest(db, auth, request, fingerprint);

  const preparedByUrl = new Map<string, PreparedCandidate>();
  if (first.plan && !first.plan.unchanged) {
    for (const [index, candidate] of request.candidates.entries()) {
      if (candidate.kind !== 'url' || first.plan.resolved[index].state !== 'new') continue;
      let prepared: PreparedStore;
      try {
        prepared = await prepareStoreMedia(auth, candidate.url, options.mediaOptions ?? {});
      } catch (error) {
        throw atPosition(error, candidate.position);
      }
      const name = candidate.name ?? prepared.scrapedName;
      if (!name) {
        const scrapeNote = prepared.media.scraped?.note ? `${prepared.media.scraped.note} ` : '';
        throw refuse(
          422,
          'NAME_REQUIRED',
          `${scrapeNote}商品名を取得できませんでした。この候補に name を指定して、同じ内容でもう一度呼び出してください。`,
          candidate.position,
        );
      }
      preparedByUrl.set(candidate.url, { prepared, name });
    }
  }

  return db.transaction((): SaveComparisonCandidatesResult => {
    // 取得の間に変わった状態を、書き込みと同じロックの中で読み直す。
    const current = inspectRequest(db, auth, request, fingerprint);

    if (current.replay) {
      const { group, rows, replayOf } = current.replay;
      const createdBefore = new Set(
        replayOf.candidates.filter((entry) => entry.result === 'created').map((entry) => entry.item_id),
      );
      return {
        status: 'already_saved',
        changed: false,
        replayed: true,
        message: `同じ依頼は既に保存済みです（比較グループ${groupLabel(group, canRead)}）。この呼び出しでは何も変更していません。最初の保存の結果は replay_of にあります。${note}`,
        ...describeSaved(db, auth, group, false, rows.map((row, index) => ({
          position: request.candidates[index].position, row, result: 'already_in_group',
        }))),
        // 保存済みの取得失敗の内容は、read があるときだけ返す。
        media_fetch_errors: canRead ? rows.filter((row) => createdBefore.has(row.id)).flatMap(storedFetchError) : [],
        replay_of: replayOf,
      };
    }

    const plan = current.plan;
    if (!first.plan || planSignature(plan) !== planSignature(first.plan)) {
      // 取得の前に見た行・所属・書き先と違う。読み直した側へ黙って書き先を変えない。
      throw refuse(
        409,
        'CANDIDATES_CHANGED',
        '処理の間に、候補の登録状態か比較グループの所属が変わりました。変わったあとの状態を確かめてから、必要ならもう一度呼び出してください。',
      );
    }

    const loadRow = (itemId: number): CandidateRow => {
      const row = candidateRow(db, auth.userId, itemId);
      if (!row) throw refuse(409, 'CANDIDATES_CHANGED', '処理の間に候補の登録状態が変わりました。');
      return row;
    };

    if (plan.unchanged && plan.targetGroup) {
      const group = plan.targetGroup;
      return {
        status: 'already_saved',
        changed: false,
        replayed: false,
        message: `候補はすべて既に比較グループ${groupLabel(group, canRead)}に入っています。この呼び出しでは何も変更していません。${note}`,
        ...describeSaved(db, auth, group, false, plan.resolved.map((entry, index) => ({
          position: request.candidates[index].position,
          row: loadRow((entry as { itemId: number }).itemId),
          result: 'already_in_group',
        }))),
        media_fetch_errors: [],
      };
    }

    const groupCreated = plan.targetGroup == null;
    const group: GroupRef = plan.targetGroup
      ?? createAgentComparisonGroup(auth.userId, { name: request.name }, db);
    const fetchErrors: AgentMediaFetchError[] = [];
    const saved: { position: number; row: CandidateRow; result: ComparisonCandidateResult; key: string }[] = [];

    for (const [index, candidate] of request.candidates.entries()) {
      const entry = plan.resolved[index];
      let itemId: number;
      let result: ComparisonCandidateResult;
      if (entry.state === 'new') {
        const ready = candidate.kind === 'url' ? preparedByUrl.get(candidate.url) : undefined;
        if (candidate.kind !== 'url' || !ready) {
          throw refuse(409, 'CANDIDATES_CHANGED', '処理の間に候補の登録状態が変わりました。同じ内容でもう一度呼び出してください。', candidate.position);
        }
        // この呼び出しで先に入れた候補と同じ商品ページ（楽天の包装 URL など）なら、重複登録しない。
        if (findCleanedStoredUrlRegistration(db, auth.userId, candidate.url).kind !== 'free') {
          throw refuse(400, 'INVALID_INPUT', '他の候補と同じ商品ページを指しています。候補は異なる商品にしてください。', candidate.position);
        }
        const inserted = insertAgentItem(auth, {
          name: ready.name,
          url: ready.prepared.url,
          media: ready.prepared.media,
          priority: 3,
          quantity: 1,
          notes: null,
          planned_purchase_date: null,
          category_id: null,
          comparison_group_id: group.id,
        }, db);
        if (inserted.restoredFromTrash) {
          throw refuse(409, 'CANDIDATES_CHANGED', '処理の間に候補の登録状態が変わりました。同じ内容でもう一度呼び出してください。', candidate.position);
        }
        fetchErrors.push(...mediaFetchErrors(ready.prepared.url, ready.prepared.media));
        itemId = inserted.item.id;
        result = 'created';
      } else if (entry.state === 'ungrouped') {
        // 登録済みの商品は所属だけを変える。名前・メモ・価格・「エージェントが追加」の印は触らない。
        // どのグループにも入っていない行だけを入れる（別のグループからは移さない）。
        const changed = db.prepare(`
          UPDATE items SET comparison_group_id = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND is_purchased = 0
            AND (comparison_group_id IS NULL
              OR comparison_group_id NOT IN (SELECT id FROM comparison_groups WHERE user_id = ?))
        `).run(group.id, entry.itemId, auth.userId, auth.userId).changes;
        if (changed !== 1) {
          throw refuse(409, 'CANDIDATES_CHANGED', '処理の間に候補の状態が変わりました。同じ内容でもう一度呼び出してください。', candidate.position);
        }
        itemId = entry.itemId;
        result = 'added_to_group';
      } else {
        itemId = entry.itemId;
        result = 'already_in_group';
      }
      saved.push({ position: candidate.position, row: loadRow(itemId), result, key: candidateKeyHash(candidate) });
    }

    // 保存と同じトランザクションに操作ログを入れる。ログを書けなければ保存も戻る。
    // この記録が、同じ要求の再送を見分ける保存記録になる（key は候補の目印。URL は書かない）。
    recordAgentAudit(auth.token.id, auth.userId, COMPARISON_CANDIDATES_AUDIT_ACTION, {
      scope: 'write',
      ...(options.auditMeta ?? {}),
      request_fingerprint: fingerprint,
      group_id: group.id,
      group_created: groupCreated,
      results: saved.map((entry) => ({
        position: entry.position, item_id: entry.row.id, result: entry.result, key: entry.key,
      })),
    }, db);

    const createdCount = saved.filter((entry) => entry.result === 'created').length;
    const addedCount = saved.filter((entry) => entry.result === 'added_to_group').length;
    const counts = `新規登録 ${createdCount} 件、登録済みの商品をグループへ追加 ${addedCount} 件`;
    return {
      status: 'saved',
      changed: true,
      replayed: false,
      message: groupCreated
        ? `比較グループ「${group.name}」を作り、候補 ${saved.length} 件を独立した商品のまま入れました（${counts}）。${note}`
        : `候補の一部が既に入っていた、指定と同じ名前の比較グループ${groupLabel(group, canRead)}へ残りを足しました（${counts}）。新しいグループは作らず、既存の商品の所属は動かしていません。${note}`,
      ...describeSaved(db, auth, group, groupCreated, saved),
      // この呼び出しで取りに行った URL の失敗だけ（呼び出し側が渡した URL）。
      media_fetch_errors: fetchErrors,
    };
  }).immediate();
}

