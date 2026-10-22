// 写真から作った比較グループだけ、合計に入れる候補を1件に絞る。
// 手で作ったグループと、グループに入っていない商品は、今までどおり全部数える。

export const EXCLUDED_FROM_TOTAL_LABEL = '合計に含まない';

export interface SpendItem {
  id: number;
  userId: number;
  price: number | null;
  quantity: number | null;
  purchased: boolean;
  deleted: boolean;
  groupId: number | null;
}

export interface SpendGroup {
  id: number;
  userId: number;
  origin: string | null;
  budgetItemId: number | null;
}

export interface SpendDecision {
  countsInTotal: boolean;
  totalLabel: string | null;
  amount: number;
}

interface SpendDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

interface ItemRow {
  id: number;
  user_id: number;
  current_price: number | null;
  quantity: number | null;
  is_purchased: number | boolean;
  deleted_at: string | null;
  comparison_group_id: number | null;
}

interface GroupRow {
  id: number;
  user_id: number;
  origin: string | null;
  budget_item_id: number | null;
}

export function lineAmount(price: number | null | undefined, quantity: number | null | undefined): number {
  return (price || 0) * (quantity || 1);
}

export function photoSpendDecisions(items: SpendItem[], groups: SpendGroup[]): Map<number, SpendDecision> {
  const groupById = new Map(groups.map((entry) => [entry.id, entry]));
  const membersByGroup = new Map<number, SpendItem[]>();
  for (const entry of items) {
    if (entry.groupId == null) continue;
    const list = membersByGroup.get(entry.groupId) ?? [];
    list.push(entry);
    membersByGroup.set(entry.groupId, list);
  }

  const counted = new Set<number>();
  for (const [groupId, members] of membersByGroup) {
    const owner = groupById.get(groupId);
    if (!owner || owner.origin !== 'photo') continue;
    const active = members.filter((entry) => !entry.deleted && entry.userId === owner.userId);
    const purchased = active.filter((entry) => entry.purchased);
    if (purchased.length > 0) {
      for (const entry of purchased) counted.add(entry.id);
      continue;
    }
    const open = active.filter((entry) => !entry.purchased);
    const chosen = open.find((entry) => entry.id === owner.budgetItemId);
    if (chosen) {
      counted.add(chosen.id);
      continue;
    }
    const cheapest = [...open].sort((left, right) => {
      const leftPrice = left.price == null ? Number.POSITIVE_INFINITY : left.price;
      const rightPrice = right.price == null ? Number.POSITIVE_INFINITY : right.price;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
      return left.id - right.id;
    })[0];
    if (cheapest) counted.add(cheapest.id);
  }

  const decisions = new Map<number, SpendDecision>();
  for (const entry of items) {
    const owner = entry.groupId == null ? undefined : groupById.get(entry.groupId);
    const photo = owner?.origin === 'photo' && owner.userId === entry.userId;
    if (entry.deleted) {
      decisions.set(entry.id, { countsInTotal: false, totalLabel: null, amount: 0 });
      continue;
    }
    if (!photo) {
      decisions.set(entry.id, {
        countsInTotal: true,
        totalLabel: null,
        amount: lineAmount(entry.price, entry.quantity),
      });
      continue;
    }
    const include = counted.has(entry.id);
    decisions.set(entry.id, {
      countsInTotal: include,
      totalLabel: include ? null : EXCLUDED_FROM_TOTAL_LABEL,
      amount: include ? lineAmount(entry.price, entry.quantity) : 0,
    });
  }
  return decisions;
}

export function moneyTotals(items: SpendItem[], decisions: Map<number, SpendDecision>): {
  wishlistTotal: number;
  purchasedTotal: number;
} {
  let wishlistTotal = 0;
  let purchasedTotal = 0;
  for (const entry of items) {
    if (entry.deleted) continue;
    const decision = decisions.get(entry.id);
    if (!decision?.countsInTotal) continue;
    if (entry.purchased) purchasedTotal += decision.amount;
    else wishlistTotal += decision.amount;
  }
  return { wishlistTotal, purchasedTotal };
}

export function sumCountedPrices(items: {
  current_price?: number | null;
  quantity?: number | null;
  countsInTotal?: boolean;
}[]): number {
  return items.reduce((sum, entry) => {
    if (entry.countsInTotal === false) return sum;
    return sum + lineAmount(entry.current_price, entry.quantity);
  }, 0);
}

export function idsForSelectAll(items: { id: number; countsInTotal?: boolean }[]): number[] {
  return items.filter((entry) => entry.countsInTotal !== false).map((entry) => entry.id);
}

export function annotateSpend<T extends { id: number }>(
  items: T[],
  decisions: Map<number, SpendDecision>,
): Array<T & { countsInTotal: boolean; totalLabel: string | null }> {
  return items.map((entry) => {
    const decision = decisions.get(entry.id);
    return {
      ...entry,
      countsInTotal: decision ? decision.countsInTotal : true,
      totalLabel: decision ? decision.totalLabel : null,
    };
  });
}

export function userSpendInput(database: SpendDb, userId: number): [SpendItem[], SpendGroup[]] {
  const items = database.prepare(`
    SELECT id, user_id, current_price, quantity, is_purchased, deleted_at, comparison_group_id
    FROM items
    WHERE user_id = ?
  `).all(userId) as ItemRow[];
  const groups = database.prepare(`
    SELECT id, user_id, origin, budget_item_id
    FROM comparison_groups
    WHERE user_id = ?
  `).all(userId) as GroupRow[];
  return [
    items.map((row) => ({
      id: row.id,
      userId: row.user_id,
      price: row.current_price,
      quantity: row.quantity,
      purchased: row.is_purchased === true || row.is_purchased === 1,
      deleted: Boolean(row.deleted_at),
      groupId: row.comparison_group_id,
    })),
    groups.map((row) => ({
      id: row.id,
      userId: row.user_id,
      origin: row.origin,
      budgetItemId: row.budget_item_id,
    })),
  ];
}
