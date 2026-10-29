// ライブで記録したモデル応答を、今の識別器と検索語の組み立てに通す。
// 店と Workers AI は呼ばない。次のライブ評価は別途。
// node --import tsx scripts/eval-photo-search.ts --out scripts/eval-photo-search/replay.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createWorkersAiIdentifier, type WorkersAiHttpResponse } from '../src/lib/capture/workers-ai';
import { copiedPromptExample, storeSearchKeyword } from '../src/lib/capture/product-query';
import type { ProductGuess } from '../src/lib/capture/contract';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);

interface LiveRow {
  id: string;
  confidence?: string;
  products?: ProductGuess[];
  counts?: { yahoo?: number; rakuten?: number };
  sent?: { site: string; keyword: string; status?: number }[];
  modelCalls?: { response?: string | null }[];
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function cf(text: string): WorkersAiHttpResponse {
  return { status: 200, body: JSON.stringify({ success: true, result: { response: text }, errors: [], messages: [] }) };
}

async function replay(raw: string, id: string) {
  const identifier = createWorkersAiIdentifier({
    accountId: 'e'.repeat(32),
    apiToken: 'replay-token',
    userId: `replay-${id}`,
    now: () => 1_000,
    http: async () => cf(raw),
  });
  return identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
}

async function pass(label: string, file: string) {
  const body = JSON.parse(readFileSync(file, 'utf8')) as { rows: LiveRow[] };
  const rows = [];
  for (const row of body.rows) {
    const raw = row.modelCalls?.[0]?.response ?? '';
    const identified = raw ? await replay(raw, row.id) : null;
    const product = identified?.ok ? identified.value.products[0] ?? null : null;
    const keyword = product ? storeSearchKeyword(product, { maxChars: 128, maxBytes: 128 }) : '';
    rows.push({
      id: row.id,
      liveConfidence: row.confidence ?? null,
      liveName: row.products?.[0]?.name ?? null,
      liveModel: row.products?.[0]?.model ?? null,
      liveHits: (row.counts?.yahoo ?? 0) + (row.counts?.rakuten ?? 0),
      liveRakuten400: (row.sent ?? []).some((item) => item.site === 'rakuten' && item.status === 400),
      parsedConfidence: identified?.ok ? identified.value.confidence : identified?.error.code ?? null,
      parsedName: product?.name ?? null,
      parsedModel: product?.model ?? null,
      keyword,
      keywordBytes: Buffer.byteLength(keyword, 'utf8'),
      echoed: raw ? copiedPromptExample(JSON.parse(raw).products?.[0]?.name ?? '') : false,
    });
  }
  const echoed = rows.filter((row) => row.echoed).length;
  return {
    label,
    rowCount: rows.length,
    echoed,
    parsedSure: rows.filter((row) => row.parsedConfidence === 'sure').length,
    keywordOver128: rows.filter((row) => row.keywordBytes > 128).length,
    rows,
  };
}

async function main() {
  const report = {
    mode: 'replay-live-model-output',
    liveRerun: 'pending',
    note: 'main 6f978f1 と PR 9c4cb87 のライブ応答を、今の識別器に通した。店のAPIは呼んでいない。次のライブ評価は未実施。',
    main: await pass('main', 'tests/eval/photo-search/fixtures/live-main.json'),
    pr: await pass('pr', 'tests/eval/photo-search/fixtures/live-pr.json'),
  };
  const out = arg('--out');
  const json = JSON.stringify(report, null, 2);
  if (out) writeFileSync(out, `${json}\n`);
  console.log(JSON.stringify({
    mainEchoed: report.main.echoed,
    prEchoed: report.pr.echoed,
    prSure: report.pr.parsedSure,
    over: report.pr.keywordOver128,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'replay failed');
  process.exit(1);
});
