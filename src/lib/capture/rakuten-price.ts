import { rakutenApiItemCode } from './contract';
// 楽天の商品コードがある未購入商品だけ、24時間ごとに商品検索APIで価格を取り直す。
// 失敗しても自動ではやり直さない。Yahoo! と、商品コードの無い手入力はここへ載せない。
import type Database from 'better-sqlite3';
import { recordPriceIfChanged } from '../price-check-items';
import {
  RAKUTEN_ENDPOINT,
  RAKUTEN_SEARCH_TIMEOUT_MS,
  type RakutenCredentials,
  type RakutenHttp,
  type RakutenLimiter,
} from './rakuten';

const DAY_MS = 24 * 60 * 60 * 1000;

interface DueItem {
  id: number;
  user_id: number;
  url: string;
  current_price: number | null;
  source_item_code: string;
  price_fetched_at: string | null;
}

export async function refreshDueRakutenPrices(
  db: Database.Database,
  options: {
    credentials: RakutenCredentials | null;
    http: RakutenHttp;
    limiter: RakutenLimiter;
    now?: () => Date;
    pause?: () => Promise<void>;
    timeoutMs?: number;
  },
): Promise<void> {
  const credentials = normalizeCredentials(options.credentials);
  if (!credentials) return;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? RAKUTEN_SEARCH_TIMEOUT_MS;
  const due = dueItems(db, now().getTime());
  let started = false;
  for (const item of due) {
    if (started && options.pause) await options.pause();
    started = true;
    const itemCode = apiItemCode(item.source_item_code);
    if (!itemCode || !unchangedActiveItem(db, item)) continue;
    const slot = options.limiter.tryAcquire(String(item.user_id), now().getTime());
    if (!slot.ok) continue;

    const url = new URL(RAKUTEN_ENDPOINT);
    url.searchParams.set('applicationId', credentials.applicationId);
    url.searchParams.set('itemCode', itemCode);
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatVersion', '2');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await options.http({
        url: url.toString(),
        method: 'GET',
        headers: { accessKey: credentials.accessKey },
        signal: controller.signal,
      });
      if (controller.signal.aborted) continue;
      const price = readPrice(response.status, response.body, itemCode);
      if (price === null) continue;
      const fetchedAt = now().toISOString();
      db.transaction(() => {
        // API取得中にURL、価格、購入状態などが変わったら古い応答を捨てる。
        if (!unchangedActiveItem(db, item)) return;
        db.prepare(`
          UPDATE items
          SET current_price = ?, price_fetched_at = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(price, fetchedAt, item.id);
        recordPriceIfChanged(db, item.id, price);
      }).immediate();
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
}

function dueItems(db: Database.Database, nowMs: number): DueItem[] {
  const rows = db.prepare(`
    SELECT i.id, i.user_id, i.url, i.current_price, i.source_item_code, i.price_fetched_at
    FROM items i
    JOIN users u ON u.id = i.user_id
    WHERE u.account_type = 'member'
      AND i.is_purchased = 0
      AND i.deleted_at IS NULL
      AND i.source_item_code LIKE 'rakuten:%'
    ORDER BY i.id ASC
  `).all() as DueItem[];
  return rows.filter((row) => apiItemCode(row.source_item_code) && isDue(row.price_fetched_at, nowMs));
}

function isDue(fetchedAt: string | null, nowMs: number): boolean {
  if (!fetchedAt) return true;
  const iso = fetchedAt.includes('T') ? fetchedAt : `${fetchedAt.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms >= DAY_MS;
}

function apiItemCode(stored: string | null): string | null {
  if (!stored?.startsWith('rakuten:')) return null;
  const code = stored.slice('rakuten:'.length).trim();
  return rakutenApiItemCode(code);
}

function normalizeCredentials(value: RakutenCredentials | null): RakutenCredentials | null {
  if (!value || typeof value.applicationId !== 'string' || typeof value.accessKey !== 'string') return null;
  if (/[\r\n\0]/.test(value.accessKey) || /[\r\n\0]/.test(value.applicationId)) return null;
  const applicationId = value.applicationId.trim();
  const accessKey = value.accessKey.trim();
  if (!applicationId || !accessKey) return null;
  return { applicationId, accessKey };
}

function readPrice(status: number, body: string, expectedCode: string): number | null {
  if (status < 200 || status >= 300) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.error === 'string' || typeof record.error_description === 'string') return null;
  const list = record.items ?? record.Items;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    const item = unwrap(entry);
    if (item?.itemCode !== expectedCode) continue;
    const price = item.itemPrice;
    if (typeof price === 'number' && Number.isSafeInteger(price) && price >= 0) return price;
  }
  return null;
}

function unwrap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested = record.item ?? record.Item;
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  return record;
}

function unchangedActiveItem(db: Database.Database, item: DueItem): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM items
    WHERE id = ? AND user_id = ? AND url = ? AND source_item_code = ?
      AND current_price IS ? AND price_fetched_at IS ?
      AND is_purchased = 0 AND deleted_at IS NULL
  `).get(item.id, item.user_id, item.url, item.source_item_code, item.current_price, item.price_fetched_at));
}
