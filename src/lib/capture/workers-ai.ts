// 写真の見た目から商品を推定する。モデルは docs/capture-ai.md。
// キーは呼び出し側が渡す。ここは環境変数を読まず、トークンも写真もログに出さない。
import type Database from 'better-sqlite3';
import { getDb } from '../db';
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

// 料金表（2026-10-20）の入力 4410 / 出力 61493 ニューロン毎100万トークン。
export const AI_NEURONS_PER_MILLION_INPUT = 4410;
export const AI_NEURONS_PER_MILLION_OUTPUT = 61493;
export const AI_NEURON_DAILY_CAP = 8000;
export const AI_USER_PER_MINUTE = 3;
export const AI_USER_PER_DAY = 10;
// 返事にトークン数が無いときの仮の1回分。8万入力トークンと出力上限400を料金表で切り上げた値。
// 写真20枚の実測（#100）は未確認。実測に置き換える。
export const AI_NEURONS_WHEN_USAGE_MISSING = 378;
export const AI_LIMIT_MESSAGE = '今日は写真からの自動の判定が上限に達しました。商品名を入れて探してください';
export const AI_MINUTE_LIMIT_MESSAGE = '写真からの判定は1分に3回までです。商品名を入れて探してください';

const MINUTE_MS = 60_000;
const MAX_RESPONSE_CHARS = 65_536;
const CAP_USER = '\u0000';
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

export interface AiBudget {
  tryBegin(userId: string, now: number): { ok: true; token: number } | { ok: false; reason: 'minute' | 'day' | 'neurons' };
  settle(token: number, neurons: number): void;
  trip(now: number): void;
  usedNeurons(now: number): number;
}

export interface WorkersAiIdentifierOptions {
  accountId: string;
  apiToken: string;
  userId: string;
  budget?: AiBudget;
  http?: WorkersAiHttp;
  now?: () => number;
  timeoutMs?: number;
  onTiming?: (timing: WorkersAiTiming) => void;
}

type CallOutcome =
  | { kind: 'response'; response: WorkersAiHttpResponse }
  | { kind: 'timeout' }
  | { kind: 'failed' };

type UsageMeter = {
  note(response: WorkersAiHttpResponse): void;
  neurons(): number;
};

export function createWorkersAiIdentifier(options: WorkersAiIdentifierOptions): ProductIdentifier {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? WORKERS_AI_TIMEOUT_MS;
  const http = options.http ?? defaultHttp;
  const budget = options.budget ?? createAiBudget();

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
      let slot: number | null = null;
      let hitUpstreamCap = false;
      const meter = createUsageMeter();
      let outcome: CaptureResult<IdentifyResponse> = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      try {
        const begun = budget.tryBegin(userId, started);
        if (!begun.ok) {
          outcome = captureFailure(
            'AI_LIMIT',
            begun.reason === 'minute' ? AI_MINUTE_LIMIT_MESSAGE : AI_LIMIT_MESSAGE,
            429,
          );
        } else {
          slot = begun.token;
          const imageBody = JSON.stringify({
            messages: [
              { role: 'system', content: INSTRUCTION },
              { role: 'user', content: 'この写真の商品をJSONで返してください。' },
            ],
            image: `data:${photo.value.mediaType};base64,${Buffer.from(photo.value.bytes).toString('base64')}`,
            max_tokens: AI_MAX_OUTPUT_TOKENS,
            temperature: 0,
          });
          const apply = (response: WorkersAiHttpResponse): CaptureResult<IdentifyResponse> => {
            meter.note(response);
            if (isDailyCap(response)) {
              hitUpstreamCap = true;
              return captureFailure('AI_LIMIT', AI_LIMIT_MESSAGE, 429);
            }
            return interpret(response);
          };
          const called = await callModel(http, url, apiToken, imageBody, timeoutMs);
          if (called.kind === 'timeout') {
            outcome = captureFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
          } else if (called.kind === 'failed') {
            outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
          } else {
            outcome = apply(called.response);
          }
        }
      } catch {
        outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
      } finally {
        if (slot != null) budget.settle(slot, meter.neurons());
        if (hitUpstreamCap) budget.trip(started);
        options.onTiming?.({ elapsedMs: Math.max(0, now() - started) });
      }
      return outcome;
    },
  };
}

type BudgetRow = { token: number; userId: string; at: number; neurons: number };

export function createAiBudget(): AiBudget {
  let rows: BudgetRow[] = [];
  let nextToken = 1;

  function active(now: number): BudgetRow[] {
    const start = utcDayStart(now);
    rows = rows.filter((row) => row.at >= start);
    return rows;
  }

  return {
    tryBegin(userId, now) {
      const current = active(now);
      const mine = current.filter((row) => row.userId === userId);
      if (mine.filter((row) => now - row.at < MINUTE_MS).length >= AI_USER_PER_MINUTE) {
        return { ok: false, reason: 'minute' };
      }
      if (mine.length >= AI_USER_PER_DAY) return { ok: false, reason: 'day' };
      if (current.reduce((sum, row) => sum + row.neurons, 0) >= AI_NEURON_DAILY_CAP) {
        return { ok: false, reason: 'neurons' };
      }
      const token = nextToken;
      nextToken += 1;
      current.push({ token, userId, at: now, neurons: 0 });
      return { ok: true, token };
    },
    settle(token, neurons) {
      const row = rows.find((item) => item.token === token);
      if (!row) return;
      row.neurons = Number.isSafeInteger(neurons) && neurons > 0 ? neurons : 0;
    },
    trip(now) {
      const current = active(now);
      const used = current.reduce((sum, row) => sum + row.neurons, 0);
      if (used >= AI_NEURON_DAILY_CAP) return;
      const token = nextToken;
      nextToken += 1;
      current.push({ token, userId: CAP_USER, at: now, neurons: AI_NEURON_DAILY_CAP - used });
    },
    usedNeurons(now) {
      return active(now).reduce((sum, row) => sum + row.neurons, 0);
    },
  };
}

type UsageCount = { n: number };

function finiteNeuronCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

function storedNeuronCount(neurons: number): number {
  return finiteNeuronCount(neurons) ?? AI_NEURONS_WHEN_USAGE_MISSING;
}

export function createSqliteAiBudget(db: Database.Database): AiBudget {
  const countMinute = db.prepare(
    `SELECT COUNT(*) AS n FROM capture_ai_usage
     WHERE user_key = ? AND day = ? AND at_ms > ? AND at_ms <= ?`,
  );
  const countDay = db.prepare(
    'SELECT COUNT(*) AS n FROM capture_ai_usage WHERE user_key = ? AND day = ?',
  );
  const sumDay = db.prepare(
    'SELECT COALESCE(SUM(neurons), 0) AS n FROM capture_ai_usage WHERE day = ?',
  );
  const insert = db.prepare(
    'INSERT INTO capture_ai_usage (user_key, day, at_ms, neurons) VALUES (?, ?, ?, ?)',
  );
  const update = db.prepare('UPDATE capture_ai_usage SET neurons = ? WHERE id = ?');

  const begin = db.transaction((userId: string, now: number) => {
    const day = utcDay(now);
    const minute = countMinute.get(userId, day, now - MINUTE_MS, now) as UsageCount;
    if (Number(minute.n) >= AI_USER_PER_MINUTE) return { ok: false as const, reason: 'minute' as const };
    const daily = countDay.get(userId, day) as UsageCount;
    if (Number(daily.n) >= AI_USER_PER_DAY) return { ok: false as const, reason: 'day' as const };
    const used = sumDay.get(day) as UsageCount;
    if (Number(used.n) >= AI_NEURON_DAILY_CAP) return { ok: false as const, reason: 'neurons' as const };
    const row = insert.run(userId, day, now, AI_NEURONS_WHEN_USAGE_MISSING);
    return { ok: true as const, token: Number(row.lastInsertRowid) };
  });

  const fillCap = db.transaction((now: number) => {
    const day = utcDay(now);
    const used = Number((sumDay.get(day) as UsageCount).n);
    if (used >= AI_NEURON_DAILY_CAP) return;
    insert.run(CAP_USER, day, now, AI_NEURON_DAILY_CAP - used);
  });

  return {
    tryBegin(userId, now) {
      return begin.immediate(userId, now);
    },
    settle(token, neurons) {
      update.run(storedNeuronCount(neurons), token);
    },
    trip(now) {
      fillCap.immediate(now);
    },
    usedNeurons(now) {
      return Number((sumDay.get(utcDay(now)) as UsageCount).n);
    },
  };
}

let appBudget: AiBudget | null = null;

export function appAiBudget(): AiBudget {
  if (!appBudget) appBudget = createSqliteAiBudget(getDb());
  return appBudget;
}

export function neuronsFromTokenUsage(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  const prompt = finiteToken(record.prompt_tokens);
  const completion = finiteToken(record.completion_tokens);
  if (prompt == null && completion == null) {
    const total = finiteToken(record.total_tokens);
    if (total == null) return null;
    return ceilNeurons(total * AI_NEURONS_PER_MILLION_OUTPUT);
  }
  return ceilNeurons((prompt ?? 0) * AI_NEURONS_PER_MILLION_INPUT + (completion ?? 0) * AI_NEURONS_PER_MILLION_OUTPUT);
}

export function identifyHttpBody(result: CaptureResult<IdentifyResponse>): { status: number; body: Record<string, unknown> } {
  if (result.ok) return { status: 200, body: { confidence: result.value.confidence, products: result.value.products } };
  const body: Record<string, unknown> = { code: result.error.code, error: result.error.error };
  if (result.error.failures) body.failures = result.error.failures;
  if (result.error.code === 'AI_UNAVAILABLE' || result.error.code === 'AI_TIMEOUT' || result.error.code === 'AI_INVALID_RESPONSE' || result.error.code === 'AI_LIMIT') {
    body.fallback = 'manual-entry';
  }
  return { status: result.status, body };
}

export function resolveProductIdentifier(input: {
  hooked: boolean;
  accountId: string | null;
  apiToken: string | null;
  userId: string;
  fake: ProductIdentifier;
  // 呼び出し側が captureTestEnv() で渡す。省略はテストモードではない。
  env?: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string };
  budget?: AiBudget;
  http?: WorkersAiHttp;
  now?: () => number;
  timeoutMs?: number;
}): ProductIdentifier {
  // 偽物は、本番以外かつ CAPTURE_TEST_HOOKS=1 のときだけ返す。
  const testMode = input.env?.NODE_ENV !== 'production' && input.env?.CAPTURE_TEST_HOOKS === '1';
  if (testMode && (input.hooked || !input.accountId || !input.apiToken)) return input.fake;
  if (!input.accountId || !input.apiToken) return unavailableIdentifier();
  const accountId = normalizeAccount(input.accountId);
  const apiToken = normalizeToken(input.apiToken);
  if (!accountId || !apiToken) return unavailableIdentifier();
  return createWorkersAiIdentifier({
    accountId,
    apiToken,
    userId: input.userId,
    budget: input.budget ?? appAiBudget(),
    http: input.http,
    now: input.now,
    timeoutMs: input.timeoutMs,
  });
}

function unavailableIdentifier(): ProductIdentifier {
  return {
    async identify(input) {
      const photo = decodeCapturePhoto([{ mediaType: input.mediaType, bytes: input.bytes }]);
      if (!photo.ok) return photo;
      return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
    },
  };
}

function utcDayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function finiteToken(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000_000) return null;
  return value;
}

function ceilNeurons(scaled: number): number {
  return Math.ceil(scaled / 1_000_000);
}

function createUsageMeter(): UsageMeter {
  let metered = 0;
  let sawUsage = false;
  return {
    note(response) {
      const neurons = neuronsIn(response);
      if (neurons == null) return;
      sawUsage = true;
      metered += neurons;
    },
    neurons() {
      return sawUsage ? metered : AI_NEURONS_WHEN_USAGE_MISSING;
    },
  };
}

function neuronsIn(response: WorkersAiHttpResponse): number | null {
  const parsed = parseJson(response.body);
  if (!parsed || typeof parsed !== 'object') return null;
  const result = (parsed as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const usage = (result as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  return finiteNeuronCount((usage as { neurons?: unknown }).neurons);
}

function isDailyCap(response: WorkersAiHttpResponse): boolean {
  if (response.status !== 429) return false;
  const parsed = parseJson(response.body);
  if (!parsed || typeof parsed !== 'object') return false;
  const errors = (parsed as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((error) => Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 3036);
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
