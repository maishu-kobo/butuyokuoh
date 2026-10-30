// Gemini API の generateContent。キーは呼び出し側が渡す。ここは写真もキーもログに出さない。
// https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
// キーは URL に置かず x-goog-api-key だけ。思考はモデルごとに切る。
// https://ai.google.dev/gemini-api/docs/generate-content/thinking
// 3.5 は thinkingBudget を使わない。flash は thinkingLevel low、flash-lite は minimal。
// flash-lite に thinkingBudget 0 を送ると 400 になる。長い再試行はここではなく評価ハーネスだけ。
import {
  CaptureMessages,
  captureFailure,
  decodeCapturePhoto,
  type CaptureResult,
  type IdentifyConfidence,
  type IdentifyInput,
  type IdentifyResponse,
  type ProductIdentifier,
} from './contract';
import { composeCapturedProduct, copiedPromptExample, guessIsSpecific } from './product-query';

export const GEMINI_HOST = 'generativelanguage.googleapis.com';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash';
export const GEMINI_LITE_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_TIMEOUT_MS = 90_000;

const ALLOWED_MODELS = [GEMINI_DEFAULT_MODEL, GEMINI_LITE_MODEL] as const;
export type GeminiModelId = (typeof ALLOWED_MODELS)[number];

const MODEL_ENV = 'CAPTURE_AI_MODEL';
const GEMINI_MODEL_ENV = 'GEMINI_MODEL';
const GEMINI_KEY_ENV = 'GEMINI_API_KEY';
const MAX_RESPONSE_CHARS = 65_536;
const ATTEMPTS = 2;

const VARIANT_MODELS: Record<string, GeminiModelId> = {
  gemini: GEMINI_DEFAULT_MODEL,
  'gemini-ladder': GEMINI_DEFAULT_MODEL,
  'gemini-lite': GEMINI_LITE_MODEL,
  'gemini-lite-ladder': GEMINI_LITE_MODEL,
  'gemini-lite-evidence': GEMINI_LITE_MODEL,
  [GEMINI_DEFAULT_MODEL]: GEMINI_DEFAULT_MODEL,
  [GEMINI_LITE_MODEL]: GEMINI_LITE_MODEL,
};

const INSTRUCTION = [
  '写真に写っている商品を1つだけ見て、JSONだけを返してください。',
  'productNameは簡潔な商品名です。見えているブランド、シリーズ、色、種類を含めます。',
  'categoryは種類を1語。分からなければ空文字。',
  'brandとmodelは写真に見えている文字だけ。指示文の語や見本の固有名詞は書きません。分からなければ空文字。',
  'colorは見えている色を1つ。分からなければ空文字。',
  'queriesは日本の通販で探す短い検索語を、具体的なものから種類だけまで最大4つ。URLは入れません。',
  'ブランドと、種類またはシリーズが特定できた1商品だけ confidence は sure。種類や色だけなら unsure。',
  '読めなければ unreadable で productName は空文字、queries は空配列。',
  'バーコードは判定しません。',
].join('');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    confidence: { type: 'STRING', enum: ['sure', 'unsure', 'unreadable'] },
    category: { type: 'STRING', nullable: true },
    brand: { type: 'STRING', nullable: true },
    model: { type: 'STRING', nullable: true },
    productName: { type: 'STRING', nullable: true },
    color: { type: 'STRING', nullable: true },
    queries: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['confidence', 'productName', 'queries'],
};

const GENERIC = new Set(['example', 'unknown', 'n/a', 'null', 'none', 'item', '例', '不明']);

export interface GeminiHttpRequest {
  url: string;
  method: 'POST';
  redirect: 'manual';
  cache: 'no-store';
  headers: {
    'Content-Type': 'application/json';
    Accept: 'application/json';
    'x-goog-api-key': string;
  };
  body: string;
  signal: AbortSignal;
}

export interface GeminiHttpResponse {
  status: number;
  body: string;
}

export type GeminiHttp = (request: GeminiHttpRequest) => Promise<GeminiHttpResponse>;

export interface GeminiEnvConfig {
  model: GeminiModelId | null;
  apiKey: string | null;
}

type EnvBag = {
  CAPTURE_AI_MODEL?: string;
  GEMINI_MODEL?: string;
  GEMINI_API_KEY?: string;
};

export function isGeminiModelId(value: string | null | undefined): value is GeminiModelId {
  return ALLOWED_MODELS.some((model) => model === value);
}

// 3.5 Flash の案内は thinking_level。lite の既定は minimal で、thinkingBudget 0 は 400。
// https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.5
export function geminiThinkingConfig(model: GeminiModelId): { thinkingLevel: 'low' | 'minimal' } {
  return { thinkingLevel: model === GEMINI_LITE_MODEL ? 'minimal' : 'low' };
}

export function geminiConfigFromEnv(env?: EnvBag): GeminiEnvConfig | null {
  const source = (env ?? process.env) as Record<string, string | undefined>;
  const selected = envValue(source, MODEL_ENV);
  if (!selected || !Object.prototype.hasOwnProperty.call(VARIANT_MODELS, selected)) return null;
  const override = envValue(source, GEMINI_MODEL_ENV);
  const model = override ? (isGeminiModelId(override) ? override : null) : VARIANT_MODELS[selected];
  return { model, apiKey: normalizeKey(envValue(source, GEMINI_KEY_ENV)) };
}

export function geminiIdentifierForEnv(input: {
  hooked: boolean;
  fake: ProductIdentifier;
  env?: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string };
  geminiEnv?: EnvBag;
  http?: GeminiHttp;
  timeoutMs?: number;
}): ProductIdentifier | null {
  const config = geminiConfigFromEnv(input.geminiEnv);
  if (!config) return null;
  const testMode = input.env?.NODE_ENV !== 'production' && input.env?.CAPTURE_TEST_HOOKS === '1';
  if (testMode && input.hooked) return input.fake;
  if (!config.model || !config.apiKey) return unavailableGemini();
  return createGeminiIdentifier({
    apiKey: config.apiKey,
    model: config.model,
    http: input.http,
    timeoutMs: input.timeoutMs,
  });
}

export function createGeminiIdentifier(options: {
  apiKey: string;
  model?: string;
  http?: GeminiHttp;
  timeoutMs?: number;
  // 画面の判定は待たずに1回だけ送り直す。6回の待ちは評価ハーネスが自分で行う。
  attempts?: 1 | 2;
  // 既定の指示文は変えない。選んだ variant だけが根拠の条件を足す。
  instructionSuffix?: string;
}): ProductIdentifier {
  const http = options.http ?? ((request) => dispatchGemini(request));
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const attempts = options.attempts === 1 ? 1 : ATTEMPTS;
  const model = options.model?.trim() || GEMINI_DEFAULT_MODEL;
  const apiKey = normalizeKey(options.apiKey);

  return {
    async identify(input) {
      const photo = decodeCapturePhoto([{ mediaType: input.mediaType, bytes: input.bytes }]);
      if (!photo.ok) return photo;
      const url = isGeminiModelId(model) ? geminiGenerateUrl(model) : null;
      if (!apiKey || !url) return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      const body = JSON.stringify(requestBody(
        isGeminiModelId(model) ? model : GEMINI_DEFAULT_MODEL,
        photo.value.mediaType,
        Buffer.from(photo.value.bytes).toString('base64'),
        options.instructionSuffix,
      ));
      let outcome: CaptureResult<IdentifyResponse> = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const called = await callGemini(http, url, apiKey, body, timeoutMs);
        if (called.kind === 'timeout') {
          outcome = retryable('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
          if (attempt + 1 < attempts) continue;
          break;
        }
        if (called.kind === 'failed' || called.response.status === 0) {
          outcome = retryable('AI_UNAVAILABLE', CaptureMessages.aiRetryable, 503);
          if (attempt + 1 < attempts) continue;
          break;
        }
        const status = called.response.status;
        if (status === 408 || status === 429 || status >= 500) {
          outcome = status === 408
            ? retryable('AI_TIMEOUT', CaptureMessages.aiTimeout, 504)
            : retryable('AI_UNAVAILABLE', CaptureMessages.aiRetryable, 503);
          if (attempt + 1 < attempts) continue;
          break;
        }
        if (status !== 200) {
          outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
          break;
        }
        const parsed = interpret(called.response.body);
        if (parsed === 'invalid') {
          outcome = retryable('AI_INVALID_RESPONSE', CaptureMessages.aiRetryable, 502);
          if (attempt + 1 < attempts) continue;
          break;
        }
        outcome = { ok: true, value: parsed };
        break;
      }
      return outcome;
    },
  };
}

export function geminiGenerateUrl(modelId: GeminiModelId): string | null {
  const url = new URL(`https://${GEMINI_HOST}/v1beta/models/${modelId}:generateContent`);
  if (url.protocol !== 'https:' || url.hostname !== GEMINI_HOST || url.username || url.password || url.search || url.hash) {
    return null;
  }
  return url.toString();
}

export async function dispatchGemini(
  request: GeminiHttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GeminiHttpResponse> {
  let target: URL;
  try {
    target = new URL(request.url);
  } catch {
    return { status: 0, body: '' };
  }
  const headerKey = request.headers['x-goog-api-key'];
  if (
    target.protocol !== 'https:'
    || target.hostname !== GEMINI_HOST
    || target.username
    || target.password
    || target.search
    || target.hash
    || !/^\/v1beta\/models\/gemini-3\.5-flash(?:-lite)?:generateContent$/.test(target.pathname)
    || !headerKey
    || target.href.includes(headerKey)
  ) {
    return { status: 0, body: '' };
  }
  const response = await fetchImpl(target, {
    method: 'POST',
    redirect: 'manual',
    cache: 'no-store',
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  });
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, body: '' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_CHARS) {
      await reader.cancel();
      return { status: response.status, body: '' };
    }
    chunks.push(value);
  }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
}

function requestBody(model: GeminiModelId, mimeType: string, data: string, instructionSuffix?: string): Record<string, unknown> {
  const evidence = Boolean(instructionSuffix);
  const schema = evidence
    ? {
      ...RESPONSE_SCHEMA,
      properties: {
        ...RESPONSE_SCHEMA.properties,
        evidence: { type: 'STRING', nullable: true },
      },
      required: [...RESPONSE_SCHEMA.required, 'evidence'],
    }
    : RESPONSE_SCHEMA;
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: evidence ? `${INSTRUCTION}${instructionSuffix}` : INSTRUCTION },
        { inlineData: { mimeType, data } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: schema,
      thinkingConfig: geminiThinkingConfig(model),
    },
  };
}

function unavailableGemini(): ProductIdentifier {
  return {
    async identify(input: IdentifyInput) {
      const photo = decodeCapturePhoto([{ mediaType: input.mediaType, bytes: input.bytes }]);
      if (!photo.ok) return photo;
      return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
    },
  };
}

function envValue(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeKey(value: string | null): string | null {
  if (!value || value.length < 8 || value.length > 256) return null;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function retryable(code: 'AI_TIMEOUT' | 'AI_UNAVAILABLE' | 'AI_INVALID_RESPONSE', error: string, status: number): CaptureResult<never> {
  const result = captureFailure(code, error, status);
  if (!result.ok) result.error.retryable = true;
  return result;
}

type CallOutcome =
  | { kind: 'response'; response: GeminiHttpResponse }
  | { kind: 'timeout' }
  | { kind: 'failed' };

async function callGemini(
  http: GeminiHttp,
  url: string,
  apiKey: string,
  body: string,
  timeoutMs: number,
): Promise<CallOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await Promise.race([
      http({
        url,
        method: 'POST',
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-goog-api-key': apiKey,
        },
        body,
        signal: controller.signal,
      }),
      whenAborted(controller.signal),
    ]);
    if (timedOut || controller.signal.aborted) return { kind: 'timeout' };
    return { kind: 'response', response };
  } catch {
    return timedOut || controller.signal.aborted ? { kind: 'timeout' } : { kind: 'failed' };
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

function whenAborted(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function interpret(body: string): IdentifyResponse | 'invalid' {
  if (!body || body.length > MAX_RESPONSE_CHARS) return 'invalid';
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return 'invalid';
  }
  const text = candidateText(payload);
  if (!text) return 'invalid';
  const parsed = parseModelJson(text);
  return parsed ? mapCandidate(parsed) : 'invalid';
}

function candidateText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== 'object') return null;
  const content = (candidates[0] as { content?: unknown }).content;
  if (!content || typeof content !== 'object') return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const record = part as { text?: unknown; thought?: unknown };
    if (record.thought === true) return '';
    return typeof record.text === 'string' ? record.text : '';
  }).join('').trim();
  return text || null;
}

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return firstJsonObject(text);
  }
}

function mapCandidate(value: unknown): IdentifyResponse | 'invalid' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid';
  const record = value as Record<string, unknown>;
  const confidence = record.confidence;
  if (confidence !== 'sure' && confidence !== 'unsure' && confidence !== 'unreadable') return 'invalid';
  const queries = cleanQueries(record.queries);
  if (confidence === 'unreadable') return { confidence: 'unreadable', products: [], queries };
  const productName = cleanLabel(record.productName, 200);
  const category = cleanLabel(record.category, 40);
  const name = productName || category;
  if (!name) return 'invalid';
  if (copiedPromptExample(name)) return { confidence: 'unreadable', products: [], queries: [] };
  const plain = plainName(name);
  if (!plain.name || copiedPromptExample(plain.name)) return { confidence: 'unreadable', products: [], queries: [] };
  const composed = composeCapturedProduct({
    name: plain.name,
    brand: plain.catalog ? null : cleanLabel(record.brand, 80),
    model: plain.catalog ? null : cleanLabel(record.model, 80),
    productType: plain.catalog ? null : category,
    color: plain.catalog ? null : cleanLabel(record.color, 40),
    recoverSeries: !plain.catalog,
  });
  if (!composed.name || copiedPromptExample(composed.name)) return { confidence: 'unreadable', products: [], queries: [] };
  let next: IdentifyConfidence = confidence;
  if (plain.catalog || !guessIsSpecific(composed)) next = 'unsure';
  const evidence = evidenceFrom(record, category, cleanLabel(record.color, 40));
  return {
    confidence: next,
    products: [{ name: composed.name, brand: composed.brand, model: composed.model, jan: null }],
    queries,
    ...(evidence ? { evidence } : {}),
  };
}

function evidenceFrom(
  record: Record<string, unknown>,
  productType: string | null,
  color: string | null,
): IdentifyResponse['evidence'] | null {
  if (!Object.prototype.hasOwnProperty.call(record, 'evidence')) return null;
  const text = cleanLabel(record.evidence, 200) ?? '';
  return { textProvided: true, visibleText: text, productType, color };
}

function plainName(value: string): { name: string; catalog: boolean } {
  const normalized = value.replaceAll('／', '/').replace(/\s+/g, ' ').trim();
  const listed = /(?:^|\s)\S+(?:\/\S+){2,}(?:\s|$)/.test(normalized);
  if (!listed) return { name: normalized, catalog: false };
  return { name: normalized.split('/')[0]?.trim() ?? '', catalog: true };
}

function cleanQueries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const queries: string[] = [];
  for (const item of value) {
    if (queries.length >= 4) break;
    const label = cleanLabel(item, 80);
    if (!label || copiedPromptExample(label)) continue;
    const tokens = label.split(' ').filter((token) => !GENERIC.has(token.normalize('NFKC').toLocaleLowerCase('en-US')));
    if (tokens.length === 0) continue;
    queries.push(tokens.join(' '));
  }
  return queries;
}

function cleanLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || isUrlish(cleaned)) return null;
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max).trim();
}

function isUrlish(value: string): boolean {
  return /(?:https?:|javascript:)/i.test(value) || value.startsWith('//');
}

function firstJsonObject(text: string): unknown {
  if (text.length > MAX_RESPONSE_CHARS) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
