// 写真の推定JSONから検索語と候補の並びを測る。
// モデルと店のAPIは、この環境にキーが無いときは呼ばない。
// 使い方: node --import tsx scripts/eval-photo-search.ts --out scripts/eval-photo-search/after.json
import { writeFileSync } from 'node:fs';
import { createWorkersAiIdentifier, type WorkersAiHttpResponse } from '../src/lib/capture/workers-ai';
import { textQueryVariants } from '../src/lib/capture/search-attempt';
import { sortCandidates, type CaptureCandidate, type ProductGuess, type SearchQuery } from '../src/lib/capture/contract';
import { EVAL_CASES, type EvalCase } from './eval-photo-search/cases';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const ACCOUNT = 'a'.repeat(32);

interface CaseResult {
  id: string;
  label: string;
  category: string;
  callout: boolean;
  typeAbsent: boolean;
  confidence: string;
  autoSearch: boolean;
  query: string;
  keepsBrand: boolean;
  keepsType: boolean;
  keepsColor: boolean | null;
  keepsModel: boolean | null;
  brandOnly: boolean;
  brandOnlyAutoSearch: boolean;
  top5Category: number;
  top5: string[];
}

interface Summary {
  cases: number;
  recoverable: number;
  keepsBrand: number;
  keepsType: number;
  keepsColor: string;
  keepsModel: string;
  brandOnly: number;
  brandOnlyAutoSearch: number;
  top5CategoryHits: number;
  top5CategorySlots: number;
  top5CategoryRate: number;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function cf(text: string): WorkersAiHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({ success: true, result: { response: text }, errors: [], messages: [] }),
  };
}

function keywordOf(query: SearchQuery): string {
  const first = textQueryVariants(query)[0];
  if (!first) return '';
  return [first.name, first.brand ?? '', first.model ?? ''].map((part) => part.trim()).filter(Boolean).join(' ');
}

function includesToken(text: string, token: string): boolean {
  return text.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(token.normalize('NFKC').toLocaleLowerCase('ja-JP'));
}

function matchesGroup(title: string, terms: readonly string[]): boolean {
  return terms.some((term) => includesToken(title, term));
}

function catalogFor(item: EvalCase): CaptureCandidate[] {
  const wrong = item.wrongTerms.map((term, index) => candidate(item, `w${index}`, `${item.brandToken} ${term}`, 1000 + index * 100));
  const right = item.rightTerms.map((term, index) => candidate(item, `r${index}`, `${item.brandToken} ${term} 正規品`, 40000 + index * 5000));
  return [...wrong, ...right];
}

function candidate(item: EvalCase, suffix: string, title: string, price: number): CaptureCandidate {
  return {
    id: `yahoo:${item.id}-${suffix}`,
    site: 'yahoo',
    title,
    price,
    url: `https://store.shopping.yahoo.co.jp/example/${item.id}-${suffix}`,
    fetchedAt: '2026-10-27T00:00:00.000Z',
    shopName: '評価ショップ',
  };
}

async function identify(item: EvalCase): Promise<{ confidence: string; product: ProductGuess | null }> {
  const identifier = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: 'eval-token',
    userId: `eval-${item.id}`,
    now: () => 1_000,
    http: async () => cf(JSON.stringify(item.raw)),
  });
  const result = await identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
  if (!result.ok) return { confidence: result.error.code, product: null };
  return { confidence: result.value.confidence, product: result.value.products[0] ?? null };
}

function rate(hits: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((hits / total) * 1000) / 1000;
}

async function main() {
  const rows: CaseResult[] = [];
  for (const item of EVAL_CASES) {
    const identified = await identify(item);
    const product = identified.product;
    const query: SearchQuery = {
      name: product?.name ?? '',
      brand: product?.brand ?? null,
      model: product?.model ?? null,
      jan: product?.jan ?? null,
    };
    const text = keywordOf(query);
    const keepsType = matchesGroup(text, item.groupTerms);
    const keepsColor = item.colorToken ? includesToken(text, item.colorToken) : null;
    const keepsModel = item.modelToken ? includesToken(text, item.modelToken) : null;
    const brandOnly = !keepsType;
    const autoSearch = identified.confidence === 'sure';
    const ranked = product ? sortCandidates(catalogFor(item), query).slice(0, 5) : [];
    const top5Category = ranked.filter((hit) => matchesGroup(hit.title, item.groupTerms)).length;
    rows.push({
      id: item.id,
      label: item.label,
      category: item.category,
      callout: item.callout === true,
      typeAbsent: item.typeAbsent === true,
      confidence: identified.confidence,
      autoSearch,
      query: text,
      keepsBrand: includesToken(text, item.brandToken),
      keepsType,
      keepsColor,
      keepsModel,
      brandOnly,
      brandOnlyAutoSearch: brandOnly && autoSearch,
      top5Category,
      top5: ranked.map((hit) => hit.title),
    });
  }

  const recoverable = rows.filter((row) => !row.typeAbsent);
  const colorRows = rows.filter((row) => row.keepsColor !== null);
  const modelRows = rows.filter((row) => row.keepsModel !== null);
  const summary: Summary = {
    cases: rows.length,
    recoverable: recoverable.length,
    keepsBrand: rows.filter((row) => row.keepsBrand).length,
    keepsType: recoverable.filter((row) => row.keepsType).length,
    keepsColor: `${colorRows.filter((row) => row.keepsColor).length}/${colorRows.length}`,
    keepsModel: `${modelRows.filter((row) => row.keepsModel).length}/${modelRows.length}`,
    brandOnly: rows.filter((row) => row.brandOnly).length,
    brandOnlyAutoSearch: rows.filter((row) => row.brandOnlyAutoSearch).length,
    top5CategoryHits: recoverable.reduce((sum, row) => sum + row.top5Category, 0),
    top5CategorySlots: recoverable.length * 5,
    top5CategoryRate: rate(
      recoverable.reduce((sum, row) => sum + row.top5Category, 0),
      recoverable.length * 5,
    ),
  };

  const report = {
    label: arg('--label') ?? 'after',
    mode: 'offline-fixture',
    liveModel: false,
    liveStores: false,
    imageCorpus: 'tests/eval/photo-search/sources.json',
    note: 'Workers AI と Yahoo/楽天の検索APIはキーが無いため未実行。推定は cases.ts の記録済みモデルJSONを識別器に通した結果で、同梱写真の画素はモデルに入れていない。候補の上位5件は、安い別カテゴリを混ぜた固定カタログを sortCandidates で並べた結果。',
    summary,
    rows,
  };
  const out = arg('--out');
  const json = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, `${json}\n`);
  console.log(JSON.stringify(summary, null, 2));
  const callout = rows.find((row) => row.id === 'balenciaga-shoes');
  if (callout) {
    console.log(`balenciaga-shoes query=${callout.query} type=${callout.keepsType} auto=${callout.autoSearch} top5=${callout.top5Category}/5`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'eval failed');
  process.exit(1);
});
