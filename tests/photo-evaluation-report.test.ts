import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import evaluationCatalog from './eval/photo-search/catalog.json';
import sources from './eval/photo-search/sources.json';
import { summarizePhotoEvaluation } from './eval/photo-search/metrics.mjs';
import { exactProductTop5, scorePhoto } from './eval/photo-search/rubric';
import { createWorkersAiIdentifier } from '../src/lib/capture/workers-ai';

const scoring = { scoreExact: exactProductTop5, scoreCategory: scorePhoto };
const truth = { status: 'verified', identifiers: ['7897722AA4V1000'], productNameAliases: ['Rodeo medium'], brandAliases: ['BALENCIAGA'], evidence: ['https://example.test/independent-truth'] };
const catalog = {
  cases: [
    { id: 'bag', previousIds: ['old-bag'], categoryDiagnostic: false, truth },
    { id: 'second', previousIds: [], categoryDiagnostic: false, truth },
    { id: 'unknown', previousIds: [], categoryDiagnostic: false, truth: null },
  ],
  excludedAliases: [{ id: 'duplicate', duplicateOf: 'bag', reason: 'same-image' }],
};
const correct = { id: 'bag', products: [{ name: 'Rodeo medium', brand: 'BALENCIAGA' }], top5: [{ title: 'BALENCIAGA 7897722AA4V1000' }], identifyMs: 10, searchMs: 20 };

test('unknown truth is unscored and API failures and missing planned rows remain in denominators', () => {
  const result = summarizePhotoEvaluation({ condition: 'photo-only', plannedIds: ['bag', 'second', 'unknown'], rows: [correct, { id: 'unknown' }] }, catalog, scoring);
  assert.deepEqual(result.accuracy.exactProductTop5, { eligible: 2, hits: 1, rate: 0.5 });
  assert.deepEqual(result.coverage.missing, ['second']);
  const failed = summarizePhotoEvaluation({ condition: 'photo-only', rows: [{ id: 'bag', identifyError: 'AI_TIMEOUT' }, { id: 'unknown' }] }, catalog, scoring);
  assert.deepEqual(failed.accuracy.exactProductTop5, { eligible: 1, hits: 0, rate: 0 });
  assert.equal(failed.errors.identifyRows, 1);
  assert.equal(failed.rows.find((row) => row.id === 'unknown')?.exactProductTop5, null);
});

test('photo-only and manual-hint are separate conditions and mixed reports are rejected', () => {
  assert.throws(() => summarizePhotoEvaluation({ condition: 'photo-only', rows: [{ ...correct, condition: 'manual-hint' }] }, catalog, scoring), /Do not combine/);
  assert.equal(summarizePhotoEvaluation({ rows: [correct] }, catalog, scoring).condition, 'legacy-unspecified');
  assert.equal(summarizePhotoEvaluation({ condition: 'manual-hint', rows: [correct] }, catalog, scoring).condition, 'manual-hint');
});

test('old aliases map once, known duplicates leave accuracy but retain usage and request errors', () => {
  const result = summarizePhotoEvaluation({ rows: [
    { ...correct, id: 'old-bag', modelCalls: [{ status: 200, usage: { neurons: 0 } }] },
    { id: 'duplicate', modelCalls: [{ status: 500, usage: { neurons: 4 } }] },
  ] }, catalog, scoring);
  assert.equal(result.coverage.observed, 1);
  assert.equal(result.coverage.excluded.length, 1);
  assert.equal(result.usage.modelCalls, 2);
  assert.equal(result.usage.reportedNeurons.total, 4);
  assert.equal(result.usage.reportedNeurons.recorded, 2);
  assert.equal(result.usage.reportedNeuronsPerRecordedInput, 2);
  assert.equal(result.errors.failedModelRequests, 1);
  assert.throws(() => summarizePhotoEvaluation({ rows: [correct, { ...correct, id: 'old-bag' }] }, catalog, scoring), /Duplicate result/);
});

test('unknown usage is not free and missing timings are not zero milliseconds', () => {
  const result = summarizePhotoEvaluation({ rows: [{ ...correct, searchMs: undefined, modelCalls: [{ status: 200 }, { status: 200, usage: { neurons: 0 } }] }] }, catalog, scoring);
  assert.equal(result.usage.callsWithoutReportedNeurons, 1);
  assert.equal(result.usage.reportedNeuronsPerRecordedInput, null);
  assert.equal(result.latencyMs.search.median, null);
  assert.equal(result.latencyMs.combined.median, null);
  assert.equal(result.latencyMs.identify.median, 10);
});

test('changing row order does not change aggregates and only the first five candidates count', () => {
  for (let index = 0; index < 12; index += 1) {
    const hitRank = index + 1;
    const row = { ...correct, top5: Array.from({ length: 12 }, (_, i) => ({ title: i + 1 === hitRank ? '7897722AA4V1000' : 'similar bag' })) };
    const second = { id: 'second', identifyError: 'AI_TIMEOUT' };
    const one = summarizePhotoEvaluation({ rows: [row, second] }, catalog, scoring);
    const two = summarizePhotoEvaluation({ rows: [second, row] }, catalog, scoring);
    assert.deepEqual(one.accuracy, two.accuracy);
    assert.deepEqual(one.latencyMs, two.latencyMs);
    assert.equal(one.accuracy.exactProductTop5.hits, hitRank <= 5 ? 1 : 0);
  }
  const noEvidence = { cases: [{ id: 'bag', truth: { ...truth, evidence: [] } }] };
  assert.equal(summarizePhotoEvaluation({ rows: [correct] }, noEvidence, scoring).accuracy.exactProductTop5.rate, null);
});

test('filename-like evaluation identifiers cannot enter the model HTTP body', async () => {
  const bodies: string[] = [];
  const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
  for (const id of ['7897722AA4V1000_F.jpg', 'sample-001']) {
    const identifier = createWorkersAiIdentifier({
      accountId: 'e'.repeat(32), apiToken: 'test-only', userId: id, now: () => 1000,
      http: async (request) => {
        bodies.push(request.body);
        return { status: 200, body: JSON.stringify({ success: true, result: { response: { confidence: 'unreadable', products: [] } }, errors: [], messages: [] }) };
      },
    });
    await identifier.identify({ mediaType: 'image/jpeg', bytes });
  }
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[0].includes('7897722AA4V1000'), false);
});

test('catalog provenance stays aligned with the 23 source images without treating unknown SKUs as truth', () => {
  const images = evaluationCatalog.cases.filter((item) => item.file !== null);
  assert.equal(images.length, 23);
  const hashes = new Set<string>();
  for (const item of images) {
    const source = sources.images.find((entry) => entry.id === item.id);
    assert.ok(source, item.id);
    assert.equal(item.file, source.file);
    assert.equal(item.sourcePage, source.page);
    assert.ok(source.license && source.artist);
    assert.deepEqual(item.previousIds, [source.previousId]);
    const bytes = readFileSync(new URL('../' + item.file, import.meta.url));
    const hash = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
    assert.equal(item.gitBlobSha, hash, item.id);
    assert.equal(hashes.has(hash), false, item.id);
    hashes.add(hash);
    assert.equal(item.truth?.identifiers.length ?? 0, 0, item.id);
  }
  const original = evaluationCatalog.cases.find((item) => item.id === 'original-bag-247');
  assert.equal(original?.file, null);
  assert.deepEqual(original?.truth?.identifiers, ['7897722AA4V1000']);
});

test('historical reports remain unscored for exact products and preserve their actual call counts', () => {
  for (const [name, calls, excluded] of [['live-main.json', 24, 1], ['live-pr.json', 24, 1], ['live-pr03.json', 23, 0]] as const) {
    const saved = JSON.parse(readFileSync(new URL('./eval/photo-search/fixtures/' + name, import.meta.url), 'utf8'));
    const report = summarizePhotoEvaluation(saved, evaluationCatalog, scoring);
    assert.equal(report.condition, 'legacy-unspecified');
    assert.equal(report.coverage.observed, 23);
    assert.equal(report.coverage.excluded.length, excluded);
    assert.deepEqual(report.accuracy.exactProductTop5, { eligible: 0, hits: 0, rate: null });
    assert.deepEqual(report.accuracy.brand, { eligible: 8, hits: 5, rate: 0.625 });
    assert.equal(report.usage.modelCalls, calls);
    assert.equal(report.usage.callsWithoutReportedNeurons, 0);
  }
});

