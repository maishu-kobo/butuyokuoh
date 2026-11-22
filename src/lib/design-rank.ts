import type { ReviewProduct } from './design-home';

export type Timing = 'by' | 'around';
export interface BuyGuide { month: string; timing: Timing; condition: string }
export type RankScope = 'all' | 'priority';
export type MoveAction = { action:'move'; itemId:number; targetId:number; side:'before'|'after'; scope:RankScope };
export type GuideAction = { action:'guide'; itemId:number; priority:number } & BuyGuide;
export const priorityNames = ['', '最高', '高', '普通', '低', '最低'] as const;
export const priorityLevels = [1,2,3,4,5] as const;

// Shop selection must not change the product's shared priority.
export function rankItem(product:ReviewProduct) {
  return product.offers.filter(offer=>!offer.is_purchased).reduce((first,offer)=>offer.id<first.id ? offer : first);
}

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseRankAction(value: unknown): MoveAction | GuideAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string,unknown>;
  const {action,itemId,targetId,side,scope,priority,month,timing,condition} = input;
  if (!validId(itemId)) return null;
  if (action === 'move' && validId(targetId) && (side === 'before' || side === 'after') && (scope === 'all' || scope === 'priority')) {
    return {action,itemId,targetId,side,scope};
  }
  if (action === 'guide' && validId(priority) && priority <= 5 && typeof month === 'string' &&
    (month === '' || /^[1-9]\d{3}-(0[1-9]|1[012])$/.test(month)) && (timing === 'by' || timing === 'around') &&
    typeof condition === 'string' && condition.length <= 240) {
    return {action,itemId,priority,month,timing,condition:condition.trim()};
  }
  return null;
}

export function monthCaption(month: string, timing: Timing, currentYear = new Date().getFullYear()): string {
  if (!month) return '';
  const [year,number] = month.split('-').map(Number);
  return (year === currentYear ? '' : year+'年') + number + '月' + (timing === 'by' ? 'まで' : 'ごろ');
}

export function rankedProducts(products: ReviewProduct[]): ReviewProduct[] {
  const rank = (p:ReviewProduct) => Math.min(...p.offers.filter(i => !i.is_purchased).map(i => i.sort_order ?? 0));
  const firstId = (p:ReviewProduct) => Math.min(...p.offers.filter(i => !i.is_purchased).map(i => i.id));
  return [...products].sort((a,b) => rank(a)-rank(b) || firstId(a)-firstId(b));
}
