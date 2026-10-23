export type SortableListItem = {
  id: number;
  priority: number;
  comparison_group_id: number | null;
  comparison_group_origin?: string | null;
};

// 写真グループは1枚のカードなので、同じ優先度の中ではメンバーを一塊で動かす。
// 手で作ったグループと、グループに入っていない商品は1件ずつ動かす。
export function nextSortOrders(
  items: readonly SortableListItem[],
  activeId: number,
  overId: number,
): Map<number, number> | null {
  if (activeId === overId) return null;
  const active = items.find((item) => item.id === activeId);
  const over = items.find((item) => item.id === overId);
  if (!active || !over || active.priority !== over.priority) return null;

  const same = items.filter((item) => item.priority === active.priority);
  const seen = new Set<number>();
  const units: number[][] = [];
  for (const item of same) {
    if (seen.has(item.id)) continue;
    const photo = item.comparison_group_origin === 'photo' && item.comparison_group_id != null;
    const ids = photo
      ? same
        .filter((other) => other.comparison_group_id === item.comparison_group_id && other.comparison_group_origin === 'photo')
        .map((other) => other.id)
      : [item.id];
    for (const id of ids) seen.add(id);
    units.push(ids);
  }

  const from = units.findIndex((ids) => ids.includes(activeId));
  const to = units.findIndex((ids) => ids.includes(overId));
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...units];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const orders = new Map<number, number>();
  next.flat().forEach((id, index) => orders.set(id, index));
  return orders;
}
