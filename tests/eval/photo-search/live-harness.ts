// 同じ23枚をバリアントごとに測る。秘密とリクエストURLは残さない。
// node --import tsx tests/eval/photo-search/live-harness.ts --variant llama32-ladder --images tests/eval/photo-search/images --out /tmp/llama32-ladder.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveSearchVariant, SEARCH_VARIANTS, estimateNeurons } from '../../../src/lib/capture/ai-variants';
import { ensembleGuess } from '../../../src/lib/capture/ensemble';
import { dropOtherCategories } from '../../../src/lib/capture/product-query';
import { scorePhoto, exactProductTop5 } from './rubric';
import { createEvaluationBudget, UNKNOWN_CALL_NEURONS } from './budget';

const root = process.cwd();
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const variantName = arg('--variant') ?? 'llama32';
const label = arg('--label') ?? variantName;
const out = arg('--out');
const imgDir = arg('--images');
const only = arg('--only');
const mod = (file: string) => import(pathToFileURL(path.join(root, file)).href);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function envPathIsAbsolute() { return typeof process.env.BUTUYOKUOH_DB_PATH === 'string' && path.isAbsolute(process.env.BUTUYOKUOH_DB_PATH); }

async function main() {
  if (!out || !imgDir) {
    console.error('need --images and --out');
    process.exit(1);
  }
  const accountUsedRaw = arg('--account-used-neurons');
  const snapshotDay = arg('--usage-day');
  if (accountUsedRaw === null || !snapshotDay || !envPathIsAbsolute()) {
    throw new Error('Provide --account-used-neurons, --usage-day (UTC), and an absolute persistent BUTUYOKUOH_DB_PATH');
  }
  const truthPath = arg('--truth');
  const truth: Record<string, string[]> = truthPath ? JSON.parse(readFileSync(truthPath, 'utf8')) : {};
  if (!truth || Array.isArray(truth) || typeof truth !== 'object' || Object.values(truth).some((ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new Error('Truth must map photo ids to nonempty exact product identifiers');
  }
  const variant = resolveSearchVariant(variantName);
  if (variant.name !== variantName) {
    console.error(`unknown variant. use: ${SEARCH_VARIANTS.map((item) => item.name).join(', ')}`);
    process.exit(1);
  }
  const wa = await mod('src/lib/capture/workers-ai.ts');
  const photo = await mod('src/lib/capture/photo.ts');
  const live = await mod('src/lib/capture/live-search.ts');
  const fakes = await mod('src/lib/capture/fakes.ts');
  const ladder = await mod('src/lib/capture/search-ladder.ts');
  const env = process.env;
  const have = {
    cf: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
    yahoo: Boolean(env.YAHOO_SHOPPING_APP_ID),
    rakuten: Boolean(env.RAKUTEN_APP_ID && env.RAKUTEN_ACCESS_KEY),
  };
  let referer: string | null = null;
  try { referer = env.AUTH_URL ? live.httpsReferer(new URL(env.AUTH_URL).origin) : null; } catch { referer = null; }
  const files = readdirSync(imgDir).filter((file) => file.endsWith('.jpg')).sort();
  const rows: Record<string, unknown>[] = [];
  let neurons = 0;
  let identifierUsage = 0;
  let activeModel = variant.model;
  const db = (await mod('src/lib/db.ts')).getDb();
  const budget = createEvaluationBudget(db, Number(accountUsedRaw), snapshotDay, () => identifierUsage);
  for (const file of files) {
    const id = file.replace(/\.jpg$/, '');
    if (only && !only.split(',').includes(id)) continue;
    const beforeNeurons = neurons;
    const row: Record<string, unknown> = { id, variant: variant.name };
    const bytes = new Uint8Array(readFileSync(path.join(imgDir, file)));
    const prep = await photo.prepareCapturePhoto(bytes, 'image/jpeg');
    if (!prep.ok) { row.error = `prepare:${prep.error.code}`; rows.push(row); continue; }
    const calls: unknown[] = [];
    const http = async (request: { url: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => {
      try {
        const response = await fetch(request.url, {
          method: 'POST', redirect: 'manual', cache: 'no-store', headers: request.headers, body: request.body, signal: request.signal,
        });
        const body = await response.text();
        let text: unknown = null;
        let usage: { neurons?: number; prompt_tokens?: number; completion_tokens?: number } | null = null;
        let errors: unknown = null;
        try {
          const parsed = JSON.parse(body) as {
            result?: { response?: unknown; usage?: { neurons?: number; prompt_tokens?: number; completion_tokens?: number } };
            errors?: { code?: unknown; message?: unknown }[];
          };
          text = parsed.result?.response ?? null;
          usage = parsed.result?.usage ?? null;
          errors = Array.isArray(parsed.errors)
            ? parsed.errors.map((item) => ({ code: item.code, message: String(item.message ?? '').slice(0, 200) }))
            : null;
        } catch { /* not json */ }
        const measured = usage && typeof usage.neurons === 'number' ? usage.neurons
          : usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number'
            ? estimateNeurons(activeModel, usage.prompt_tokens, usage.completion_tokens) : UNKNOWN_CALL_NEURONS;
        const charged = Number.isFinite(measured) && measured > 0 ? measured : UNKNOWN_CALL_NEURONS;
        neurons += charged;
        identifierUsage += charged;
        calls.push({
          status: response.status,
          response: typeof text === 'string' ? text.slice(0, 2000) : JSON.stringify(text)?.slice(0, 2000),
          usage,
          errors,
        });
        return { status: response.status, body };
      } catch (error) {
        neurons += UNKNOWN_CALL_NEURONS;
        identifierUsage += UNKNOWN_CALL_NEURONS;
        calls.push({ status: 0, thrown: error instanceof Error ? error.name : 'error' });
        throw error;
      }
    };
    const identifyWith = (modelId: string, userSuffix: string) => {
      identifierUsage = 0;
      activeModel = variant.secondModel?.id === modelId ? variant.secondModel : variant.model;
      return wa.createWorkersAiIdentifier({
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
      apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
      userId: `eval-${label}-${id}-${userSuffix}`,
      model: modelId,
      budget,
      http,
    });
    };
    const started = Date.now();
    const identified = await identifyWith(variant.model.id, 'a').identify(prep.value);
    if (!identified.ok && identified.error.code === 'AI_LIMIT') { rows.push({ ...row, identifyError: 'AI_LIMIT' }); break; }
    let merged = identified.ok ? identified.value : null;
    if (variant.secondModel) {
      const second = await identifyWith(variant.secondModel.id, 'b').identify(prep.value);
      if (identified.ok && second.ok) {
        const combined = ensembleGuess(
          { confidence: identified.value.confidence, product: identified.value.products[0] ?? null },
          { confidence: second.value.confidence, product: second.value.products[0] ?? null },
        );
        merged = combined.product
          ? { confidence: combined.confidence, products: [combined.product] }
          : { confidence: 'unreadable' as const, products: [] };
      } else if (!identified.ok && second.ok) {
        merged = second.value;
      }
    }
    row.identifyMs = Date.now() - started;
    row.modelCalls = calls;
    row.neurons = Math.round((neurons - beforeNeurons) * 1000) / 1000;
    if (!merged) { row.identifyError = identified.ok ? 'AI_INVALID_RESPONSE' : identified.error.code; rows.push(row); await sleep(1500); continue; }
    row.confidence = merged.confidence;
    row.products = merged.products;
    const product = merged.products[0] ?? null;
    if (product) {
      const query = { name: product.name, brand: product.brand, model: product.model, jan: product.jan ?? null };
      row.query = query;
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
      const searchStarted = Date.now();
      const result = variant.ladder
        ? await ladder.searchWithLadder(product, ports, null)
        : await fakes.searchWithPorts(query, ports, null);
      row.searchMs = Date.now() - searchStarted;
      row.sent = sent;
      if (!result.ok) {
        row.searchError = result.error.code;
        row.failures = (result.error.failures ?? []).map((failure: { site: string; code: string }) => ({ site: failure.site, code: failure.code }));
      } else {
        const raw = result.value.candidates as { site: string; title: string; price: number }[];
        const candidates = dropOtherCategories(raw, product.name);
        row.failures = result.value.failures.map((failure: { site: string; code: string }) => ({ site: failure.site, code: failure.code }));
        row.counts = {
          yahoo: candidates.filter((item) => item.site === 'yahoo').length,
          rakuten: candidates.filter((item) => item.site === 'rakuten').length,
        };
        row.top5 = candidates.slice(0, 5).map((item) => ({ site: item.site, title: item.title, price: item.price }));
      }
      const counts = row.counts as { yahoo?: number; rakuten?: number } | undefined;
      const top5 = (row.top5 as { title: string }[] | undefined) ?? [];
      row.exactProductTop5 = exactProductTop5(top5.map((item) => item.title), truth[id]);
      row.score = scorePhoto({
        id,
        confidence: String(row.confidence ?? ''),
        name: product.name,
        brand: product.brand,
        hits: (counts?.yahoo ?? 0) + (counts?.rakuten ?? 0),
        top3: top5.slice(0, 3).map((item) => item.title),
      });
    }
    rows.push(row);
    writeFileSync(out, `${JSON.stringify({ partial: true, variant: variant.name, rows }, null, 2)}\n`);
    console.log(`${variant.name} ${id} conf=${row.confidence ?? row.identifyError} q=${JSON.stringify(row.query ?? null)} n=${JSON.stringify(row.counts ?? row.searchError ?? null)}`);
    await sleep(1500);
  }
  const scores = rows.map((row) => row.score).filter((score): score is { points: number } => Boolean(score));
  const report = {
    label,
    variant: variant.name,
    model: variant.model.id,
    ladder: variant.ladder,
    estimatedNeuronsFor23: variant.estimatedNeuronsFor23,
    have,
    refererSet: referer !== null,
    neurons: Math.round(neurons),
    exactProduct: {
      evaluated: rows.filter((row) => truth[String(row.id)]?.length).length,
      hits: rows.filter((row) => row.exactProductTop5 === true).length,
      unscored: rows.filter((row) => !truth[String(row.id)]?.length).length,
    },
    diagnosticPoints: scores.reduce((sum, score) => sum + score.points, 0),
    rows,
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`done ${variant.name} rows=${rows.length} neurons=${Math.round(neurons)} diagnosticPoints=${report.diagnosticPoints}`);
}

main().catch((error: unknown) => {
  console.error('harness failed', error instanceof Error ? error.name : '');
  process.exit(1);
});
