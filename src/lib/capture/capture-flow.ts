// 写真から候補一覧までの進め方。画面はこの結果だけを出す。確かさは数字にしない。
import { CaptureMessages, type IdentifyConfidence, type ProductGuess } from './contract';

export const SLOW_MS = 15_000;

export const RETAKE_MESSAGE = 'この写真からは商品が読み取れません。もう一度撮ってください';

export const FLOW_STATUS = {
  sending: '写真を送っています',
  identifying: '商品を推定しています',
  searching: '候補を探しています',
  choose: '写真だけでは商品を特定できませんでした。商品名を確認し、ブランド名や品番を補って探してください',
} as const;

export const NOT_FOUND_MESSAGE = '見つかりませんでした';

export function productsToShow(confidence: IdentifyConfidence, products: ProductGuess[]): ProductGuess[] {
  if (confidence === 'unreadable') return [];
  if (confidence === 'sure') return products.slice(0, 1);
  return products.slice(0, 3);
}

export function orderCandidates<T extends { price: number; id: string }>(
  items: readonly T[],
  mode: 'recommended' | 'price',
): T[] {
  if (mode !== 'price') return [...items];
  return [...items].sort((left, right) => left.price - right.price || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function flowIsSlow(startedAt: number, now: number): boolean {
  return now - startedAt >= SLOW_MS;
}

export function candidateCountStatus(count: number): string {
  return `候補が${count}件あります`;
}

export type ManualFallback = { enter: true; name: string } | { enter: false };

function recordOf(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function estimatedName(body: unknown): string {
  const products = recordOf(body)?.products;
  const first = Array.isArray(products) ? products[0] : null;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return '';
  const name = (first as { name?: unknown }).name;
  return typeof name === 'string' ? name.trim() : '';
}

export function fallbackFromIdentify(body: unknown, ok: boolean): ManualFallback {
  const name = estimatedName(body);
  const record = recordOf(body);
  const products = record && Array.isArray(record.products) ? record.products : [];
  const confidence = record?.confidence;
  const listed = ok && (confidence === 'sure' || confidence === 'unsure') && products.length > 0;
  return listed ? { enter: false } : { enter: true, name };
}

export function fallbackFromSearch(body: unknown, ok: boolean, queryName: string): ManualFallback {
  const name = queryName.trim();
  const candidates = recordOf(body)?.candidates;
  if (ok && Array.isArray(candidates) && candidates.length > 0) return { enter: false };
  return { enter: true, name };
}

export function statusAfterIdentify(body: unknown, ok: boolean): { message: string; retryable: boolean } | null {
  const record = recordOf(body);
  const products = record && Array.isArray(record.products) ? record.products : null;
  const confidence = record?.confidence;
  const listed = ok && (confidence === 'sure' || confidence === 'unsure') && products !== null && products.length > 0;
  if (listed) return null;
  if (ok && confidence === 'unreadable') return { message: RETAKE_MESSAGE, retryable: false };
  const serverMessage = typeof record?.error === 'string' ? record.error : '';
  return {
    message: serverMessage || CaptureMessages.aiRetryable,
    retryable: record?.retryable === true || serverMessage.length === 0,
  };
}

export function thrownCaptureRetry(identified: boolean): { kind: 'identify' | 'search'; message: string } {
  if (identified) return { kind: 'search', message: CaptureMessages.searchFailed };
  return { kind: 'identify', message: CaptureMessages.aiRetryable };
}

function isCleanMiss(body: unknown, ok: boolean): boolean {
  if (!ok) return false;
  const record = recordOf(body);
  if (!record || typeof record.code === 'string') return false;
  if (!Array.isArray(record.candidates) || record.candidates.length > 0) return false;
  const failures = record.failures;
  return !Array.isArray(failures) || failures.length === 0;
}

export function statusAfterSearch(body: unknown, ok: boolean, queryName: string): {
  blocked: boolean;
  message: string;
  manual: ManualFallback;
} {
  // 0 件は店の失敗と分ける。検索語を直してやり直すので、手入力へは進まない。
  if (isCleanMiss(body, ok)) {
    return { blocked: false, message: NOT_FOUND_MESSAGE, manual: { enter: false } };
  }
  const manual = fallbackFromSearch(body, ok, queryName);
  if (!manual.enter) return { blocked: false, message: '', manual };
  const record = recordOf(body);
  const blocked = record?.code === 'SEARCH_NOT_CONFIGURED';
  const message = blocked
    ? CaptureMessages.searchUnconfigured
    : (typeof record?.error === 'string' ? record.error : CaptureMessages.searchFailed);
  return { blocked, message, manual };
}
