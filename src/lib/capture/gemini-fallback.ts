// llama 4 のあと、読み取れないか自信が低いときだけ Gemini lite を足す。
// 既定では使わない。CAPTURE_AI_MODEL=llama4-gemini-fallback のときだけ。
// Gemini が失敗、429、時間切れのときは llama 4 の結果を残す。
// 無料枠は1日およそ20回で、中央値の待ちは約25秒。既定のモデルにはしない。
import {
  captureFailure,
  CaptureMessages,
  decodeCapturePhoto,
  type IdentifyInput,
  type IdentifyResponse,
  type ProductIdentifier,
} from './contract';
import { guessIsSpecific } from './product-query';
import { createGeminiIdentifier, GEMINI_LITE_MODEL, geminiConfigFromEnv, type GeminiHttp } from './gemini';
import { appAiBudget, createWorkersAiIdentifier, type AiBudget, type WorkersAiHttp } from './workers-ai';

export const LLAMA4_GEMINI_FALLBACK = 'llama4-gemini-fallback';
export const LLAMA4_MODEL_ID = '@cf/meta/llama-4-scout-17b-16e-instruct';

const MODEL_ENV = 'CAPTURE_AI_MODEL';
const KEY_ENV = 'GEMINI_API_KEY';

export function needsGeminiFallback(result: {
  ok: boolean;
  error?: { code: string };
  value?: IdentifyResponse;
}): boolean {
  if (!result.ok) return result.error?.code !== 'AI_LIMIT';
  if (!result.value || result.value.confidence === 'unreadable' || result.value.products.length === 0) return true;
  if (result.value.confidence !== 'sure') return true;
  return !guessIsSpecific(result.value.products[0]);
}

export function needsGeminiAfterMiss(input: { asked: boolean; hits: number }): boolean {
  return !input.asked && input.hits <= 0;
}

export function createGeminiFallbackIdentifier(input: {
  primary: ProductIdentifier;
  gemini: ProductIdentifier | null;
}): ProductIdentifier {
  return {
    async identify(photo) {
      const primary = await input.primary.identify(photo);
      if (!input.gemini || !needsGeminiFallback(primary)) return primary;
      const second = await input.gemini.identify(photo);
      if (!second.ok) return primary;
      return second;
    },
  };
}

export function geminiFallbackIdentifierForEnv(input: {
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
}): ProductIdentifier | null {
  const source = (input.geminiEnv ?? process.env) as Record<string, string | undefined>;
  const selectedRaw = source[MODEL_ENV];
  const selected = typeof selectedRaw === 'string' ? selectedRaw.trim() : '';
  if (selected !== LLAMA4_GEMINI_FALLBACK) return null;
  const testMode = input.env?.NODE_ENV !== 'production' && input.env?.CAPTURE_TEST_HOOKS === '1';
  if (testMode && input.hooked) return input.fake;
  if (!input.accountId || !input.apiToken) return unavailable();
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
  return createGeminiFallbackIdentifier({ primary, gemini });
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
