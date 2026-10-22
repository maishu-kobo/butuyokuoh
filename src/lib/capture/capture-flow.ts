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
