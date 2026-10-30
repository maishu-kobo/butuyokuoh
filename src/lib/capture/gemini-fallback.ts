// llama 4 のあと、読めないときと検索が 0 件のときだけ Gemini lite を足す。
// 自信が低いだけでは呼ばない。Gemini が失敗するか、その検索も 0 件なら llama 4 を残す。
// 既定では使わない。CAPTURE_AI_MODEL=llama4-gemini-fallback のときだけ。
// 評価ハーネスもこの関数を使う。
import {
  captureFailure,
  CaptureMessages,
  decodeCapturePhoto,
  type IdentifyInput,
  type IdentifyResponse,
  type ProductGuess,
  type ProductIdentifier,
} from './contract';
import { createGeminiIdentifier, GEMINI_LITE_MODEL, geminiConfigFromEnv, type GeminiHttp } from './gemini';
import { httpsReferer, resolveSearchPorts } from './live-search';
import { searchWithLadder } from './search-ladder';
import { appAiBudget, createWorkersAiIdentifier, type AiBudget, type WorkersAiHttp } from './workers-ai';

export const LLAMA4_GEMINI_FALLBACK = 'llama4-gemini-fallback';
export const LLAMA4_MODEL_ID = '@cf/meta/llama-4-scout-17b-16e-instruct';

const MODEL_ENV = 'CAPTURE_AI_MODEL';
const KEY_ENV = 'GEMINI_API_KEY';

export type FallbackGuess = {
  ok: boolean;
  error?: { code: string };
  value?: IdentifyResponse;
  status?: number;
};

export function usableProduct(result: FallbackGuess): ProductGuess | null {
  if (!result.ok || !result.value) return null;
  if (result.value.confidence === 'unreadable') return null;
  const product = result.value.products[0];
  if (!product?.name.trim()) return null;
  return product;
}

// 検索の前に Gemini を呼ぶのは、llama 4 が失敗したか、使える商品名が無いときだけ。
// unsure や、種類が特定できない sure では呼ばない。上限で止まったときは呼ばない。
export function needsGeminiBeforeSearch(result: FallbackGuess): boolean {
  if (!result.ok) return result.error?.code !== 'AI_LIMIT';
  return usableProduct(result) === null;
}

export type LadderSearchResult<T> = { hits: number; value: T; failed?: boolean };

export async function runGeminiFallback<T, G extends FallbackGuess>(input: {
  photo: IdentifyInput;
  primary: { identify(photo: IdentifyInput): Promise<G> };
  gemini: { identify(photo: IdentifyInput): Promise<G> } | null;
  search: (product: ProductGuess) => Promise<LadderSearchResult<T>>;
}): Promise<{ guess: G; found: LadderSearchResult<T> | null; usedGemini: boolean }> {
  const primary = await input.primary.identify(input.photo);
  if (!primary.ok && primary.error?.code === 'AI_LIMIT') {
    return { guess: primary, found: null, usedGemini: false };
  }
  const primaryProduct = usableProduct(primary);
  if (!primaryProduct) {
    return adoptGemini(input, primary, null);
  }
  const primarySearch = await input.search(primaryProduct);
  // 店の障害・レート制限は 0 件と区別する。障害時は Gemini で置き換えない。
  if (primarySearch.failed || primarySearch.hits > 0 || !input.gemini) {
    return { guess: primary, found: primarySearch, usedGemini: false };
  }
  return adoptGemini(input, primary, primarySearch);
}

async function adoptGemini<T, G extends FallbackGuess>(
  input: {
    photo: IdentifyInput;
    gemini: { identify(photo: IdentifyInput): Promise<G> } | null;
    search: (product: ProductGuess) => Promise<LadderSearchResult<T>>;
  },
  primary: G,
  primarySearch: LadderSearchResult<T> | null,
): Promise<{ guess: G; found: LadderSearchResult<T> | null; usedGemini: boolean }> {
  const keep = { guess: primary, found: primarySearch, usedGemini: false };
  if (!input.gemini) return keep;
  const second = await input.gemini.identify(input.photo);
  if (!second.ok) return keep;
  const product = usableProduct(second);
  if (!product) return keep;
  const geminiSearch = await input.search(product);
  if (geminiSearch.failed || geminiSearch.hits <= 0) return keep;
  return { guess: second, found: geminiSearch, usedGemini: true };
}

export function llama4GeminiActors(input: {
  hooked: boolean;
  fake: ProductIdentifier;
  env?: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string };
  geminiEnv?: { CAPTURE_AI_MODEL?: string; GEMINI_API_KEY?: string };
  accountId: string | null;
  apiToken: string | null;
  userId: string;
  budget?: AiBudget;
  workersHttp?: WorkersAiHttp;
  geminiHttp?: GeminiHttp;
}): { kind: 'fake'; identify: ProductIdentifier } | { kind: 'live'; primary: ProductIdentifier; gemini: ProductIdentifier | null } | null {
  const source = (input.geminiEnv ?? process.env) as Record<string, string | undefined>;
  const selectedRaw = source[MODEL_ENV];
  const selected = typeof selectedRaw === 'string' ? selectedRaw.trim() : '';
  if (selected !== LLAMA4_GEMINI_FALLBACK) return null;
  const testMode = input.env?.NODE_ENV !== 'production' && input.env?.CAPTURE_TEST_HOOKS === '1';
  if (testMode && input.hooked) return { kind: 'fake', identify: input.fake };
  if (!input.accountId || !input.apiToken) {
    return { kind: 'fake', identify: unavailable() };
  }
  const primary = createWorkersAiIdentifier({
    accountId: input.accountId,
    apiToken: input.apiToken,
    userId: input.userId,
    model: LLAMA4_MODEL_ID,
    budget: input.budget ?? appAiBudget(),
    http: input.workersHttp,
  });
  const keyRaw = source[KEY_ENV];
  const geminiEnv = geminiConfigFromEnv({
    CAPTURE_AI_MODEL: 'gemini-lite',
    GEMINI_API_KEY: typeof keyRaw === 'string' ? keyRaw : undefined,
  });
  const gemini = geminiEnv?.apiKey
    ? createGeminiIdentifier({ apiKey: geminiEnv.apiKey, model: GEMINI_LITE_MODEL, http: input.geminiHttp })
    : null;
  return { kind: 'live', primary, gemini };
}

export async function productionLadderSearch(
  product: ProductGuess,
  input: {
    yahooAppId: string | null;
    rakutenAppId: string | null;
    rakutenAccessKey: string | null;
    rakutenAffiliateId: string | null;
    userId: string;
    origin: string | null;
    associateTag: string | null;
  },
): Promise<LadderSearchResult<null>> {
  const ports = resolveSearchPorts({
    yahooAppId: input.yahooAppId,
    rakutenAppId: input.rakutenAppId,
    rakutenAccessKey: input.rakutenAccessKey,
    rakutenAffiliateId: input.rakutenAffiliateId,
    userId: input.userId,
    referer: httpsReferer(input.origin),
  });
  const result = await searchWithLadder(product, ports, input.associateTag);
  if (!result.ok) return { hits: 0, value: null, failed: true };
  return { hits: result.value.candidates.length, value: null };
}

function unavailable(): ProductIdentifier {
  return {
    async identify(photo: IdentifyInput) {
      const decoded = decodeCapturePhoto([{ mediaType: photo.mediaType, bytes: photo.bytes }]);
      if (!decoded.ok) return decoded;
      return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
    },
  };
}
