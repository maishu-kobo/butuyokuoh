// 絞り込みと並びのあとに、画面へ出す件数だけを決める。APIも並びの保存も変えない。
import { nextSortOrders, type SortableListItem } from '@/lib/capture/list-order';
import type { HomeListQuery } from '@/lib/home-wishlist';

export const HOME_LIST_PAGE_SIZE = 50;

export type HomeListPage = {
  shown: number;
};

type ItemRow<T extends { id: number }> = {
  kind: 'item';
  item: T;
};

type PhotoRow = {
  kind: 'photo';
  itemIds: readonly number[];
};

export type HomeListRow<T extends { id: number }> = ItemRow<T> | PhotoRow;

export function createHomeListPage(): HomeListPage {
  return { shown: HOME_LIST_PAGE_SIZE };
}

export function visibleHomeItems<T>(items: readonly T[], page: HomeListPage): T[] {
  return items.slice(0, page.shown);
}

export function homeListHasMore(page: HomeListPage, total: number): boolean {
  return page.shown < total;
}

export function reduceHomeListPage(
  page: HomeListPage,
  action: { type: 'show-more'; total: number } | { type: 'query-changed' },
): HomeListPage {
  if (action.type === 'query-changed') return createHomeListPage();
  if (page.shown >= action.total) return page;
  return { shown: Math.min(page.shown + HOME_LIST_PAGE_SIZE, action.total) };
}

export function homeListQueryPageKey(query: HomeListQuery): string {
  return JSON.stringify([
    query.selectedCategory,
    query.selectedPriority,
    query.selectedGroup,
    query.searchQuery,
    query.sortBy,
  ]);
}

export function alignHomeListPage(
  state: { key: string; page: HomeListPage },
  queryKey: string,
): { key: string; page: HomeListPage } {
  if (state.key === queryKey) return state;
  return { key: queryKey, page: reduceHomeListPage(state.page, { type: 'query-changed' }) };
}

export function selectAllFilteredIds(items: readonly { id: number }[]): number[] {
  return items.map((item) => item.id);
}

// 画面外の行も渡す。同じ優先度のうしろにいるアイテムの位置を残すため。
export function homeListDragOrders<T extends SortableListItem>(
  items: readonly T[],
  activeId: number,
  overId: number,
): Map<number, number> | null {
  return nextSortOrders(items, activeId, overId);
}

export function visibleWishlistRows<T extends { id: number }, Row extends HomeListRow<T>>(
  filteredItems: readonly T[],
  wishlist: readonly Row[],
  page: HomeListPage,
): Row[] {
  const visibleIds = new Set(visibleHomeItems(filteredItems, page).map((item) => item.id));
  const rows: Row[] = [];
  for (const row of wishlist) {
    if (row.kind === 'item') {
      if (visibleIds.has(row.item.id)) rows.push(row);
      continue;
    }
    if (row.itemIds.length > 0 && row.itemIds.every((id) => visibleIds.has(id))) {
      rows.push(row);
      continue;
    }
    for (const id of row.itemIds) {
      if (!visibleIds.has(id)) continue;
      const item = filteredItems.find((entry) => entry.id === id);
      if (!item) continue;
      rows.push({ kind: 'item', item } as Row);
    }
  }
  return rows;
}
