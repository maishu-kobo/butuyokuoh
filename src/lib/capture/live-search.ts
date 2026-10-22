// 検索ルートが使う Yahoo! と楽天。キーは呼び出し側が渡し、ここは環境変数を読まない。
import type Database from 'better-sqlite3';
import { captureCandidateExpiresAt } from '../db';
import {
  acceptCandidate,
  type CaptureCandidate,
  type CapturePorts,
  type SearchQuery,
  type SearchResponse,
} from './contract';
import { createFakePorts } from './fakes';
import {
  createRakutenLimiter,
  createRakutenSearch,
  type RakutenCredentials,
  type RakutenHttp,
  type RakutenHttpRequest,
  type RakutenHttpResponse,
  type RakutenLimiter,
} from './rakuten';
import {
  createYahooRateGate,
  createYahooSearch,
  type YahooFetch,
  type YahooRateGate,
  type YahooSchedule,
} from './yahoo';

const SOURCE_NAME = {
  yahoo: 'Yahoo!ショッピング',
  rakuten: '楽天',
} as const;

const RAKUTEN_BODY_CAP = 1_000_000;

export type SearchTestTransport = {
  yahooFetch?: YahooFetch;
  yahooGate?: YahooRateGate;
  yahooSchedule?: YahooSchedule;
  rakutenHttp?: RakutenHttp;
  rakutenLimiter?: RakutenLimiter;
  rakutenTimeoutMs?: number;
  now?: () => Date;
};

const sharedYahooGate = createYahooRateGate();
const sharedRakutenLimiter = createRakutenLimiter();
let testTransport: SearchTestTransport | null = null;

export function installSearchTransportForTests(next: SearchTestTransport | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Search test transport is unavailable in production');
  }
  testTransport = next;
}

export function httpsReferer(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== origin) return null;
    return origin;
  } catch {
    return null;
  }
}

export function resolveSearchPorts(input: {
  yahooAppId: string | null;
  rakutenAppId: string | null;
  rakutenAccessKey: string | null;
  userId: string;
  referer: string | null;
}): CapturePorts {
  const extra = process.env.NODE_ENV === 'production' ? null : testTransport;
  const credentials = rakutenCredentials(input.rakutenAppId, input.rakutenAccessKey);
  return {
    identifier: createFakePorts().identifier,
    yahoo: createYahooSearch({
      appId: input.yahooAppId,
      userId: input.userId,
      fetch: extra?.yahooFetch,
      gate: extra?.yahooGate ?? sharedYahooGate,
      schedule: extra?.yahooSchedule,
      now: extra?.now ? () => extra.now!().getTime() : undefined,
    }),
    rakuten: createRakutenSearch({
      credentials,
      http: extra?.rakutenHttp ?? defaultRakutenHttp,
      limiter: extra?.rakutenLimiter ?? sharedRakutenLimiter,
      userId: input.userId,
      now: extra?.now,
      timeoutMs: extra?.rakutenTimeoutMs,
      referer: input.referer,
    }),
  };
}

export function saveSearchCandidates(
  database: Database.Database,
  userId: number,
  query: SearchQuery,
  response: SearchResponse,
  now = Date.now(),
): { captureId: number; storedIds: number[] } | null {
  const candidates = response.candidates.filter((item): item is CaptureCandidate => acceptCandidate(item) !== null);
  if (candidates.length === 0) return null;
  const expiresAt = captureCandidateExpiresAt(now);
  const estimatedName = query.name.trim() || null;
  return database.transaction(() => {
    const captureId = Number(database.prepare(
      `INSERT INTO captures (user_id, estimated_name, jan, status) VALUES (?, ?, ?, 'open')`,
    ).run(userId, estimatedName, query.jan).lastInsertRowid);
    const insert = database.prepare(
      `INSERT INTO capture_candidates (
        user_id, capture_id, source, source_name, shop_name, name, url, image_url, price,
        source_item_code, price_fetched_at, jan, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const storedIds = candidates.map((item) => Number(insert.run(
      userId,
      captureId,
      item.site,
      SOURCE_NAME[item.site],
      item.shopName,
      item.title,
      item.url,
      item.imageUrl ?? null,
      item.price,
      item.id,
      item.fetchedAt,
      item.jan ?? null,
      expiresAt,
    ).lastInsertRowid));
    return { captureId, storedIds };
  }).immediate();
}

function rakutenCredentials(applicationId: string | null, accessKey: string | null): RakutenCredentials | null {
  if (!applicationId || !accessKey) return null;
  return { applicationId, accessKey };
}

async function defaultRakutenHttp(request: RakutenHttpRequest): Promise<RakutenHttpResponse> {
  const response = await fetch(request.url, {
    method: 'GET',
    headers: request.headers,
    signal: request.signal,
    redirect: 'manual',
    cache: 'no-store',
  });
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, body: '' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.byteLength;
      if (size > RAKUTEN_BODY_CAP) {
        await reader.cancel().catch(() => undefined);
        return { status: 502, body: '' };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { status: 502, body: '' };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: response.status, body: new TextDecoder().decode(bytes) };
}
