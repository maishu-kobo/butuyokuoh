// 写真の見た目から商品を推定する。モデルは docs/capture-ai.md。
// キーは呼び出し側が渡す。ここは環境変数を読まず、トークンも写真もログに出さない。
import type Database from 'better-sqlite3';
import { getDb } from '../db';
import {
  CaptureMessages,
  captureFailure,
  decodeCapturePhoto,
  type CaptureErrorCode,
  type CaptureResult,
  type IdentifyConfidence,
  type IdentifyResponse,
  type ProductGuess,
  type ProductIdentifier,
} from './contract';
import { composeCapturedProduct, copiedPromptExample, guessIsSpecific } from './product-query';
import { aiRequestBody, resolveAiModel } from './ai-variants';

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
  '写真に写っている商品を1つだけ見て、JSONオブジェクトだけを返してください。',
  '説明、Markdown、URL、前置きは付けません。',
  '{"confidence":"sure"|"unsure"|"unreadable","products":[{"name":"","brand":null,"model":null,"productType":null,"color":null,"jan":null}]}',
  'nameは簡潔な商品名1つです。色、容量、キャリアの候補をスラッシュ（/）で並べてはいけません。',
  '世代や型番が写真から読み取れないときは数字を推測せず、ブランドと商品の種類を両方書きます。種類を省いてブランド名だけにしない。',
  '見本のブランド名や商品名は書きません。写真に見えている文字だけを使い、指示文の語を商品名に写さない。',
  'productTypeは見えている種類を1語で書きます。分からなければnull。',
  'colorは見えている色を1つ。分からなければnull。色の候補をスラッシュで並べません。',
  'nameは日本の通販で探せる商品名にし、分かるブランド、シリーズ、色、種類を含めます。',
  'modelは見えているシリーズや型番です。種類の語だけをmodelに入れない。分からなければnull。',
  '色や種類しか分からないときは unsure。読めないブランド、型番、サイズを推測してはいけません。',
  'ブランドと、商品の種類またはシリーズが特定できた1商品だけなら sure。ブランド名だけなら unsure。似た候補が複数なら unsure で products は3つまで。',
  '商品が判別できなければ confidence は unreadable、products は空配列です。',
  '判別できたのに products を空にしてはいけません。',
  'バーコードは判定しません。janは必ずnull。分からないbrandとmodelもnull。',
].join('');

const AI_TRANSIENT_ATTEMPTS = 2;

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
  model?: string;
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
      const model = resolveAiModel(options.model);
      const url = accountId ? endpoint(accountId, model.id) : null;
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
          const dataUrl = `data:${photo.value.mediaType};base64,${Buffer.from(photo.value.bytes).toString('base64')}`;
          const imageBody = JSON.stringify(aiRequestBody(model, INSTRUCTION, 'この写真の商品をJSONで返してください。', dataUrl));
          for (let attempt = 0; attempt < AI_TRANSIENT_ATTEMPTS; attempt += 1) {
            const called = await callModel(http, url, apiToken, imageBody, timeoutMs);
            if (called.kind !== 'response') {
              if (attempt > 0 && !outcome.ok && outcome.error.code === 'AI_INVALID_RESPONSE') break;
              outcome = called.kind === 'timeout'
                ? retryableFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504)
                : retryableFailure('AI_UNAVAILABLE', CaptureMessages.aiRetryable, 503);
              if (attempt === 0) continue;
              break;
            }
            meter.note(called.response);
            if (isDailyCap(called.response)) {
              hitUpstreamCap = true;
              outcome = captureFailure('AI_LIMIT', AI_LIMIT_MESSAGE, 429);
              break;
            }
            if (agreementRequired(called.response)) {
              outcome = captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
              break;
            }
            if (called.response.status === 408 || called.response.status === 429 || called.response.status >= 500) {
              outcome = called.response.status === 408
                ? retryableFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504)
                : retryableFailure('AI_UNAVAILABLE', CaptureMessages.aiRetryable, 503);
              if (attempt === 0) continue;
              break;
            }
            outcome = interpret(called.response);
            if (!outcome.ok && outcome.error.retryable && attempt === 0) continue;
            break;
          }
        }
      } catch {
        outcome = retryableFailure('AI_UNAVAILABLE', CaptureMessages.aiRetryable, 503);
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
  if (result.error.retryable) body.retryable = true;
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
  model?: string;
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
    model: input.model,
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

function retryableFailure(code: CaptureErrorCode, error: string, status: number): CaptureResult<never> {
  const result = captureFailure(code, error, status);
  if (!result.ok) result.error.retryable = true;
  return result;
}

function agreementRequired(response: WorkersAiHttpResponse): boolean {
  if (response.status !== 403) return false;
  const parsed = parseJson(response.body);
  if (!parsed || typeof parsed !== 'object') return false;
  const errors = (parsed as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((error) => Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 5016);
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

function endpoint(accountId: string, modelId: string): string | null {
  const url = new URL(`https://${HOST}/client/v4/accounts/${accountId}/ai/run/${modelId}`);
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
  if (response.status === 408) return retryableFailure('AI_TIMEOUT', CaptureMessages.aiTimeout, 504);
  if (response.status >= 400) return captureFailure('AI_UNAVAILABLE', CaptureMessages.aiFailed, 503);
  if (response.body.length > MAX_RESPONSE_CHARS) {
    return retryableFailure('AI_INVALID_RESPONSE', CaptureMessages.aiRetryable, 502);
  }
  const parsed = parseJson(response.body);
  if (!parsed || typeof parsed !== 'object') {
    return retryableFailure('AI_INVALID_RESPONSE', CaptureMessages.aiRetryable, 502);
  }
  if ((parsed as { success?: unknown }).success === false) {
    return retryableFailure('AI_INVALID_RESPONSE', CaptureMessages.aiRetryable, 502);
  }
  const guess = parseGuess(extractModelOutput(parsed));
  if (guess.kind === 'invalid') return retryableFailure('AI_INVALID_RESPONSE', CaptureMessages.aiRetryable, 502);
  return { ok: true, value: guess.value };
}

function parseJson(body: string): unknown {
  if (!body || body.length > MAX_RESPONSE_CHARS) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function textOfContent(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = content.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text;
    }
    return '';
  }).join('');
  return text.trim() || null;
}

function choiceText(record: Record<string, unknown>): string | null {
  const choice = Array.isArray(record.choices) ? record.choices[0] : null;
  if (!choice || typeof choice !== 'object') return null;
  const message = (choice as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  return textOfContent((message as { content?: unknown }).content);
}

function visibleAnswer(text: string): string {
  let out = text;
  for (const marker of ['<channel|>', '</think>', '<|end_of_thought|>']) {
    const index = out.lastIndexOf(marker);
    if (index >= 0) out = out.slice(index + marker.length);
  }
  return out.trim();
}

function extractModelOutput(payload: object): unknown {
  const root = payload as Record<string, unknown>;
  const result = root.result;
  if (typeof result === 'string' && result.trim() && result.trim() !== 'null') return visibleAnswer(result);
  const bags = [result, root].filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
  for (const record of bags) {
    if (typeof record.response === 'string' && record.response.trim() && record.response.trim() !== 'null') {
      return visibleAnswer(record.response);
    }
    const choice = choiceText(record);
    if (choice) return visibleAnswer(choice);
    if (typeof record.confidence === 'string') return record;
  }
  return null;
}

type ParsedGuess =
  | { kind: 'guess'; value: IdentifyResponse }
  | { kind: 'invalid' };

function parseGuess(output: unknown): ParsedGuess {
  const value = typeof output === 'string' ? firstJsonObject(output) : output;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const record = value as { products?: unknown; confidence?: unknown };
  if (record.confidence === 'unreadable') return { kind: 'guess', value: { confidence: 'unreadable', products: [] } };
  if (!Array.isArray(record.products)) return { kind: 'invalid' };
  const products: ProductGuess[] = [];
  let catalog = false;
  let echoed = false;
  for (const item of record.products) {
    if (products.length >= MAX_PRODUCTS) break;
    const product = normalizeProduct(item);
    if (!product) continue;
    if (copiedPromptExample(product.product.name)) {
      echoed = true;
      continue;
    }
    const sanitized = sanitizeGuessProduct(product);
    if (!sanitized) continue;
    if (copiedPromptExample(sanitized.product.name)) {
      echoed = true;
      continue;
    }
    if (sanitized.catalog) catalog = true;
    products.push(sanitized.product);
  }
  if (products.length === 0) {
    if (echoed) return { kind: 'guess', value: { confidence: 'unreadable', products: [] } };
    return { kind: 'invalid' };
  }
  let confidence: IdentifyConfidence = record.confidence === 'sure' || record.confidence === 'unsure'
    ? record.confidence
    : 'unsure';
  if (confidence === 'sure' && products.length !== 1) confidence = 'unsure';
  // 一般名や非表示の推測値では商品を特定できた扱いにしない。
  if (catalog || products.some(product => !guessIsSpecific(product))) confidence = 'unsure';
  return { kind: 'guess', value: { confidence, products } };
}

function sanitizeGuessProduct(input: { product: ProductGuess; productType: string | null; color: string | null }): { product: ProductGuess; catalog: boolean } | null {
  const product = input.product;
  const named = sanitizeProductName(product.name);
  if (!named.name) return null;
  let catalog = named.catalog;
  let brand = product.brand;
  if (brand) {
    const cleaned = sanitizeProductName(brand);
    brand = cleaned.name || null;
    catalog = catalog || cleaned.catalog;
  }
  let model = product.model;
  if (catalog) {
    model = null;
  } else if (model) {
    const cleaned = sanitizeProductName(model);
    catalog = catalog || cleaned.catalog;
    model = catalog ? null : (cleaned.name || null);
  }
  const composed = composeCapturedProduct({
    name: named.name,
    brand,
    model,
    productType: catalog ? null : input.productType,
    color: catalog ? null : input.color,
    recoverSeries: !catalog,
  });
  if (!composed.name) return null;
  return { product: { ...product, name: composed.name, brand: composed.brand, model: composed.model }, catalog };
}

function sanitizeProductName(name: string): { name: string; catalog: boolean } {
  const normalized = name.replaceAll('／', '/');
  const hadList = /(?:^|\s)\S+(?:\/\S+){2,}(?:\s|$)/.test(normalized);
  let next = normalized.replace(/(?:^|\s)\S+(?:\/\S+){2,}(?=\s|$)/g, ' ');
  if (hadList) {
    next = next.replace(/\s*[（(][^（）()]{0,80}[）)]/g, ' ');
    next = next.replace(/(^|\s)\d{1,2}(?=\s|$)/g, ' ');
  }
  next = next.replace(/\s+/g, ' ').trim();
  if (next.includes('/')) {
    const slash = next.indexOf('/');
    const head = next.slice(0, slash).trim();
    const tail = next.slice(slash + 1).trim();
    const variantTail = tail.split('/').every((part) => {
      const token = part.trim();
      return token.length > 0 && token.length <= 24 && !token.includes(' ') && !/\d/.test(token);
    });
    if (variantTail && head) next = head;
  }
  next = next.replace(/\s+/g, ' ').trim();
  return { name: next, catalog: hadList || next !== normalized.trim() };
}

function normalizeProduct(item: unknown): { product: ProductGuess; productType: string | null; color: string | null } | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  const name = cleanLabel(record.name, 200);
  if (!name || isUrlish(name)) return null;
  return {
    product: {
      name,
      brand: optionalLabel(record.brand, 80),
      model: optionalLabel(record.model, 80),
      // LLMのJANはチェックサムが正しくても画像由来と検証できない。
      jan: null,
    },
    productType: optionalLabel(record.productType, 40),
    color: optionalLabel(record.color, 40),
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
