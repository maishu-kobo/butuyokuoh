// 自信が低く、ブランドの無い靴・バッグ・服だけ gemini-3.5-flash を足す。
// 1日15回で打ち切る。flash-lite の通常フォールバックはここを通らない。
import type { IdentifyInput } from './contract';
import { dominantTypeGroup, nameHasProductType } from './product-query';

export const FLASH_DAILY_CAP = 15;

const FASHION_GROUPS = new Set(['shoes', 'bags', 'shirts', 'jackets', 'jeans', 'caps', 'socks']);

export interface FlashLedger {
  tryConsume(now: number): boolean;
  used(now: number): number;
}

type GuessLike = {
  ok: boolean;
  value?: { confidence: string; products: { name: string; brand: string | null }[] };
};

export function createFlashLedger(cap = FLASH_DAILY_CAP): FlashLedger {
  let day = '';
  let used = 0;
  return {
    tryConsume(now: number) {
      const next = utcDay(now);
      if (next !== day) {
        day = next;
        used = 0;
      }
      if (used >= cap) return false;
      used += 1;
      return true;
    },
    used(now: number) {
      return utcDay(now) === day ? used : 0;
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
  const group = dominantTypeGroup(product.name);
  return group != null && FASHION_GROUPS.has(group);
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
  if (!flashImproves(input.guess.value, next)) return { guess: input.guess, usedFlash: true };
  return { guess: next as G, usedFlash: true };
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
