import type { Item } from '../types';
import type { HomeListQuery } from './home-wishlist';

export type ItemPage = {
  items: Item[]; revision: string; totalCount: number; matchedCount: number; rowCount: number;
  totalAmount: number; lowestPriceInGroup: number | null; matchedIds: number[]; allIds: number[];
  nextCursor: string | null;
};
export type ItemPageState = {
  key: string; page: ItemPage | null; loading: boolean; error: boolean;
  moreLoading: boolean; moreError: boolean; notice: string;
};
export const emptyItemPageState = (key = ''): ItemPageState => ({
  key, page: null, loading: true, error: false, moreLoading: false, moreError: false, notice: '',
});
export function itemPageKey(query: HomeListQuery, userId: number | null): string {
  return JSON.stringify([userId, query]);
}
export function itemPageParams(query: HomeListQuery): URLSearchParams {
  const params = new URLSearchParams({ sort: query.sortBy, q: query.searchQuery, limit: '50' });
  if (query.selectedCategory) params.set('category', String(query.selectedCategory));
  if (query.selectedPriority) params.set('priority', String(query.selectedPriority));
  if (query.selectedGroup) params.set('group', String(query.selectedGroup));
  return params;
}

// One owner for request generations; even a transport that ignores abort cannot
// overwrite a changed filter or append the same page twice.
export class ItemPageClient {
  private state = emptyItemPageState();
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort: AbortController | null = null;
  private query: HomeListQuery | null = null;
  constructor(private transport: (url: string, signal: AbortSignal) => Promise<Response>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: ItemPageState) { this.state = next; this.listeners.forEach(listener => listener()); }
  cancel = () => { this.generation++; this.abort?.abort(); this.abort = null; };
  open = async (query: HomeListQuery, userId: number) => {
    this.query = query;
    this.publish(emptyItemPageState(itemPageKey(query, userId)));
    await this.reload();
  };
  reload = async () => { await this.request(false); };
  more = async () => {
    if (this.state.loading || this.state.moreLoading || !this.state.page?.nextCursor) return;
    await this.request(true);
  };
  private async request(append: boolean) {
    if (!this.query) return;
    this.cancel();
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    const previous = this.state.page;
    const params = itemPageParams(this.query);
    if (append && previous?.nextCursor) params.set('cursor', previous.nextCursor);
    this.publish({ ...this.state, page: append ? previous : null, loading: !append,
      error: false, moreLoading: append, moreError: false });
    try {
      const response = await this.transport('/api/items/page?' + params, abort.signal);
      if (generation !== this.generation) return;
      if (append && response.status === 409) {
        this.publish({ ...this.state, notice: '一覧が変更されたため先頭から読み込み直しました。' });
        await this.reload();
        return;
      }
      if (!response.ok) throw new Error('Item page request failed');
      const page = await response.json() as ItemPage;
      if (generation !== this.generation) return;
      if (!Array.isArray(page.items) || !Array.isArray(page.matchedIds) || !Array.isArray(page.allIds)
          || typeof page.revision !== 'string' || !Number.isSafeInteger(page.totalCount)
          || !Number.isSafeInteger(page.matchedCount) || typeof page.totalAmount !== 'number'
          || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('Invalid item page');
      if (append && previous && previous.revision !== page.revision) throw new Error('Inconsistent item revision');
      const items = append && previous ? [...previous.items, ...page.items] : page.items;
      if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate page items');
      this.publish({ ...this.state, page: { ...page, items }, loading: false, error: false, moreLoading: false, moreError: false });
    } catch {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, loading: false, error: !append, moreLoading: false, moreError: append });
    }
  }
}
