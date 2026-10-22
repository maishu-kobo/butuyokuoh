// 写真から候補一覧までの進め方。画面はこの結果だけを出す。確かさは数字にしない。
import type { IdentifyConfidence, ProductGuess } from './contract';

export const SLOW_MS = 15_000;

export const RETAKE_MESSAGE = 'この写真からは商品が読み取れません。もう一度撮ってください';

export const FLOW_STATUS = {
  sending: '写真を送っています',
  identifying: '商品を推定しています',
  searching: '候補を探しています',
  choose: '商品名を選んでください',
} as const;

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
