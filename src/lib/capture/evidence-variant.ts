// 根拠があるときだけブランドを書く。既定では使わない。
// llama4-evidence は llama 4 のあと、今までどおり lite を 0 件と読めないときに足す。
// gemini-lite-evidence は lite だけ。どちらも flash-lite が通常の Gemini で、既定モデルは変えない。
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
import { GEMINI_EVIDENCE_SUFFIX, WORKERS_EVIDENCE_SUFFIX } from './evidence-prompt';
import { maybeUpgradeWithFlash, type FlashLedger } from './flash-fallback';
import { createGeminiIdentifier, GEMINI_DEFAULT_MODEL, GEMINI_LITE_MODEL, geminiConfigFromEnv, type GeminiHttp } from './gemini';
import { LLAMA4_MODEL_ID, runGeminiFallback } from './gemini-fallback';
import { appAiBudget, createWorkersAiIdentifier, type AiBudget, type WorkersAiHttp } from './workers-ai';

const MODEL_ENV = 'CAPTURE_AI_MODEL';
const KEY_ENV = 'GEMINI_API_KEY';

export const LLAMA4_EVIDENCE = 'llama4-evidence';
export const GEMINI_LITE_EVIDENCE = 'gemini-lite-evidence';

export type EvidenceMode = 'llama4' | 'lite';

export function selectedEvidenceMode(env?: { CAPTURE_AI_MODEL?: string }): EvidenceMode | null {
  const source = (env ?? process.env) as Record<string, string | undefined>;
  const raw = source[MODEL_ENV];
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name === LLAMA4_EVIDENCE) return 'llama4';
  if (name === GEMINI_LITE_EVIDENCE) return 'lite';
  return null;
}

export async function identifyEvidenceVariant(input: {
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
  flashLedger?: FlashLedger;
  now?: number;
  search: (product: ProductGuess) => Promise<{ hits: number; value: unknown }>;
}): Promise<CaptureResult<IdentifyResponse> | null> {
  const mode = selectedEvidenceMode(input.geminiEnv);
  if (!mode) return null;
  const testMode = input.env?.NODE_ENV !== 'production' && input.env?.CAPTURE_TEST_HOOKS === '1';
  if (testMode && input.hooked) return input.fake.identify(input.photo);
  if (mode === 'lite') return identifyLite(input);
  return identifyLlama4(input);
}

async function identifyLite(input: {
  photo: IdentifyInput;
  geminiEnv?: { CAPTURE_AI_MODEL?: string; GEMINI_API_KEY?: string };
  geminiHttp?: GeminiHttp;
  flashLedger?: FlashLedger;
  now?: number;
}): Promise<CaptureResult<IdentifyResponse>> {
  const gemini = liteIdentifier(input.geminiEnv, input.geminiHttp);
  if (!gemini) return unavailable(input.photo);
  return finishWithFlash(input, await gemini.identify(input.photo));
}

async function identifyLlama4(input: {
  photo: IdentifyInput;
  geminiEnv?: { CAPTURE_AI_MODEL?: string; GEMINI_API_KEY?: string };
  accountId: string | null;
  apiToken: string | null;
  userId: string;
  budget?: AiBudget;
  workersHttp?: WorkersAiHttp;
  geminiHttp?: GeminiHttp;
  flashLedger?: FlashLedger;
  now?: number;
  search: (product: ProductGuess) => Promise<{ hits: number; value: unknown }>;
}): Promise<CaptureResult<IdentifyResponse>> {
  if (!input.accountId || !input.apiToken) return unavailable(input.photo);
  const primary = createWorkersAiIdentifier({
    accountId: input.accountId,
    apiToken: input.apiToken,
    userId: input.userId,
    model: LLAMA4_MODEL_ID,
    budget: input.budget ?? appAiBudget(),
    http: input.workersHttp,
    instructionSuffix: WORKERS_EVIDENCE_SUFFIX,
  });
  const outcome = await runGeminiFallback({
    photo: input.photo,
    primary,
    gemini: liteIdentifier(input.geminiEnv, input.geminiHttp),
    search: input.search,
  });
  return finishWithFlash(input, outcome.guess);
}

function finishWithFlash(input: {
  photo: IdentifyInput;
  geminiEnv?: { CAPTURE_AI_MODEL?: string; GEMINI_API_KEY?: string };
  geminiHttp?: GeminiHttp;
  flashLedger?: FlashLedger;
  now?: number;
}, guess: CaptureResult<IdentifyResponse>): Promise<CaptureResult<IdentifyResponse>> {
  return maybeUpgradeWithFlash({
    enabled: true,
    photo: input.photo,
    guess,
    flash: flashIdentifier(input.geminiEnv, input.geminiHttp),
    ledger: input.flashLedger,
    now: input.now,
  }).then((upgraded) => upgraded.guess);
}

function liteIdentifier(
  geminiEnv: { CAPTURE_AI_MODEL?: string; GEMINI_API_KEY?: string } | undefined,
  http: GeminiHttp | undefined,
): ProductIdentifier | null {
  const source = (geminiEnv ?? process.env) as Record<string, string | undefined>;
  const keyRaw = source[KEY_ENV];
  const config = geminiConfigFromEnv({
    CAPTURE_AI_MODEL: 'gemini-lite',
    GEMINI_API_KEY: typeof keyRaw === 'string' ? keyRaw : undefined,
  });
  if (!config?.apiKey) return null;
  return createGeminiIdentifier({
    apiKey: config.apiKey,
    model: GEMINI_LITE_MODEL,
    http,
    instructionSuffix: GEMINI_EVIDENCE_SUFFIX,
  });
}

function flashIdentifier(
  geminiEnv: { CAPTURE_AI_MODEL?: string; GEMINI_API_KEY?: string } | undefined,
  http: GeminiHttp | undefined,
): ProductIdentifier | null {
  const source = (geminiEnv ?? process.env) as Record<string, string | undefined>;
  const keyRaw = source[KEY_ENV];
  const config = geminiConfigFromEnv({
    CAPTURE_AI_MODEL: 'gemini-lite',
    GEMINI_API_KEY: typeof keyRaw === 'string' ? keyRaw : undefined,
  });
  if (!config?.apiKey) return null;
  return createGeminiIdentifier({
    apiKey: config.apiKey,
    model: GEMINI_DEFAULT_MODEL,
    http,
    instructionSuffix: GEMINI_EVIDENCE_SUFFIX,
  });
}

async function unavailable(photo: IdentifyInput): Promise<CaptureResult<IdentifyResponse>> {
  const decoded = decodeCapturePhoto([{ mediaType: photo.mediaType, bytes: photo.bytes }]);
  if (!decoded.ok) return decoded;
  return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
}
