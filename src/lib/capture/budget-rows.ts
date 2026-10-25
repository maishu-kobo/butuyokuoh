// 出費予定の行。写真のショップが2件以上あるときだけ「合計に数える」を出す。
// 1件の写真グループと、手で作った商品は、普通の行のまま。見出しやインデントは付けない。

export interface BudgetListItem {
  comparison_group_id: number | null;
  group_origin?: string | null;
}

export interface BudgetLine<T> {
  item: T;
  chooseGroupId: number | null;
}

export function budgetRows<T extends BudgetListItem>(visible: readonly T[], all: readonly T[] = visible): BudgetLine<T>[] {
  const size = new Map<number, number>();
  for (const item of all) {
    if (item.group_origin !== 'photo' || item.comparison_group_id == null) continue;
    size.set(item.comparison_group_id, (size.get(item.comparison_group_id) ?? 0) + 1);
  }
  return visible.map((item) => {
    const groupId = item.comparison_group_id;
    const multi = item.group_origin === 'photo' && groupId != null && (size.get(groupId) ?? 0) >= 2;
    return { item, chooseGroupId: multi ? groupId : null };
  });
}
