// 推測JSONを、ライブ評価と同じ採点の報告書に変える。通信はしない。
import { dropOtherCategories } from '../../../src/lib/capture/product-query';
import { exactProductTop5, scorePhoto } from './rubric';

export interface GuessProduct {
  name: string;
  brand: string | null;
  model: string | null;
  jan: string | null;
  lookup?: boolean;
}

export interface ParsedGuessFile {
  label: string;
  variant: string;
  model: string;
  ladder: boolean;
  estimatedNeuronsFor23: number;
  rows: Record<string, unknown>[];
}

export interface HarnessSearchResult {
  ok: boolean;
  code?: string;
  sent: { site: string; keyword: string; status?: number }[];
  failures: { site: string; code: string; error?: string }[];
  candidates: { site: string; title: string; price: number }[];
}

export interface LiveHarnessReport {
  label: string;
  variant: string;
  model: string;
  ladder: boolean;
  estimatedNeuronsFor23: number;
  have: { cf: boolean; yahoo: boolean; rakuten: boolean };
  refererSet: boolean;
  neurons: number;
  exactProduct: { evaluated: number; hits: number; unscored: number };
  diagnosticPoints: number;
  rows: Record<string, unknown>[];
}

export function parseGuessDocument(value: unknown): ParsedGuessFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('guesses JSON must be an object');
  const record = value as Record<string, unknown>;
  if (typeof record.variant !== 'string' || !record.variant.trim()) throw new Error('guesses JSON must name a variant');
  if (typeof record.model !== 'string' || !record.model.trim()) throw new Error('guesses JSON must name a model');
  if (typeof record.ladder !== 'boolean') throw new Error('guesses JSON must set ladder');
  if (!Array.isArray(record.rows)) throw new Error('guesses JSON must contain rows');
  return {
    label: typeof record.label === 'string' && record.label.trim() ? record.label : record.variant,
    variant: record.variant,
    model: record.model,
    ladder: record.ladder,
    estimatedNeuronsFor23: typeof record.estimatedNeuronsFor23 === 'number' && Number.isFinite(record.estimatedNeuronsFor23)
      ? record.estimatedNeuronsFor23
      : 0,
    rows: record.rows.map(parseRow),
  };
}

export async function searchGuessRows(input: {
  rows: Record<string, unknown>[];
  truth: Record<string, string[]>;
  ladder: boolean;
  search: (product: GuessProduct, ladder: boolean) => Promise<HarnessSearchResult>;
}): Promise<Record<string, unknown>[]> {
  const next: Record<string, unknown>[] = [];
  for (const row of input.rows) {
    const copy = { ...row };
    const product = firstProduct(copy);
    if (!product) {
      next.push(copy);
      continue;
    }
    copy.query = { name: product.name, brand: product.brand, model: product.model, jan: null };
    const started = Date.now();
    const result = await input.search(product, input.ladder);
    copy.searchMs = Date.now() - started;
    copy.sent = result.sent;
    copy.failures = result.failures;
    if (!result.ok) {
      copy.searchError = result.code ?? 'SEARCH_FAILED';
      next.push(copy);
      continue;
    }
    const candidates = dropOtherCategories(result.candidates, product.name);
    copy.counts = {
      yahoo: candidates.filter((item) => item.site === 'yahoo').length,
      rakuten: candidates.filter((item) => item.site === 'rakuten').length,
    };
    const top5 = candidates.slice(0, 5).map((item) => ({ site: item.site, title: item.title, price: item.price }));
    copy.top5 = top5;
    const counts = copy.counts as { yahoo: number; rakuten: number };
    copy.exactProductTop5 = exactProductTop5(top5.map((item) => item.title), input.truth[String(copy.id)]);
    copy.score = scorePhoto({
      id: String(copy.id),
      confidence: typeof copy.confidence === 'string' ? copy.confidence : '',
      name: product.name,
      brand: product.brand,
      hits: counts.yahoo + counts.rakuten,
      top3: top5.slice(0, 3).map((item) => item.title),
    });
    next.push(copy);
  }
  return next;
}

export function summarizeLiveReport(input: {
  label: string;
  variant: string;
  model: string;
  ladder: boolean;
  estimatedNeuronsFor23: number;
  have: { cf: boolean; yahoo: boolean; rakuten: boolean };
  refererSet: boolean;
  neurons?: number;
  rows: Record<string, unknown>[];
  truth: Record<string, string[]>;
}): LiveHarnessReport {
  const scores = input.rows.map((row) => row.score).filter((score): score is { points: number } => Boolean(score));
  const neurons = input.neurons ?? input.rows.reduce((sum, row) => sum + (typeof row.neurons === 'number' ? row.neurons : 0), 0);
  return {
    label: input.label,
    variant: input.variant,
    model: input.model,
    ladder: input.ladder,
    estimatedNeuronsFor23: input.estimatedNeuronsFor23,
    have: input.have,
    refererSet: input.refererSet,
    neurons: Math.round(neurons),
    exactProduct: {
      evaluated: input.rows.filter((row) => input.truth[String(row.id)]?.length).length,
      hits: input.rows.filter((row) => row.exactProductTop5 === true).length,
      unscored: input.rows.filter((row) => !input.truth[String(row.id)]?.length).length,
    },
    diagnosticPoints: scores.reduce((sum, score) => sum + score.points, 0),
    rows: input.rows,
  };
}

function parseRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('guess row must be an object');
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(record.id)) throw new Error('guess row id is invalid');
  const row: Record<string, unknown> = { id: record.id };
  if (typeof record.variant === 'string') row.variant = record.variant.slice(0, 80);
  if (typeof record.confidence === 'string') row.confidence = record.confidence.slice(0, 40);
  if (typeof record.neurons === 'number' && Number.isFinite(record.neurons)) row.neurons = record.neurons;
  if (typeof record.identifyMs === 'number' && Number.isFinite(record.identifyMs)) row.identifyMs = record.identifyMs;
  if (typeof record.identifyError === 'string') row.identifyError = record.identifyError.slice(0, 80);
  if (typeof record.error === 'string') row.error = record.error.slice(0, 80);
  const products = parseProducts(record.products);
  if (products.length > 0) row.products = products;
  if (Array.isArray(record.queries)) {
    row.queries = record.queries.filter((item): item is string => typeof item === 'string').slice(0, 4).map((item) => item.slice(0, 80));
  }
  if (Array.isArray(record.modelCalls)) row.modelCalls = record.modelCalls.slice(0, 4).map(sanitizeCall);
  return row;
}

function parseProducts(value: unknown): GuessProduct[] {
  if (!Array.isArray(value)) return [];
  const products: GuessProduct[] = [];
  for (const item of value) {
    if (products.length >= 5) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name.trim()) continue;
    products.push({
      name: record.name.replace(/\s+/g, ' ').trim().slice(0, 200),
      brand: optionalText(record.brand),
      model: optionalText(record.model),
      jan: null,
    });
  }
  return products;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function sanitizeCall(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const call: Record<string, unknown> = {};
  if (typeof record.status === 'number') call.status = record.status;
  if (typeof record.response === 'string') call.response = record.response.slice(0, 2000);
  if (typeof record.thrown === 'string') call.thrown = record.thrown.slice(0, 40);
  if (record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)) {
    const usage: Record<string, number | null> = {};
    for (const key of ['neurons', 'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'prompt_tokens', 'completion_tokens']) {
      const item = (record.usage as Record<string, unknown>)[key];
      usage[key] = typeof item === 'number' && Number.isFinite(item) ? item : null;
    }
    call.usage = usage;
  }
  return call;
}

function firstProduct(row: Record<string, unknown>): GuessProduct | null {
  const products = row.products;
  if (!Array.isArray(products) || !products[0] || typeof products[0] !== 'object') return null;
  const product = products[0] as Partial<GuessProduct>;
  if (typeof product.name !== 'string' || !product.name.trim()) return null;
  return {
    name: product.name,
    brand: typeof product.brand === 'string' ? product.brand : null,
    model: typeof product.model === 'string' ? product.model : null,
    jan: null,
  };
}
