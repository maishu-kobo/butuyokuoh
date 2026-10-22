// キーも通信も使わない偽物。あとから本物の判定と検索に差し替える。
import {
  CaptureMessages,
  acceptCandidate,
  amazonSearchUrl,
  captureFailure,
  decodeCapturePhoto,
  sortCandidates,
  type CaptureCandidate,
  type CapturePorts,
  type CaptureResult,
  type CaptureSite,
  type IdentifyResponse,
  type ProductGuess,
  type SearchQuery,
  type SearchResponse,
  type SiteFailure,
} from './contract';

export const FAKE_SCENARIOS = [
  'default',
  'unsure',
  'unreadable',
  'ai-timeout',
  'ai-unavailable',
  'ai-invalid',
  'yahoo-down',
  'rakuten-down',
  'both-down',
  'empty',
] as const;

export type FakeScenario = typeof FAKE_SCENARIOS[number];

export function isFakeScenario(value: string): value is FakeScenario {
  return (FAKE_SCENARIOS as readonly string[]).includes(value);
}

const SURE_PRODUCT: ProductGuess = {
  name: 'テスト用ゲルボールペン 0.5',
  brand: '物欲文具',
  model: 'BY-05',
  jan: '4900000000009',
};

const UNSURE_PRODUCTS: ProductGuess[] = [
  SURE_PRODUCT,
  { name: 'テスト用油性ボールペン 0.7', brand: '物欲文具', model: 'BY-07', jan: null },
  { name: 'テスト用サインペン', brand: null, model: null, jan: null },
];

export function createFakePorts(scenario: FakeScenario = 'default', now: () => Date = () => new Date()): CapturePorts {
  return {
    identifier: {
      async identify(input) {
        const photo = decodeCapturePhoto([{ mediaType: input.mediaType, bytes: input.bytes }]);
        if (!photo.ok) return photo;
        if (scenario === 'ai-timeout') return captureFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
        if (scenario === 'ai-unavailable') return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
        if (scenario === 'ai-invalid') return captureFailure('AI_INVALID_RESPONSE', CaptureMessages.aiFailed, 502);
        const value: IdentifyResponse = scenario === 'unreadable'
          ? { confidence: 'unreadable', products: [] }
          : scenario === 'unsure'
            ? { confidence: 'unsure', products: UNSURE_PRODUCTS }
            : { confidence: 'sure', products: [SURE_PRODUCT] };
        return { ok: true, value };
      },
    },
    yahoo: fakeSearch('yahoo', scenario, now),
    rakuten: fakeSearch('rakuten', scenario, now),
  };
}

function fakeSearch(site: CaptureSite, scenario: FakeScenario, now: () => Date): CapturePorts['yahoo'] {
  return {
    async search(query) {
      const outcome = siteOutcome(site, scenario);
      if (outcome === 'fail') return captureFailure('SEARCH_FAILED', CaptureMessages.searchFailed, 502);
      if (outcome === 'timeout') return captureFailure('SEARCH_TIMEOUT', CaptureMessages.searchFailed, 504);
      if (outcome === 'empty') return { ok: true, value: [] };
      return { ok: true, value: [fakeCandidate(site, query, now().toISOString())] };
    },
  };
}

function siteOutcome(site: CaptureSite, scenario: FakeScenario): 'ok' | 'empty' | 'fail' | 'timeout' {
  if (scenario === 'empty') return 'empty';
  if (scenario === 'both-down') return 'fail';
  if (site === 'yahoo' && scenario === 'yahoo-down') return 'fail';
  if (site === 'rakuten' && scenario === 'rakuten-down') return 'timeout';
  return 'ok';
}

function fakeCandidate(site: CaptureSite, query: SearchQuery, fetchedAt: string): CaptureCandidate {
  const item: CaptureCandidate = {
    id: site === 'yahoo' ? 'yahoo:fake-pen' : 'rakuten:fake-pen',
    site,
    title: query.name || (query.jan ? `JAN ${query.jan}` : '商品'),
    price: site === 'yahoo' ? 980 : 1200,
    url: site === 'yahoo'
      ? 'https://store.shopping.yahoo.co.jp/example/pen'
      : 'https://item.rakuten.co.jp/example/pen',
    fetchedAt,
    shopName: site === 'yahoo' ? 'テストショップ' : 'テスト楽天店',
  };
  if (query.jan) item.jan = query.jan;
  return item;
}

export async function searchWithPorts(query: SearchQuery, ports: CapturePorts, associateTag?: string | null): Promise<CaptureResult<SearchResponse>> {
  const [yahoo, rakuten] = await Promise.all([
    settle(ports.yahoo, query),
    settle(ports.rakuten, query),
  ]);
  const failures: SiteFailure[] = [];
  const candidates: CaptureCandidate[] = [];
  for (const [site, result] of [['yahoo', yahoo], ['rakuten', rakuten]] as const) {
    if (!result.ok) {
      failures.push({ site, code: result.error.code, error: result.error.error });
      continue;
    }
    const accepted = result.value.map(acceptCandidate).filter((item): item is CaptureCandidate => item !== null);
    if (result.value.length > 0 && accepted.length === 0) {
      failures.push({ site, code: 'SEARCH_FAILED', error: CaptureMessages.searchFailed });
      continue;
    }
    candidates.push(...accepted);
  }
  if (failures.length === 2) {
    const timedOut = failures.every(failure => failure.code === 'SEARCH_TIMEOUT');
    return captureFailure(
      timedOut ? 'SEARCH_TIMEOUT' : 'SEARCH_FAILED',
      CaptureMessages.searchFailed,
      timedOut ? 504 : 502,
      failures,
    );
  }
  return {
    ok: true,
    value: {
      candidates: sortCandidates(candidates, query),
      amazonUrl: amazonSearchUrl(query, associateTag),
      failures,
    },
  };
}

async function settle(search: CapturePorts['yahoo'], query: SearchQuery): Promise<CaptureResult<CaptureCandidate[]>> {
  try {
    return await search.search(query);
  } catch {
    return captureFailure('SEARCH_FAILED', CaptureMessages.searchFailed, 502);
  }
}
