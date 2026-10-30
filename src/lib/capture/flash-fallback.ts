// ブランドが無く、自信が低く、名前が色と種類だけの靴・バッグ・服だけ gemini-3.5-flash を足す。
// シリーズやブランドの語が残る推定、sure、時計やヘッドホンでは呼ばない。1日15回で打ち切る。
// flash-lite の通常フォールバックはここを通らない。
import type { IdentifyInput } from './contract';
import { dominantTypeGroup, nameHasProductType, nameIsColorAndType } from './product-query';

export const FLASH_DAILY_CAP = 15;

const FASHION_GROUPS = new Set(['shoes', 'bags', 'shirts', 'jackets', 'jeans', 'caps', 'socks']);

export interface FlashLedger {
  tryConsume(now: number): boolean;
  used(now: number): number;
  // 429 や上限のあと、その UTC 日はもう呼ばない。
  trip(now: number): void;
  blocked(now: number): boolean;
}

type GuessLike = {
  ok: boolean;
  value?: { confidence: string; products: { name: string; brand: string | null; model?: string | null }[] };
  quotaExceeded?: boolean;
};

// 429 と、本文が上限を告げる応答。Flash は送り直さない。
export function geminiQuotaExhausted(status: number, body?: string): boolean {
  if (status === 429) return true;
  if (!body || status === 200) return false;
  return /RESOURCE_EXHAUSTED|quotaExceeded|exceeded your current quota/i.test(body);
}

// 503 だけ、1回まで送り直す。429 はここまで来ない。
export async function withFlashRetry<T>(input: {
  run: () => Promise<{ status: number; body?: string; value: T }>;
  sleep?: () => Promise<unknown>;
}): Promise<{ value: T; quotaExceeded: boolean }> {
  let last!: T;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const step = await input.run();
    last = step.value;
    if (geminiQuotaExhausted(step.status, step.body)) return { value: step.value, quotaExceeded: true };
    if (step.status === 503 && attempt === 0) {
      if (input.sleep) await input.sleep();
      continue;
    }
    return { value: step.value, quotaExceeded: false };
  }
  return { value: last, quotaExceeded: false };
}

export function chooseFlashFallback<G extends GuessLike>(current: G, lite: GuessLike | null): G | GuessLike {
  if (usableGuess(current)) return current;
  if (lite && usableGuess(lite)) return lite;
  return current;
}

function usableGuess(guess: GuessLike): boolean {
  return Boolean(guess.ok && guess.value?.products[0]?.name.trim());
}

export function createFlashLedger(cap = FLASH_DAILY_CAP): FlashLedger {
  let day = '';
  let used = 0;
  let blockedDay = '';
  return {
    tryConsume(now: number) {
      const next = utcDay(now);
      if (next !== day) {
        day = next;
        used = 0;
      }
      if (blockedDay === next || used >= cap) return false;
      used += 1;
      return true;
    },
    used(now: number) {
      return utcDay(now) === day ? used : 0;
    },
    trip(now: number) {
      blockedDay = utcDay(now);
    },
    blocked(now: number) {
      return blockedDay === utcDay(now);
    },
  };
}

let sharedLedger: FlashLedger | null = null;

export function appFlashLedger(): FlashLedger {
  if (!sharedLedger) sharedLedger = createFlashLedger(FLASH_DAILY_CAP);
  return sharedLedger;
}

export function flashUpgradeEligible(guess: GuessLike): boolean {
  if (!guess.ok || !guess.value || guess.value.confidence !== 'unsure') return false;
  const product = guess.value.products[0];
  if (!product?.name.trim() || product.brand?.trim()) return false;
  if ('model' in product && typeof product.model === 'string' && product.model.trim()) return false;
  const group = dominantTypeGroup(product.name);
  if (!group || !FASHION_GROUPS.has(group)) return false;
  return nameIsColorAndType(product.name);
}

export function flashImproves(current: NonNullable<GuessLike['value']>, next: GuessLike): boolean {
  if (!next.ok || !next.value?.products[0]) return false;
  const product = next.value.products[0];
  if (!product.name.trim() || !nameHasProductType(product.name)) return false;
  if (product.brand?.trim()) return true;
  return next.value.confidence === 'sure' && current.confidence !== 'sure';
}

export async function maybeUpgradeWithFlash<G extends GuessLike>(input: {
  enabled: boolean;
  photo: IdentifyInput;
  guess: G;
  flash: { identify(photo: IdentifyInput): Promise<GuessLike> } | null;
  lite?: { identify(photo: IdentifyInput): Promise<GuessLike> } | null;
  ledger?: FlashLedger;
  now?: number;
}): Promise<{ guess: G; usedFlash: boolean }> {
  if (!input.enabled || !input.flash || !flashUpgradeEligible(input.guess) || !input.guess.value) {
    return { guess: input.guess, usedFlash: false };
  }
  const ledger = input.ledger ?? appFlashLedger();
  const now = input.now ?? Date.now();
  if (!ledger.tryConsume(now)) return { guess: input.guess, usedFlash: false };
  const next = await input.flash.identify(input.photo);
  if (next.quotaExceeded) {
    ledger.trip(now);
    if (!usableGuess(input.guess) && input.lite) {
      const lite = await input.lite.identify(input.photo);
      return { guess: chooseFlashFallback(input.guess, lite) as G, usedFlash: true };
    }
    return { guess: input.guess, usedFlash: true };
  }
  if (!flashImproves(input.guess.value, next)) return { guess: input.guess, usedFlash: true };
  return { guess: next as G, usedFlash: true };
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
