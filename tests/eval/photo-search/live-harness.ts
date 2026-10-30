// 同じ23枚をバリアントごとに測る。秘密とリクエストURLは残さない。
// まとめて測る（Workers。予算の申告が要る）:
// node --import tsx tests/eval/photo-search/live-harness.ts --variant llama32-ladder --images tests/eval/photo-search/images --out /tmp/llama32-ladder.json --account-used-neurons 0 --usage-day 2026-10-29
// 推測だけ（Gemini。ECもDBも要らない。GEMINI_API_KEY だけ）:
// node --import tsx tests/eval/photo-search/live-harness.ts --mode guess --variant gemini-ladder --images tests/eval/photo-search/images --out /tmp/gemini-ladder-guesses.json
// 検索だけ（Yahoo と楽天のキーだけ。推測JSONを採点する）:
// node --import tsx tests/eval/photo-search/live-harness.ts --mode search --guesses /tmp/gemini-ladder-guesses.json --out /tmp/gemini-ladder.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveSearchVariant, SEARCH_VARIANTS, estimateNeurons, type SearchVariant } from '../../../src/lib/capture/ai-variants';
import { ensembleGuess } from '../../../src/lib/capture/ensemble';
import { GEMINI_EVIDENCE_SUFFIX, WORKERS_EVIDENCE_SUFFIX } from '../../../src/lib/capture/evidence-prompt';
import { maybeUpgradeWithFlash } from '../../../src/lib/capture/flash-fallback';
import { createGeminiIdentifier, GEMINI_DEFAULT_MODEL, GEMINI_LITE_MODEL, geminiConfigFromEnv } from '../../../src/lib/capture/gemini';
import { runGeminiFallback } from '../../../src/lib/capture/gemini-fallback';
import { BRAND_EVIDENCE_SUFFIX, guardIdentifyResult } from '../../../src/lib/capture/brand-guard';
import { rerankCandidates } from '../../../src/lib/capture/candidate-rerank';
import { dropOtherCategories } from '../../../src/lib/capture/product-query';
import { geminiCallsForPhoto, sumGeminiCalls, withGeminiHarnessRetry } from './gemini-retry';
import { parseGuessDocument, searchGuessRows, summarizeLiveReport, type GuessProduct, type HarnessSearchResult } from './split-run';
import { createEvaluationBudget, evaluationReservation, UNKNOWN_CALL_NEURONS } from './budget';

const root = process.cwd();
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const variantName = arg('--variant') ?? 'llama32';
const labelArg = arg('--label');
const out = arg('--out');
const imgDir = arg('--images');
const only = arg('--only');
const mode = arg('--mode') ?? 'all';
const mod = (file: string) => import(pathToFileURL(path.join(root, file)).href);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function envPathIsAbsolute() { return typeof process.env.BUTUYOKUOH_DB_PATH === 'string' && path.isAbsolute(process.env.BUTUYOKUOH_DB_PATH); }

function loadTruth(truthPath: string | null): Record<string, string[]> {
  const truth: Record<string, string[]> = truthPath ? JSON.parse(readFileSync(truthPath, 'utf8')) : {};
  if (!truth || Array.isArray(truth) || typeof truth !== 'object' || Object.values(truth).some((ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new Error('Truth must map photo ids to nonempty exact product identifiers');
  }
  return truth;
}

function serviceHave() {
  const env = process.env;
  return {
    cf: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
    yahoo: Boolean(env.YAHOO_SHOPPING_APP_ID),
    rakuten: Boolean(env.RAKUTEN_APP_ID && env.RAKUTEN_ACCESS_KEY),
  };
}

async function loadWorkersBudget() {
  const accountUsedRaw = arg('--account-used-neurons');
  const snapshotDay = arg('--usage-day');
  if (accountUsedRaw === null || !snapshotDay || !envPathIsAbsolute()) {
    throw new Error('Provide --account-used-neurons, --usage-day (UTC), and an absolute persistent BUTUYOKUOH_DB_PATH');
  }
  const db = (await mod('src/lib/db.ts')).getDb();
  return { accountUsedRaw, snapshotDay, db };
}

async function searchOnly() {
  const guessesPath = arg('--guesses');
  if (!out || !guessesPath) {
    console.error('need --guesses and --out');
    process.exit(1);
  }
  let guesses;
  try {
    guesses = parseGuessDocument(JSON.parse(readFileSync(guessesPath, 'utf8')));
  } catch {
    console.error('guesses JSON must name a variant and contain rows');
    process.exit(1);
  }
  if (arg('--variant') && arg('--variant') !== guesses.variant) {
    console.error('variant does not match the guesses file');
    process.exit(1);
  }
  const truth = loadTruth(arg('--truth'));
  const live = await mod('src/lib/capture/live-search.ts');
  const fakes = await mod('src/lib/capture/fakes.ts');
  const ladder = await mod('src/lib/capture/search-ladder.ts');
  const have = serviceHave();
  const referer = refererFromEnv(live);
  const label = labelArg ?? guesses.label;
  const scored: Record<string, unknown>[] = [];
  for (const row of guesses.rows) {
    const [next] = await searchGuessRows({
      rows: [row],
      truth,
      ladder: guesses.ladder,
      search: (product) => searchLive(product, guesses.ladder, String(row.id), live, fakes, ladder, referer, label),
    });
    scored.push(next);
    writeFileSync(out, `${JSON.stringify({ partial: true, variant: guesses.variant, rows: scored }, null, 2)}\n`);
    console.log(`${guesses.variant} ${String(row.id)} q=${JSON.stringify(next.query ?? null)} n=${JSON.stringify(next.counts ?? next.searchError ?? null)}`);
    await sleep(1500);
  }
  const report = summarizeLiveReport({
    label,
    variant: guesses.variant,
    model: guesses.model,
    ladder: guesses.ladder,
    estimatedNeuronsFor23: guesses.estimatedNeuronsFor23,
    have,
    refererSet: referer !== null,
    rows: scored,
    truth,
  });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`done ${guesses.variant} rows=${scored.length} neurons=${report.neurons} diagnosticPoints=${report.diagnosticPoints}`);
}

function guessQueries(value: object): string[] {
  const queries = (value as { queries?: unknown }).queries;
  return Array.isArray(queries) ? queries.filter((item): item is string => typeof item === 'string') : [];
}

function refererFromEnv(live: { httpsReferer: (origin: string | null) => string | null }): string | null {
  try { return process.env.AUTH_URL ? live.httpsReferer(new URL(process.env.AUTH_URL).origin) : null; } catch { return null; }
}

async function searchLive(
  product: GuessProduct,
  ladderOn: boolean,
  id: string,
  live: {
    installSearchTransportForTests: (next: object) => void;
    resolveSearchPorts: (input: object) => unknown;
    httpsReferer: (origin: string | null) => string | null;
  },
  fakes: { searchWithPorts: (query: object, ports: unknown, tag: null) => Promise<{ ok: boolean; error?: { code: string; failures?: { site: string; code: string }[] }; value?: { candidates: { site: string; title: string; price: number }[]; failures: { site: string; code: string }[] } }> },
  ladder: { searchWithLadder: (product: GuessProduct, ports: unknown, tag: null) => Promise<{ ok: boolean; error?: { code: string; failures?: { site: string; code: string }[] }; value?: { candidates: { site: string; title: string; price: number }[]; failures: { site: string; code: string }[] } }> },
  referer: string | null,
  label = labelArg ?? 'search',
): Promise<HarnessSearchResult> {
  const env = process.env;
  const sent: { site: string; keyword: string; status?: number }[] = [];
  live.installSearchTransportForTests({
    yahooFetch: async (url: string, init: RequestInit) => {
      const keyword = new URL(url).searchParams.get('query') ?? new URL(url).searchParams.get('jan_code') ?? '';
      const response = await fetch(url, init);
      sent.push({ site: 'yahoo', keyword, status: response.status });
      return response;
    },
    rakutenHttp: async (request: { url: string; headers: Record<string, string>; signal: AbortSignal }) => {
      const keyword = new URL(request.url).searchParams.get('keyword') ?? '';
      const response = await fetch(request.url, {
        method: 'GET', headers: request.headers, signal: request.signal, redirect: 'manual', cache: 'no-store',
      });
      const body = await response.text();
      sent.push({ site: 'rakuten', keyword, status: response.status });
      return { status: response.status, body };
    },
  });
  const ports = live.resolveSearchPorts({
    yahooAppId: env.YAHOO_SHOPPING_APP_ID ?? null,
    rakutenAppId: env.RAKUTEN_APP_ID ?? null,
    rakutenAccessKey: env.RAKUTEN_ACCESS_KEY ?? null,
    rakutenAffiliateId: env.RAKUTEN_AFFILIATE_ID ?? null,
    userId: `eval-${label}-${id}`,
    referer,
  });
  const query = { name: product.name, brand: product.brand, model: product.model, jan: null };
  const result = ladderOn
    ? await ladder.searchWithLadder(product, ports, null)
    : await fakes.searchWithPorts(query, ports, null);
  if (!result.ok) {
    return {
      ok: false,
      code: result.error?.code ?? 'SEARCH_FAILED',
      sent,
      failures: (result.error?.failures ?? []).map((failure) => ({ site: failure.site, code: failure.code })),
      candidates: [],
    };
  }
  return {
    ok: true,
    sent,
    failures: (result.value?.failures ?? []).map((failure) => ({ site: failure.site, code: failure.code })),
    candidates: (result.value?.candidates ?? []).map((item) => ({
      site: item.site,
      title: item.title,
      price: item.price,
      imageUrl: 'imageUrl' in item && typeof item.imageUrl === 'string' ? item.imageUrl : null,
    })),
  };
}

async function guessOrAll(selected: 'guess' | 'all') {
  if (!out || !imgDir) {
    console.error('need --images and --out');
    process.exit(1);
  }
  const variant = resolveSearchVariant(variantName);
  if (variant.name !== variantName) {
    console.error(`unknown variant. use: ${SEARCH_VARIANTS.map((item) => item.name).join(', ')}`);
    process.exit(1);
  }
  const evidencePrompt = variant.evidencePrompt === true;
  const gemini = variant.provider === 'gemini';
  const truth = selected === 'all' ? loadTruth(arg('--truth')) : {};
  const label = labelArg ?? variantName;
  let budget: Awaited<ReturnType<typeof createEvaluationBudget>> | null = null;
  let identifierUsage = 0;
  if (!gemini) {
    const loaded = await loadWorkersBudget();
    budget = createEvaluationBudget(
      loaded.db,
      Number(loaded.accountUsedRaw),
      loaded.snapshotDay,
      () => identifierUsage,
      evaluationReservation(variant.model.estimatedNeuronsPerPhoto),
    );
  }
  const geminiRun = gemini ? geminiConfigFromEnv({
    CAPTURE_AI_MODEL: evidencePrompt ? 'gemini-lite' : variant.name,
    GEMINI_MODEL: evidencePrompt ? undefined : process.env.GEMINI_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  }) : null;
  if (gemini && (!geminiRun?.model || !geminiRun.apiKey)) {
    console.error('GEMINI_API_KEY is required, and GEMINI_MODEL must be gemini-3.5-flash or gemini-3.5-flash-lite');
    process.exit(1);
  }
  const fallback = variant.provider === 'fallback';
  const brandGuard = variant.brandGuard === true;
  const workersSuffix = evidencePrompt ? WORKERS_EVIDENCE_SUFFIX : (brandGuard ? BRAND_EVIDENCE_SUFFIX : undefined);
  const geminiSuffix = evidencePrompt ? GEMINI_EVIDENCE_SUFFIX : undefined;
  let geminiCalls = 0;
  const rerankOn = variant.rerank === true && (process.env.CAPTURE_AI_RERANK === '1' || process.env.CAPTURE_AI_RERANK === 'true');
  const liteConfig = fallback
    ? geminiConfigFromEnv({ CAPTURE_AI_MODEL: 'gemini-lite', GEMINI_API_KEY: process.env.GEMINI_API_KEY })
    : null;
  const liteKey = liteConfig?.apiKey ?? null;
  const wa = gemini ? null : await mod('src/lib/capture/workers-ai.ts');
  const photo = await mod('src/lib/capture/photo.ts');
  const live = selected === 'all' ? await mod('src/lib/capture/live-search.ts') : null;
  const fakes = selected === 'all' ? await mod('src/lib/capture/fakes.ts') : null;
  const ladder = selected === 'all' ? await mod('src/lib/capture/search-ladder.ts') : null;
  const have = serviceHave();
  const referer = live ? refererFromEnv(live) : null;
  const files = readdirSync(imgDir).filter((file) => file.endsWith('.jpg')).sort();
  const flashKey = () => liteKey ?? geminiRun?.apiKey ?? null;
  async function upgradeGuess<G extends { ok: boolean; value?: { confidence: string; products: { name: string; brand: string | null }[] } }>(
    photo: { mediaType: string; bytes: Uint8Array },
    guess: G,
    calls: unknown[],
  ) {
    const key = flashKey();
    return maybeUpgradeWithFlash({
      enabled: variant.flashFallback === true,
      photo,
      guess,
      flash: key ? {
        async identify() {
          return identifyGemini(photo, key, GEMINI_DEFAULT_MODEL, calls, () => { geminiCalls += 1; }, GEMINI_EVIDENCE_SUFFIX);
        },
      } : null,
    });
  }
  const rows: Record<string, unknown>[] = [];
  let neurons = 0;
  let activeModel = variant.model;
  const actualModel = geminiRun?.model ?? variant.model.id;
  for (const file of files) {
    const id = file.replace(/\.jpg$/, '');
    if (only && !only.split(',').includes(id)) continue;
    const beforeNeurons = neurons;
    const geminiBefore = geminiCalls;
    const row: Record<string, unknown> = { id, variant: variant.name };
    const bytes = new Uint8Array(readFileSync(path.join(imgDir, file)));
    const prep = await photo.prepareCapturePhoto(bytes, 'image/jpeg');
    if (!prep.ok) { row.error = `prepare:${prep.error.code}`; rows.push(row); continue; }
    const calls: unknown[] = [];
    const started = Date.now();
    if (fallback && selected === 'all' && live && fakes && ladder) {
      const outcome = await runGeminiFallback({
        photo: prep.value,
        primary: {
          async identify() {
            const raw = await identifyWorkers(prep.value, variant, id, label, wa, budget!, calls, () => identifierUsage, (next) => { identifierUsage = next; }, (model) => { activeModel = model; }, () => activeModel, (charged) => { neurons += charged; identifierUsage += charged; }, workersSuffix);
            return brandGuard ? guardIdentifyResult(raw) : raw;
          },
        },
        gemini: liteKey ? { async identify() { return identifyGemini(prep.value, liteKey, GEMINI_LITE_MODEL, calls, () => { geminiCalls += 1; }, geminiSuffix); } } : null,
        search: async (product) => {
          const value = await searchLive(product, true, id, live, fakes, ladder, referer);
          const visible = value.ok ? dropOtherCategories(value.candidates, product.name) : [];
          return { hits: visible.length, value: { ...value, candidates: visible } };
        },
      });
      const flashed = await upgradeGuess(prep.value, outcome.guess, calls);
      if (flashed.usedFlash) row.usedFlash = true;
      const previous = outcome.guess.ok ? outcome.guess.value?.products[0] : null;
      outcome.guess = flashed.guess;
      const upgraded = outcome.guess.ok ? outcome.guess.value?.products[0] : null;
      if (flashed.usedFlash && upgraded && (upgraded.name !== previous?.name || upgraded.brand !== previous?.brand)) {
        const value = await searchLive(upgraded, true, id, live, fakes, ladder, referer);
        const visible = value.ok ? dropOtherCategories(value.candidates, upgraded.name) : [];
        outcome.found = { hits: visible.length, value: { ...value, candidates: visible } };
        outcome.usedGemini = true;
      }
      row.identifyMs = Date.now() - started;
      row.modelCalls = calls;
      row.neurons = Math.round((neurons - beforeNeurons) * 1000) / 1000;
      row.usedGemini = outcome.usedGemini;
      if (rerankOn && liteKey && outcome.found?.value.ok) {
        const ranked = await rerankCandidates({
          photo: prep.value,
          candidates: outcome.found.value.candidates,
          apiKey: liteKey,
          complete: async (request) => {
            geminiCalls += 1;
            const response = await fetch(request.url, {
              method: 'POST', redirect: 'manual', cache: 'no-store', headers: request.headers, body: request.body, signal: request.signal,
            });
            return { status: response.status, body: await response.text() };
          },
        });
        outcome.found = { hits: outcome.found.hits, value: { ...outcome.found.value, candidates: ranked.candidates } };
      }
      row.geminiCalls = geminiCallsForPhoto(geminiCalls, geminiBefore);
      if (!outcome.guess.ok) {
        if (outcome.guess.error?.code === 'AI_LIMIT') { rows.push({ ...row, identifyError: 'AI_LIMIT' }); break; }
        row.identifyError = outcome.guess.error?.code ?? 'AI_UNAVAILABLE';
        rows.push(row);
        writePartial(selected, label, variant, actualModel, rows);
        await sleep(1500);
        continue;
      }
      if (!outcome.guess.value || outcome.guess.value.products.length === 0) {
        if (outcome.guess.value) {
          row.confidence = outcome.guess.value.confidence;
          row.products = outcome.guess.value.products;
          row.queries = guessQueries(outcome.guess.value);
        }
        rows.push(row);
        writePartial(selected, label, variant, actualModel, rows);
        await sleep(1500);
        continue;
      }
      const chosen = outcome.guess.value.products[0];
      row.confidence = outcome.guess.value.confidence;
      row.products = outcome.guess.value.products;
      row.queries = guessQueries(outcome.guess.value);
      row.query = { name: chosen.name, brand: chosen.brand, model: chosen.model, jan: null };
      if (outcome.found) {
        const cached = outcome.found.value;
        const [scored] = await searchGuessRows({
          rows: [row],
          truth,
          ladder: true,
          search: async () => cached,
        });
        rows.push(scored);
      } else {
        rows.push(row);
      }
      writePartial(selected, label, variant, actualModel, rows);
      console.log(`${variant.name} ${id} conf=${row.confidence ?? row.identifyError} q=${JSON.stringify(row.query ?? null)} n=${JSON.stringify(row.counts ?? row.searchError ?? null)}`);
      await sleep(1500);
      continue;
    }
    const identifiedRaw = gemini
      ? await identifyGemini(prep.value, geminiRun!.apiKey!, geminiRun!.model!, calls, () => { geminiCalls += 1; }, geminiSuffix)
      : await identifyWorkers(prep.value, variant, id, label, wa, budget!, calls, () => identifierUsage, (next) => { identifierUsage = next; }, (model) => { activeModel = model; }, () => activeModel, (charged) => { neurons += charged; identifierUsage += charged; }, workersSuffix);
    const guarded = brandGuard ? guardIdentifyResult(identifiedRaw) : identifiedRaw;
    const flashed = await upgradeGuess(prep.value, guarded, calls);
    const identified = flashed.guess;
    if (flashed.usedFlash) row.usedFlash = true;
    row.geminiCalls = geminiCallsForPhoto(geminiCalls, geminiBefore);
    if (!identified.ok && identified.error.code === 'AI_LIMIT') { rows.push({ ...row, identifyError: 'AI_LIMIT' }); break; }
    row.identifyMs = Date.now() - started;
    row.modelCalls = calls;
    row.neurons = gemini ? 0 : Math.round((neurons - beforeNeurons) * 1000) / 1000;
    if (!identified.ok || identified.value.products.length === 0) {
      if (identified.ok) {
        row.confidence = identified.value.confidence;
        row.products = identified.value.products;
        row.queries = guessQueries(identified.value);
      } else {
        row.identifyError = identified.error.code;
      }
      rows.push(row);
      writePartial(selected, label, variant, actualModel, rows);
      await sleep(1500);
      continue;
    }
    row.confidence = identified.value.confidence;
    row.products = identified.value.products;
    row.queries = guessQueries(identified.value);
    const product = identified.value.products[0];
    row.query = { name: product.name, brand: product.brand, model: product.model, jan: null };
    if (selected === 'all' && live && fakes && ladder) {
      const [scored] = await searchGuessRows({
        rows: [row],
        truth,
        ladder: variant.ladder,
        search: (item) => searchLive(item, variant.ladder, id, live, fakes, ladder, referer),
      });
      rows.push(scored);
    } else {
      rows.push(row);
    }
    writePartial(selected, label, variant, actualModel, rows);
    console.log(`${variant.name} ${id} conf=${row.confidence ?? row.identifyError} q=${JSON.stringify(row.query ?? null)} n=${JSON.stringify(row.counts ?? row.searchError ?? null)}`);
    await sleep(1500);
  }
  if (selected === 'guess') {
    const guessFile = {
      mode: 'guess',
      label,
      variant: variant.name,
      model: actualModel,
      ladder: variant.ladder,
      estimatedNeuronsFor23: variant.estimatedNeuronsFor23,
      rows,
    };
    writeFileSync(out, `${JSON.stringify(guessFile, null, 2)}\n`);
    console.log(`done guess ${variant.name} rows=${rows.length}`);
    return;
  }
  const report = {
    ...summarizeLiveReport({
      label,
      variant: variant.name,
      model: actualModel,
      ladder: variant.ladder,
      estimatedNeuronsFor23: variant.estimatedNeuronsFor23,
      have,
      refererSet: referer !== null,
      neurons: Math.round(neurons),
      rows,
      truth,
    }),
    geminiCalls: sumGeminiCalls(rows),
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`done ${variant.name} rows=${rows.length} neurons=${report.neurons} diagnosticPoints=${report.diagnosticPoints}`);
}

function writePartial(selected: 'guess' | 'all', label: string, variant: SearchVariant, model: string, rows: Record<string, unknown>[]) {
  if (!out) return;
  const body = selected === 'guess'
    ? { mode: 'guess', partial: true, label, variant: variant.name, model, ladder: variant.ladder, estimatedNeuronsFor23: variant.estimatedNeuronsFor23, rows }
    : { partial: true, variant: variant.name, rows };
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
}

async function identifyGemini(
  photo: { mediaType: string; bytes: Uint8Array },
  apiKey: string,
  model: string,
  calls: unknown[],
  onCall?: () => void,
  instructionSuffix?: string,
) {
  let lastStatus = 0;
  const http = async (request: { url: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    try {
      const response = await fetch(request.url, {
        method: 'POST', redirect: 'manual', cache: 'no-store', headers: request.headers, body: request.body, signal: request.signal,
      });
      lastStatus = response.status;
      const body = await response.text();
      let text: string | null = null;
      let usage: Record<string, number | null> | null = null;
      try {
        const parsed = JSON.parse(body) as {
          candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
          usageMetadata?: Record<string, unknown>;
        };
        const parts = parsed.candidates?.[0]?.content?.parts ?? [];
        text = parts.filter((part) => part && typeof part.text === 'string' && part.thought !== true).map((part) => part.text).join('');
        const meta = parsed.usageMetadata;
        if (meta) {
          usage = {};
          for (const key of ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount']) {
            const value = meta[key];
            usage[key] = typeof value === 'number' ? value : null;
          }
        }
      } catch { /* not json */ }
      calls.push({ status: response.status, response: text ? text.slice(0, 2000) : null, usage });
      return { status: response.status, body };
    } catch (error) {
      lastStatus = 0;
      calls.push({ status: 0, thrown: error instanceof Error ? error.name : 'error' });
      return { status: 0, body: '' };
    }
  };
  return withGeminiHarnessRetry({
    sleep,
    run: async () => {
      onCall?.();
      const value = await createGeminiIdentifier({ apiKey, model, http, attempts: 1, instructionSuffix }).identify(photo);
      return { status: lastStatus, value };
    },
  });
}

async function identifyWorkers(
  photo: { mediaType: string; bytes: Uint8Array },
  variant: SearchVariant,
  id: string,
  label: string,
  wa: { createWorkersAiIdentifier: (options: object) => { identify: (input: object) => Promise<{ ok: true; value: { confidence: 'sure' | 'unsure' | 'unreadable'; products: GuessProduct[] } } | { ok: false; error: { code: string } }> } },
  budget: ReturnType<typeof createEvaluationBudget>,
  calls: unknown[],
  usage: () => number,
  setUsage: (next: number) => void,
  setModel: (model: SearchVariant['model']) => void,
  model: () => SearchVariant['model'],
  charge: (neurons: number) => void,
  instructionSuffix?: string,
) {
  const env = process.env;
  const http = async (request: { url: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    try {
      const response = await fetch(request.url, {
        method: 'POST', redirect: 'manual', cache: 'no-store', headers: request.headers, body: request.body, signal: request.signal,
      });
      const body = await response.text();
      let text: unknown = null;
      let tokenUsage: { neurons?: number; prompt_tokens?: number; completion_tokens?: number } | null = null;
      let errors: unknown = null;
      try {
        const parsed = JSON.parse(body) as {
          result?: { response?: unknown; usage?: { neurons?: number; prompt_tokens?: number; completion_tokens?: number } };
          errors?: { code?: unknown; message?: unknown }[];
        };
        text = parsed.result?.response ?? null;
        tokenUsage = parsed.result?.usage ?? null;
        errors = Array.isArray(parsed.errors)
          ? parsed.errors.map((item) => ({ code: item.code, message: String(item.message ?? '').slice(0, 200) }))
          : null;
      } catch { /* not json */ }
      const measured = tokenUsage && typeof tokenUsage.neurons === 'number' ? tokenUsage.neurons
        : tokenUsage && typeof tokenUsage.prompt_tokens === 'number' && typeof tokenUsage.completion_tokens === 'number'
          ? estimateNeurons(model(), tokenUsage.prompt_tokens, tokenUsage.completion_tokens) : UNKNOWN_CALL_NEURONS;
      const charged = Number.isFinite(measured) && measured > 0 ? measured : UNKNOWN_CALL_NEURONS;
      charge(charged);
      calls.push({
        status: response.status,
        response: typeof text === 'string' ? text.slice(0, 2000) : JSON.stringify(text)?.slice(0, 2000),
        usage: tokenUsage,
        errors,
      });
      return { status: response.status, body };
    } catch (error) {
      charge(UNKNOWN_CALL_NEURONS);
      calls.push({ status: 0, thrown: error instanceof Error ? error.name : 'error' });
      throw error;
    }
  };
  const identifyWith = (modelId: string, userSuffix: string) => {
    setUsage(0);
    setModel(variant.secondModel?.id === modelId ? variant.secondModel : variant.model);
    return wa.createWorkersAiIdentifier({
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
      apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
      userId: `eval-${label}-${id}-${userSuffix}`,
      model: modelId,
      budget,
      http,
      instructionSuffix,
    });
  };
  const identified = await identifyWith(variant.model.id, 'a').identify(photo);
  if (!identified.ok && identified.error.code === 'AI_LIMIT') return identified;
  if (variant.provider !== 'workers' || !variant.secondModel) return identified;
  const second = await identifyWith(variant.secondModel.id, 'b').identify(photo);
  if (identified.ok && second.ok) {
    const combined = ensembleGuess(
      { confidence: identified.value.confidence, product: identified.value.products[0] ?? null },
      { confidence: second.value.confidence, product: second.value.products[0] ?? null },
    );
    const merged = combined.product
      ? { confidence: combined.confidence, products: [combined.product] }
      : { confidence: 'unreadable' as const, products: [] };
    return { ok: true as const, value: merged };
  }
  if (!identified.ok && second.ok) return second;
  return identified;
}

async function main() {
  if (mode !== 'all' && mode !== 'guess' && mode !== 'search') {
    console.error('mode must be all, guess, or search');
    process.exit(1);
  }
  if (mode === 'search') {
    await searchOnly();
    return;
  }
  await guessOrAll(mode);
}

main().catch((error: unknown) => {
  console.error('harness failed', error instanceof Error ? error.name : '');
  process.exit(1);
});
