// 写真の見た目から商品を推定する。モデルは docs/capture-ai.md。
// キーは呼び出し側が渡す。ここは環境変数を読まず、トークンも写真もログに出さない。
import {
  CaptureMessages,
  captureFailure,
  decodeCapturePhoto,
  isValidJan,
  type CaptureResult,
  type IdentifyConfidence,
  type IdentifyResponse,
  type ProductGuess,
  type ProductIdentifier,
} from './contract';

export const WORKERS_AI_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const WORKERS_AI_TIMEOUT_MS = 30_000;
export const AI_MAX_OUTPUT_TOKENS = 400;

const MAX_RESPONSE_CHARS = 65_536;
const MAX_PRODUCTS = 5;
const HOST = 'api.cloudflare.com';

const INSTRUCTION = [
  '店頭の写真に写っている商品だけを見て、JSONオブジェクトだけを返してください。',
  '説明、Markdown、URLは付けません。',
  '{"confidence":"sure"|"unsure"|"unreadable","products":[{"name":"","brand":null,"model":null,"jan":null}]}',
  '自信がある商品が1つなら sure、候補が複数なら unsure、判別できなければ unreadable で products は空です。',
  'JANは写真に印字された8桁か13桁だけ。分からない値は null。',
].join('');

export interface WorkersAiHttpRequest {
  url: string;
  method: 'POST';
  redirect: 'manual';
  cache: 'no-store';
  headers: {
    Authorization: string;
    'Content-Type': 'application/json';
    Accept: 'application/json';
  };
  body: string;
  signal: AbortSignal;
}

export interface WorkersAiHttpResponse {
  status: number;
  body: string;
}

export type WorkersAiHttp = (request: WorkersAiHttpRequest) => Promise<WorkersAiHttpResponse>;

export interface WorkersAiTiming {
  elapsedMs: number;
}

export interface WorkersAiIdentifierOptions {
  accountId: string;
  apiToken: string;
  userId: string;
  http?: WorkersAiHttp;
  now?: () => number;
  timeoutMs?: number;
  onTiming?: (timing: WorkersAiTiming) => void;
}

type CallOutcome =
  | { kind: 'response'; response: WorkersAiHttpResponse }
  | { kind: 'timeout' }
  | { kind: 'failed' };

export function createWorkersAiIdentifier(options: WorkersAiIdentifierOptions): ProductIdentifier {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? WORKERS_AI_TIMEOUT_MS;
  const http = options.http ?? defaultHttp;

  return {
    async identify(input) {
      const photo = decodeCapturePhoto([{ mediaType: input.mediaType, bytes: input.bytes }]);
      if (!photo.ok) return photo;
      const accountId = normalizeAccount(options.accountId);
      const apiToken = normalizeToken(options.apiToken);
      const userId = normalizeUserId(options.userId);
      const url = accountId ? endpoint(accountId) : null;
      if (!accountId || !apiToken || !userId || !url) {
        return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      }

      const started = now();
      let outcome: CaptureResult<IdentifyResponse> = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      try {
        const imageBody = JSON.stringify({
          messages: [
            { role: 'system', content: INSTRUCTION },
            { role: 'user', content: 'この写真の商品をJSONで返してください。' },
          ],
          image: `data:${photo.value.mediaType};base64,${Buffer.from(photo.value.bytes).toString('base64')}`,
          max_tokens: AI_MAX_OUTPUT_TOKENS,
          temperature: 0,
        });
        let called = await callModel(http, url, apiToken, imageBody, timeoutMs);
        if (called.kind === 'timeout') {
          outcome = captureFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
        } else if (called.kind === 'failed') {
          outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
        } else if (isLicenseGate(called.response)) {
          const agreed = await callModel(http, url, apiToken, '{"prompt":"agree"}', timeoutMs);
          if (agreed.kind === 'timeout') {
            outcome = captureFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
          } else if (agreed.kind !== 'response' || isLicenseGate(agreed.response) || agreed.response.status >= 300) {
            outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
          } else {
            called = await callModel(http, url, apiToken, imageBody, timeoutMs);
            outcome = called.kind === 'timeout'
              ? captureFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504)
              : called.kind === 'response' && !isLicenseGate(called.response)
                ? interpret(called.response)
                : captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
          }
        } else {
          outcome = interpret(called.response);
        }
      } catch {
        outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      } finally {
        options.onTiming?.({ elapsedMs: Math.max(0, now() - started) });
      }
      return outcome;
    },
  };
}

function normalizeAccount(value: string): string | null {
  const accountId = value.trim();
  return /^[a-fA-F0-9]{32}$/.test(accountId) ? accountId : null;
}

function normalizeToken(value: string): string | null {
  if (value.length < 8 || value.length > 4096) return null;
  return /^[A-Za-z0-9_\-+=/.]+$/.test(value) ? value : null;
}

function normalizeUserId(value: string): string | null {
  const userId = value.trim().slice(0, 64);
  if (!userId || /[\u0000-\u001F\u007F]/.test(userId)) return null;
  return userId;
}

function endpoint(accountId: string): string | null {
  const url = new URL(`https://${HOST}/client/v4/accounts/${accountId}/ai/run/${WORKERS_AI_MODEL}`);
  if (url.protocol !== 'https:' || url.hostname !== HOST || url.username || url.password || url.search || url.hash) {
    return null;
  }
  return url.toString();
}

async function callModel(
  http: WorkersAiHttp,
  url: string,
  apiToken: string,
  body: string,
  timeoutMs: number,
): Promise<CallOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const stop = whenAborted(controller.signal);
  stop.catch(() => undefined);
  try {
    const response = await Promise.race([
      http({
        url,
        method: 'POST',
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      }),
      stop,
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

function isLicenseGate(response: WorkersAiHttpResponse): boolean {
  if (response.status !== 403) return false;
  const parsed = parseJson(response.body);
  if (!parsed || typeof parsed !== 'object') return false;
  const errors = (parsed as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((error) => Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 5016);
}

function interpret(response: WorkersAiHttpResponse): CaptureResult<IdentifyResponse> {
  if (response.status >= 300 && response.status < 400) {
    return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
  }
  if (response.status === 408) return captureFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
  if (response.status >= 400) return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
  if (response.body.length > MAX_RESPONSE_CHARS) {
    return captureFailure('AI_INVALID_RESPONSE', CaptureMessages.aiFailed, 502);
  }
  const parsed = parseJson(response.body);
  if (!parsed || typeof parsed !== 'object') {
    return captureFailure('AI_INVALID_RESPONSE', CaptureMessages.aiFailed, 502);
  }
  if ((parsed as { success?: unknown }).success === false) {
    return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
  }
  const guess = parseGuess(extractModelOutput(parsed));
  if (!guess) return captureFailure('AI_INVALID_RESPONSE', CaptureMessages.aiFailed, 502);
  return { ok: true, value: guess };
}

function parseJson(body: string): unknown {
  if (!body || body.length > MAX_RESPONSE_CHARS) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function extractModelOutput(payload: object): unknown {
  const result = (payload as { result?: unknown }).result;
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  if (typeof record.response === 'string' || (record.response && typeof record.response === 'object')) return record.response;
  const choice = Array.isArray(record.choices) ? record.choices[0] : null;
  if (choice && typeof choice === 'object') {
    const message = (choice as { message?: unknown }).message;
    if (message && typeof message === 'object' && typeof (message as { content?: unknown }).content === 'string') {
      return (message as { content: string }).content;
    }
  }
  if (typeof record.confidence === 'string') return record;
  return null;
}

function parseGuess(output: unknown): IdentifyResponse | null {
  const value = typeof output === 'string' ? firstJsonObject(output) : output;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const productsField = (value as { products?: unknown }).products;
  if (!Array.isArray(productsField)) return null;
  const products: ProductGuess[] = [];
  for (const item of productsField) {
    if (products.length >= MAX_PRODUCTS) break;
    const product = normalizeProduct(item);
    if (product) products.push(product);
  }
  if (products.length === 0) return { confidence: 'unreadable', products: [] };
  const raw = (value as { confidence?: unknown }).confidence;
  let confidence: IdentifyConfidence = raw === 'sure' || raw === 'unsure' || raw === 'unreadable'
    ? raw
    : products.length === 1 ? 'sure' : 'unsure';
  if (confidence === 'unreadable') return { confidence: 'unreadable', products: [] };
  if (confidence === 'sure' && products.length !== 1) confidence = 'unsure';
  return { confidence, products };
}

function normalizeProduct(item: unknown): ProductGuess | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  const name = cleanLabel(record.name, 200);
  if (!name || isUrlish(name)) return null;
  let jan: string | null = null;
  if (typeof record.jan === 'string') {
    const trimmed = record.jan.trim();
    if (isValidJan(trimmed)) jan = trimmed;
  }
  return {
    name,
    brand: optionalLabel(record.brand, 80),
    model: optionalLabel(record.model, 80),
    jan,
  };
}

function optionalLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanLabel(value, max);
  if (!cleaned || isUrlish(cleaned)) return null;
  return cleaned;
}

function cleanLabel(value: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
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

async function defaultHttp(request: WorkersAiHttpRequest): Promise<WorkersAiHttpResponse> {
  let target: URL;
  try {
    target = new URL(request.url);
  } catch {
    return { status: 0, body: '' };
  }
  if (target.protocol !== 'https:' || target.hostname !== HOST || target.username || target.password) {
    return { status: 0, body: '' };
  }
  const response = await fetch(target, {
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
