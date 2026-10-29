// 片方の店が0件か失敗なら、種類の検索語を足す。種類の違う候補は出さない。
import { searchWithPorts } from './fakes';
import {
  sortCandidates,
  type CaptureCandidate,
  type CapturePorts,
  type CaptureResult,
  type SearchQuery,
  type SearchResponse,
} from './contract';
import { dropOtherCategories, searchLadderSteps } from './product-query';

function siteCount(items: readonly CaptureCandidate[], site: CaptureCandidate['site']): number {
  return items.filter((item) => item.site === site).length;
}

export async function searchWithLadder(
  product: { name: string; brand: string | null; model: string | null },
  ports: CapturePorts,
  associateTag?: string | null,
): Promise<CaptureResult<SearchResponse>> {
  const steps = searchLadderSteps(product);
  const queries = steps.length > 0
    ? steps
    : [{ name: product.name, brand: product.brand, model: product.model, jan: null as null }];
  const merged: CaptureCandidate[] = [];
  const seen = new Set<string>();
  let amazonUrl = '';
  const failures: SearchResponse['failures'] = [];
  let rank: SearchQuery = { name: product.name, brand: product.brand, model: product.model, jan: null };
  let lastError: CaptureResult<SearchResponse> | null = null;
  for (const step of queries) {
    const query: SearchQuery = { ...step, jan: null };
    const result = await searchWithPorts(query, ports, associateTag);
    if (!result.ok) {
      lastError = result;
      for (const failure of result.error.failures ?? []) {
        if (!failures.some((item) => item.site === failure.site && item.code === failure.code)) failures.push(failure);
      }
      continue;
    }
    amazonUrl = result.value.amazonUrl;
    for (const failure of result.value.failures) {
      if (!failures.some((item) => item.site === failure.site && item.code === failure.code)) failures.push(failure);
    }
    const kept = dropOtherCategories(result.value.candidates, product.name);
    for (const candidate of kept) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      merged.push(candidate);
    }
    rank = query;
    const yahooDown = result.value.failures.some((failure) => failure.site === 'yahoo') || siteCount(kept, 'yahoo') === 0;
    const rakutenDown = result.value.failures.some((failure) => failure.site === 'rakuten') || siteCount(kept, 'rakuten') === 0;
    if (!yahooDown && !rakutenDown) break;
  }
  if (merged.length === 0 && lastError && !lastError.ok) return lastError;
  return {
    ok: true,
    value: {
      candidates: sortCandidates(merged, rank),
      amazonUrl,
      failures,
    },
  };
}
