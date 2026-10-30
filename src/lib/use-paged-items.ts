'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { apiFetch } from './api-fetch';
import { emptyItemPageState, ItemPageClient, itemPageKey } from './item-page-client';
import type { HomeListQuery } from './home-wishlist';

export function usePagedItems(query: HomeListQuery, userId: number | null) {
  const [client] = useState(() => new ItemPageClient((url, signal) => apiFetch(url, { signal }, { notifyError: false })));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const key = itemPageKey(query, userId);
  useEffect(() => {
    if (userId != null) void client.open(query, userId);
    return client.cancel;
  }, [client, query, userId]);
  const visible = state.key === key ? state
    : userId != null && state.userId === userId
      ? { ...state, key, loading: true, error: false, moreLoading: false, moreError: false }
      : emptyItemPageState(key, userId);
  return { state: visible, reload: client.reload, more: client.more };
}
