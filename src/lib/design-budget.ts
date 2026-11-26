import type { Item } from '@/types';
import { idsForSelectAll, lineAmount } from './photo-spend';
import { comparePurchaseTiming, purchaseTimingMonth } from './purchase-timing';

// Stored dates can predate UI validation. Keep their value intact while rendering safely.
export function scheduleCalendarDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function budgetSelectionState(items: readonly Item[], selected: ReadonlySet<number>): boolean | 'mixed' {
  const checked = items.filter(item => selected.has(item.id));
  if (!checked.length) return false;
  const defaults = idsForSelectAll([...items]);
  return defaults.length > 0 && defaults.length === checked.length && defaults.every(id => selected.has(id)) ? true : 'mixed';
}

export function toggleBudgetSelection(items: readonly Item[], selected: ReadonlySet<number>): Set<number> {
  const next = new Set(selected);
  const clear = budgetSelectionState(items, selected) === true;
  for (const item of items) next.delete(item.id);
  if (!clear) for (const id of idsForSelectAll([...items])) next.add(id);
  return next;
}

export function reconcileBudgetSelection(previous: readonly Item[] | null, items: readonly Item[], selected: ReadonlySet<number>): Set<number> {
  if (previous === null) return new Set(idsForSelectAll([...items]));
  const ids = new Set(items.map(item => item.id));
  const previousIds = new Set(previous.map(item => item.id));
  const next = new Set([...selected].filter(id => ids.has(id)));
  for (const item of items) if (!previousIds.has(item.id) && item.countsInTotal !== false) next.add(item.id);
  // 店の切り替えでは、商品のチェック状態を新しい計上先に引き継ぐ。
  for (const before of previous) {
    if (before.group_origin !== 'photo' || before.comparison_group_id == null || before.countsInTotal === false || !selected.has(before.id)) continue;
    const after = items.find(item => item.group_origin === 'photo' && item.comparison_group_id === before.comparison_group_id && item.countsInTotal !== false);
    if (after && after.id !== before.id) { next.delete(before.id); next.add(after.id); }
  }
  return next;
}

export interface ScheduleBudgetData {
  [month: string]: { items: Item[]; total: number };
}
export function timingBudget(items:readonly Item[]):ScheduleBudgetData {
  const result:ScheduleBudgetData={};
  for(const item of items) {
    const key=purchaseTimingMonth(item)||'undated';
    const section=result[key]??={items:[],total:0};
    section.items.push(item);
    if(item.countsInTotal!==false) section.total+=lineAmount(item.current_price,item.quantity);
  }
  return result;
}
export interface ScheduleBudgetRow {
  key: string;
  name: string;
  item: Item;
  monthItems: Item[];
  offers: Item[];
  chooseGroupId: number | null;
}

export function scheduleBudgetRows(entries: readonly Item[], all: readonly Item[]): ScheduleBudgetRow[] {
  const rows = new Map<string, Item[]>();
  for (const item of entries) {
    const photo = item.group_origin === 'photo' && item.comparison_group_id != null;
    const key = photo ? 'photo-' + item.comparison_group_id : 'item-' + item.id;
    const peers = rows.get(key) ?? [];
    peers.push(item);
    rows.set(key, peers);
  }
  return [...rows].map(([key, monthItems]) => {
    const first = monthItems[0];
    const photo = first.group_origin === 'photo' && first.comparison_group_id != null;
    const offers = photo ? all.filter(item => item.group_origin === 'photo' && item.comparison_group_id === first.comparison_group_id) : monthItems;
    const item = monthItems.find(item => item.countsInTotal !== false) ?? first;
    return { key, name: (photo && (first.comparison_group_name || item.comparison_group_name)) || item.name,
      item, monthItems, offers, chooseGroupId: photo && offers.length > 1 ? first.comparison_group_id : null };
  }).sort((a,b) => comparePurchaseTiming(a.item,b.item) || a.item.id-b.item.id);
}
