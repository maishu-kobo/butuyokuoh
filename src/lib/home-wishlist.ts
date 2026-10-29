// ホームの一覧条件とタブ移動。page.tsx から分けても、画面の結果は変えない。

export const HOME_TABS = ['list', 'budget', 'purchased', 'stats', 'trash'] as const;

export type HomeTab = (typeof HOME_TABS)[number];

export type HomeSortBy = 'priority' | 'price_asc' | 'price_desc' | 'date_new' | 'date_old' | 'name';

export type HomeListQuery = {
  selectedCategory: number | null;
  selectedPriority: number | null;
  selectedGroup: number | null;
  searchQuery: string;
  sortBy: HomeSortBy;
};

type HomeFilterItem = {
  name: string;
  notes?: string | null;
  category_name?: string | null;
  category_id: number | null;
  priority: number;
  comparison_group_id: number | null;
  current_price?: number | null;
  created_at: string;
  sort_order?: number;
};

// 0 や空文字は未選択。価格が無いものは安い順・高い順のどちらでも末尾。
export function filterHomeItems<T extends HomeFilterItem>(items: readonly T[], query: HomeListQuery): T[] {
  const { selectedCategory, selectedPriority, selectedGroup, searchQuery, sortBy } = query;
  return items
    .filter((item) => {
      if (selectedCategory && item.category_id !== selectedCategory) return false;
      if (selectedPriority && item.priority !== selectedPriority) return false;
      if (selectedGroup && item.comparison_group_id !== selectedGroup) return false;
      if (searchQuery) {
        const needle = searchQuery.toLowerCase();
        return Boolean(
          item.name.toLowerCase().includes(needle)
          || item.notes?.toLowerCase().includes(needle)
          || item.category_name?.toLowerCase().includes(needle),
        );
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
        case 'price_desc': {
          const av = a.current_price;
          const bv = b.current_price;
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return sortBy === 'price_asc' ? av - bv : bv - av;
        }
        case 'date_new':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'date_old':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'name':
          return a.name.localeCompare(b.name, 'ja');
        case 'priority':
        default:
          if (a.priority !== b.priority) return a.priority - b.priority;
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      }
    });
}

export function homeDragEnabled(query: HomeListQuery): boolean {
  return query.sortBy === 'priority'
    && !query.selectedCategory
    && !query.selectedGroup
    && !query.selectedPriority
    && !query.searchQuery;
}

// 価格 0 は最安の候補に入れない。候補が無いときは Math.min() の Infinity のまま。
export function lowestPriceInSelectedGroup(
  selectedGroup: number | null,
  items: readonly { current_price?: number | null }[],
): number | null {
  if (!selectedGroup) return null;
  return Math.min(...items.filter((item) => item.current_price).map((item) => item.current_price!));
}

export function homeTabBySwipe(active: HomeTab, direction: 'left' | 'right'): HomeTab | null {
  const currentIndex = HOME_TABS.indexOf(active);
  if (direction === 'left') {
    return currentIndex < HOME_TABS.length - 1 ? HOME_TABS[currentIndex + 1] : null;
  }
  return currentIndex > 0 ? HOME_TABS[currentIndex - 1] : null;
}

export function homeTabAnimation(
  active: HomeTab,
  next: HomeTab,
  direction?: 'left' | 'right',
): 'slide-in-right' | 'slide-in-left' | null {
  if (next === active) return null;
  const currentIndex = HOME_TABS.indexOf(active);
  const newIndex = HOME_TABS.indexOf(next);
  const dir = direction || (newIndex > currentIndex ? 'left' : 'right');
  return dir === 'left' ? 'slide-in-right' : 'slide-in-left';
}
