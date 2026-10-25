import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/lib/db';
import {
  AI_LIMIT_MESSAGE,
  AI_MINUTE_LIMIT_MESSAGE,
  AI_NEURONS_WHEN_USAGE_MISSING,
  AI_USER_PER_DAY,
  AI_USER_PER_MINUTE,
  createSqliteAiBudget,
  createWorkersAiIdentifier,
  type WorkersAiHttpRequest,
  type WorkersAiHttpResponse,
} from '../src/lib/capture/workers-ai';

const ACCOUNT = 'c'.repeat(32);
const TOKEN = 'test-cloudflare-token';
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const SURE = {
  confidence: 'sure' as const,
  products: [{ name: '牛乳', brand: null, model: null, jan: null }],
};

function textResult(usage?: Record<string, number> | null): WorkersAiHttpResponse {
  const result: Record<string, unknown> = { response: JSON.stringify(SURE) };
  if (usage) result.usage = usage;
  return { status: 200, body: JSON.stringify({ success: true, result, errors: [], messages: [] }) };
}

function tempFile(): { directory: string; filename: string } {
  const directory = mkdtempSync(join(tmpdir(), 'capture-ai-budget-'));
  return { directory, filename: join(directory, 'budget.db') };
}

function identifyWith(
  budget: ReturnType<typeof createSqliteAiBudget>,
  clock: { t: number },
  userId: string,
  responses: WorkersAiHttpResponse[],
) {
  const calls: WorkersAiHttpRequest[] = [];
  const queued = [...responses];
  const identifier = createWorkersAiIdentifier({
    accountId: ACCOUNT,
    apiToken: TOKEN,
    userId,
    budget,
    now: () => clock.t,
    timeoutMs: 30_000,
    http: async (request) => {
      calls.push(request);
      const next = queued.shift();
      if (!next) throw new Error('no queued response');
      return next;
    },
  });
  return { calls, identifier };
}

test('minute, day, and neuron counters survive closing and reopening a temporary database', async () => {
  const { directory, filename } = tempFile();
  const clock = { t: Date.UTC(2026, 9, 22, 10, 0, 0) };
  const measured = textResult({ neurons: 15, prompt_tokens: 1_814_058, completion_tokens: 400 });
  try {
    const db = openDatabase(filename);
    try {
      const budget = createSqliteAiBudget(db);
      const first = identifyWith(budget, clock, '7', [measured, measured, measured, measured]);
      for (let index = 0; index < AI_USER_PER_MINUTE; index += 1) {
        assert.equal((await first.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true, `call ${index}`);
      }
      const blocked = await first.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.error.error, AI_MINUTE_LIMIT_MESSAGE);
      assert.equal(first.calls.length, AI_USER_PER_MINUTE);
      assert.equal(budget.usedNeurons(clock.t), 15 * AI_USER_PER_MINUTE);
      const stored = db.prepare('SELECT neurons FROM capture_ai_usage ORDER BY id').all() as { neurons: number }[];
      assert.deepEqual(stored.map((row) => row.neurons), [15, 15, 15]);
      assert.equal(JSON.stringify(stored).includes('/9j/'), false);
    } finally {
      db.close();
    }

    const reopened = openDatabase(filename);
    try {
      const budget = createSqliteAiBudget(reopened);
      const again = identifyWith(budget, clock, '7', [measured]);
      const stillBlocked = await again.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(stillBlocked.ok, false);
      if (!stillBlocked.ok) assert.equal(stillBlocked.error.error, AI_MINUTE_LIMIT_MESSAGE);
      assert.equal(again.calls.length, 0);
      assert.equal(budget.usedNeurons(clock.t), 45);

      clock.t += 60_001;
      const dailyResponses = Array.from({ length: AI_USER_PER_DAY }, () => measured);
      const daily = identifyWith(budget, clock, '7', dailyResponses);
      for (let index = AI_USER_PER_MINUTE; index < AI_USER_PER_DAY; index += 1) {
        assert.equal((await daily.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true, `day ${index}`);
        clock.t += 60_001;
      }
      const overDay = await daily.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(overDay.ok, false);
      if (!overDay.ok) assert.equal(overDay.error.error, AI_LIMIT_MESSAGE);
      assert.equal(daily.calls.length, AI_USER_PER_DAY - AI_USER_PER_MINUTE);
      assert.equal(budget.usedNeurons(clock.t), 15 * AI_USER_PER_DAY);
    } finally {
      reopened.close();
    }

    const persistedDay = openDatabase(filename);
    try {
      const budget = createSqliteAiBudget(persistedDay);
      const blocked = identifyWith(budget, clock, '7', [measured]);
      const overDay = await blocked.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(overDay.ok, false);
      if (!overDay.ok) assert.equal(overDay.error.error, AI_LIMIT_MESSAGE);
      assert.equal(blocked.calls.length, 0);
      assert.equal(budget.usedNeurons(clock.t), 150);

      const spender = identifyWith(budget, clock, '8', [textResult({ neurons: 8000, prompt_tokens: 1 })]);
      assert.equal((await spender.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
      assert.equal(budget.usedNeurons(clock.t), 8150);
    } finally {
      persistedDay.close();
    }

    const persistedNeurons = openDatabase(filename);
    try {
      const budget = createSqliteAiBudget(persistedNeurons);
      const other = identifyWith(budget, clock, '9', [textResult({ neurons: 1 })]);
      const stopped = await other.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(stopped.ok, false);
      if (!stopped.ok) assert.equal(stopped.error.error, AI_LIMIT_MESSAGE);
      assert.equal(other.calls.length, 0);
      assert.equal(budget.usedNeurons(clock.t), 8150);

      clock.t = Date.UTC(2026, 9, 23, 0, 0, 0);
      const reset = await other.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(reset.ok, true);
      assert.equal(other.calls.length, 1);
      assert.equal(budget.usedNeurons(clock.t), 1);
    } finally {
      persistedNeurons.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sqlite stores a reported zero and keeps 378 only when neurons are missing', async () => {
  const { directory, filename } = tempFile();
  const clock = { t: Date.UTC(2026, 9, 22, 11, 0, 0) };
  const db = openDatabase(filename);
  try {
    const budget = createSqliteAiBudget(db);
    const calls = identifyWith(budget, clock, '7', [
      textResult({ neurons: 0, prompt_tokens: 1_814_058, completion_tokens: 400 }),
      textResult(null),
    ]);
    assert.equal((await calls.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
    assert.equal(budget.usedNeurons(clock.t), 0);
    clock.t += 60_001;
    assert.equal((await calls.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg })).ok, true);
    assert.equal(budget.usedNeurons(clock.t), AI_NEURONS_WHEN_USAGE_MISSING);
    const rows = db.prepare('SELECT neurons FROM capture_ai_usage ORDER BY id').all() as { neurons: number }[];
    assert.deepEqual(rows.map((row) => row.neurons), [0, AI_NEURONS_WHEN_USAGE_MISSING]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
