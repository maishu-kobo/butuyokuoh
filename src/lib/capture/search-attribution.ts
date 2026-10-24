import type { CaptureResult, SearchResponse } from './contract';

export interface SearchAttribution {
  yahoo: boolean;
  rakuten: boolean;
}

// Return only public provider flags, never credentials. Zero results and outages
// still use the configured service; missing configuration does not.
export function searchAttribution(result: CaptureResult<SearchResponse>): SearchAttribution {
  const failures = result.ok ? result.value.failures : result.error.failures ?? [];
  return {
    yahoo: !failures.some((failure) => failure.site === 'yahoo' && failure.code === 'SEARCH_NOT_CONFIGURED'),
    rakuten: !failures.some((failure) => failure.site === 'rakuten' && failure.code === 'SEARCH_NOT_CONFIGURED'),
  };
}

export function amazonAffiliateLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.amazon.co.jp' && url.pathname === '/s'
      && !url.username && !url.password
      && /^[a-zA-Z0-9-]{1,100}$/.test(url.searchParams.get('tag') ?? '');
  } catch {
    return false;
  }
}
