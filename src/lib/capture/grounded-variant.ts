// 根拠のないブランドを外し、必要なら lite で候補を1回並べ替える。既定では使わない。
import {
  CaptureMessages,
  captureFailure,
  decodeCapturePhoto,
  type CaptureResult,
  type IdentifyInput,
  type IdentifyResponse,
  type ProductGuess,
  type ProductIdentifier,
} from './contract';
import { BRAND_EVIDENCE_SUFFIX, guardIdentifyResult } from './brand-guard';
import { createGeminiIdentifier, GEMINI_LITE_MODEL, geminiConfigFromEnv, type GeminiHttp } from './gemini';
import { LLAMA4_MODEL_ID, runGeminiFallback } from './gemini-fallback';
import { appAiBudget, createWorkersAiIdentifier, type AiBudget, type WorkersAiHttp } from './workers-ai';

const MODEL_ENV = 'CAPTURE_AI_MODEL';
const KEY_ENV = 'GEMINI_API_KEY';

export type GroundedMode = 'guard' | 'grounded';

export function selectedGroundedMode(env?: { CAPTURE_AI_MODEL?: string }): GroundedMode | null {
  const source = (env ?? process.env) as Record<string, string | undefined>;
  const raw = source[MODEL_ENV];
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name === 'llama4-brand-guard') return 'guard';
  if (name === 'llama4-gemini-grounded') return 'grounded';
  return null;
}

export async function identifyGroundedVariant(input: {
  photo: IdentifyInput;
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
  search: (product: ProductGuess) => Promise<{ hits: number; value: unknown }>;
}): Promise<CaptureResult<IdentifyResponse> | null> {
  const mode = selectedGroundedMode(input.geminiEnv);
  if (!mode) return null;
  const testMode = input.env?.NODE_ENV !== 'production' && input.env?.CAPTURE_TEST_HOOKS === '1';
  if (testMode && input.hooked) return input.fake.identify(input.photo);
  if (!input.accountId || !input.apiToken) {
    const photo = decodeCapturePhoto([{ mediaType: input.photo.mediaType, bytes: input.photo.bytes }]);
    if (!photo.ok) return photo;
    return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
  }
  const primary = createWorkersAiIdentifier({
    accountId: input.accountId,
    apiToken: input.apiToken,
    userId: input.userId,
    model: LLAMA4_MODEL_ID,
    budget: input.budget ?? appAiBudget(),
    http: input.workersHttp,
    instructionSuffix: BRAND_EVIDENCE_SUFFIX,
  });
  const guarded = {
    async identify(photo: IdentifyInput) {
      return guardIdentifyResult(await primary.identify(photo));
    },
  };
  if (mode === 'guard') return guarded.identify(input.photo);
  const source = (input.geminiEnv ?? process.env) as Record<string, string | undefined>;
  const keyRaw = source[KEY_ENV];
  const geminiEnv = geminiConfigFromEnv({
    CAPTURE_AI_MODEL: 'gemini-lite',
    GEMINI_API_KEY: typeof keyRaw === 'string' ? keyRaw : undefined,
  });
  const gemini = geminiEnv?.apiKey
    ? createGeminiIdentifier({ apiKey: geminiEnv.apiKey, model: GEMINI_LITE_MODEL, http: input.geminiHttp })
    : null;
  const outcome = await runGeminiFallback({
    photo: input.photo,
    primary: guarded,
    gemini,
    search: input.search,
  });
  return outcome.guess;
}
