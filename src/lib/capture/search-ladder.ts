// 0件のときだけ、種類を残した短い検索語を足す。1件でもあれば広げない。
import { searchWithPorts } from './fakes';
import { sortCandidates, type CapturePorts, type CaptureResult, type SearchQuery, type SearchResponse } from './contract';
import { searchLadderSteps } from './product-query';

export async function searchWithLadder(
  product: { name: string; brand: string | null; model: string | null },
  ports: CapturePorts,
  associateTag?: string | null,
): Promise<CaptureResult<SearchResponse>> {
  const steps = searchLadderSteps(product);
  if (steps.length === 0) return searchWithPorts({ name: product.name, brand: product.brand, model: product.model, jan: null }, ports, associateTag);
  const merged: SearchResponse['candidates'] = [];
  const seen = new Set<string>();
  let amazonUrl = '';
  const failures: SearchResponse['failures'] = [];
  let rank: SearchQuery = { ...steps[0], jan: null };
  for (const step of steps) {
    const query: SearchQuery = { ...step, jan: null };
    const result = await searchWithPorts(query, ports, associateTag);
    if (!result.ok) {
      if (merged.length > 0) break;
      return result;
    }
    amazonUrl = result.value.amazonUrl;
    for (const failure of result.value.failures) {
      if (!failures.some((item) => item.site === failure.site && item.code === failure.code)) failures.push(failure);
    }
    for (const candidate of result.value.candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      merged.push(candidate);
    }
    if (merged.length > 0) {
      rank = query;
      break;
    }
  }
  return {
    ok: true,
    value: {
      candidates: sortCandidates(merged, rank),
      amazonUrl,
      failures,
    },
  };
}
