// Pure aggregation for the existing photo-search harness. No network, DB or credentials.
/** @param {unknown} value */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function folded(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}
function matched(value, aliases) {
  return aliases.some((alias) => folded(alias) !== '' && folded(value) === folded(alias));
}
function distribution(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  const n = sorted.length;
  return {
    recorded: n,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    max: n ? sorted[n - 1] : null,
    total: n ? sorted.reduce((sum, value) => sum + value, 0) : null,
  };
}
function ratio(values) {
  const scored = values.filter((value) => typeof value === 'boolean');
  const hits = scored.filter(Boolean).length;
  return { eligible: scored.length, hits, rate: scored.length ? hits / scored.length : null };
}
const CONDITIONS = new Set(['photo-only', 'manual-hint', 'legacy-unspecified']);

/**
 * Catalog truth must be independently verified, not copied from model predictions.
 * scoreExact is the existing rubric.exactProductTop5; scoreCategory is rubric.scorePhoto.
 * @param {{rows: Array<any>, condition?: string, plannedIds?: string[], label?: string}} report
 * @param {{cases: Array<any>, excludedAliases?: Array<{id: string, duplicateOf: string, reason: string}>}} catalog
 * @param {{scoreExact: Function, scoreCategory: Function}} scoring
 */
export function summarizePhotoEvaluation(report, catalog, scoring) {
  if (!report || !Array.isArray(report.rows) || !catalog || !Array.isArray(catalog.cases)) {
    throw new Error('Report rows and catalog cases are required');
  }
  const condition = report.condition ?? 'legacy-unspecified';
  if (!CONDITIONS.has(condition)) throw new Error('Unknown evaluation condition');
  if (report.rows.some((row) => row.condition && row.condition !== condition)) {
    throw new Error('Do not combine photo-only and manual-hint rows in one report');
  }
  const byId = new Map();
  const aliases = new Map();
  for (const item of catalog.cases) {
    if (!item.id || byId.has(item.id)) throw new Error('Catalog ids must be unique');
    byId.set(item.id, item);
    for (const id of [item.id, ...(item.previousIds ?? [])]) {
      if (aliases.has(id)) throw new Error('Catalog aliases must be unique');
      aliases.set(id, item.id);
    }
  }
  const excludedAliases = new Map((catalog.excludedAliases ?? []).map((item) => [item.id, item]));
  const excluded = [];
  const observed = new Map();
  for (const row of report.rows) {
    if (!row || typeof row.id !== 'string') throw new Error('Each result needs an id');
    const duplicate = excludedAliases.get(row.id);
    if (duplicate) { excluded.push({ id: row.id, reason: duplicate.reason, duplicateOf: duplicate.duplicateOf }); continue; }
    const id = aliases.get(row.id);
    if (!id) { excluded.push({ id: row.id, reason: 'unknown-case' }); continue; }
    if (observed.has(id)) throw new Error('Duplicate result for ' + id);
    observed.set(id, row);
  }
  if (report.plannedIds && (!Array.isArray(report.plannedIds) || report.plannedIds.some((id) => !aliases.has(id)))) {
    throw new Error('plannedIds contains an unknown case');
  }
  const ids = report.plannedIds ? report.plannedIds.map((id) => aliases.get(id)) : [...observed.keys()];
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate planned case');
  if ([...observed.keys()].some((id) => !ids.includes(id))) throw new Error('Result outside planned cohort');
  const rows = ids.map((id) => {
    const item = byId.get(id);
    const row = observed.get(id);
    const truth = item.truth;
    const verified = truth?.status === 'verified' && Array.isArray(truth.evidence) && truth.evidence.length > 0;
    const product = row?.products?.[0];
    const titles = (row?.top5 ?? []).slice(0, 5).map((candidate) => candidate.title);
    const identifiers = verified && Array.isArray(truth.identifiers) ? truth.identifiers.filter((value) => typeof value === 'string' && value.trim()) : [];
    const nameAliases = verified && Array.isArray(truth.productNameAliases) ? truth.productNameAliases : [];
    const brandAliases = verified && Array.isArray(truth.brandAliases) ? truth.brandAliases : [];
    const category = row && item.categoryDiagnostic
      ? scoring.scoreCategory({
          id, confidence: row.confidence ?? null, name: product?.name ?? null, brand: product?.brand ?? null,
          hits: (row.counts?.yahoo ?? 0) + (row.counts?.rakuten ?? 0), top3: titles.slice(0, 3),
        }).category : row ? null : item.categoryDiagnostic ? false : null;
    return {
      id, observed: Boolean(row),
      exactProductTop5: identifiers.length ? scoring.scoreExact(titles, identifiers) : null,
      productNameMatch: nameAliases.length ? matched(product?.name, nameAliases) : null,
      brandMatch: brandAliases.length ? matched(product?.brand, brandAliases) : null,
      categoryDiagnostic: category,
      identifyError: row?.identifyError ?? null, searchError: row?.searchError ?? null,
      preparationError: row?.error ?? null,
    };
  });
  const actual = [...observed.values()];
  const calls = report.rows.flatMap((row) => row.modelCalls ?? []);
  const sent = report.rows.flatMap((row) => row.sent ?? []);
  const measured = calls.map((call) => call.usage?.neurons);
  const identifiedMs = actual.map((row) => row.identifyMs);
  const searchedMs = actual.map((row) => row.searchMs);
  const totalMs = actual.map((row) =>
    finite(row.identifyMs) && finite(row.searchMs) ? row.identifyMs + row.searchMs : null);
  const failedStatus = (entry) => finite(entry.status) && (entry.status < 200 || entry.status >= 300);
  return {
    schemaVersion: 1, label: report.label ?? null, condition,
    coverage: {
      declared: Boolean(report.plannedIds), planned: ids.length, observed: observed.size,
      missing: ids.filter((id) => !observed.has(id)), excluded,
    },
    accuracy: {
      exactProductTop5: ratio(rows.map((row) => row.exactProductTop5)),
      productName: ratio(rows.map((row) => row.productNameMatch)),
      brand: ratio(rows.map((row) => row.brandMatch)),
      categoryDiagnostic: ratio(rows.map((row) => row.categoryDiagnostic)),
    },
    latencyMs: { identify: distribution(identifiedMs), search: distribution(searchedMs), combined: distribution(totalMs) },
    usage: {
      modelCalls: calls.length,
      reportedNeurons: distribution(measured),
      reportedNeuronsPerRecordedInput: report.rows.length && measured.length && measured.every(finite)
        ? measured.reduce((sum, value) => sum + value, 0) / report.rows.length : null,
      callsWithoutReportedNeurons: measured.filter((value) => !finite(value)).length,
      reportedPromptTokens: distribution(calls.map((call) => call.usage?.prompt_tokens)),
      reportedCompletionTokens: distribution(calls.map((call) => call.usage?.completion_tokens)),
      ledgerChargedNeurons: distribution(report.rows.map((row) => row.neurons)),
      // Duplicate images still consumed resources. Keep their calls in cost/error totals.
      scope: 'all-recorded-calls-including-excluded-duplicates',
    },
    errors: {
      identifyRows: actual.filter((row) => row.identifyError).length,
      searchRows: actual.filter((row) => row.searchError).length,
      preparationRows: actual.filter((row) => row.error).length,
      partialSearchFailureRows: actual.filter((row) => row.failures?.length).length,
      failedModelRequests: calls.filter((call) => failedStatus(call) || call.thrown || call.errors?.length).length,
      failedSearchRequests: sent.filter(failedStatus).length,
    },
    rows,
  };
}
