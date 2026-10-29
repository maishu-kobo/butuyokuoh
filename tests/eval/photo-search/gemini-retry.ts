// 評価ハーネスだけが 429 と 503 を待つ。画面の判定はこの関数を使わない。
export const GEMINI_HARNESS_TRIES = 6;

export function geminiCallsForPhoto(runningTotal: number, beforePhoto: number): number {
  return Math.max(0, runningTotal - beforePhoto);
}

export function sumGeminiCalls(rows: readonly { geminiCalls?: unknown }[]): number {
  return rows.reduce((sum, row) => sum + (typeof row.geminiCalls === 'number' ? row.geminiCalls : 0), 0);
}

export function geminiHarnessBackoffMs(attempt: number): number {
  return 10_000 * (attempt + 1);
}

export async function withGeminiHarnessRetry<T>(input: {
  run: () => Promise<{ status: number; value: T }>;
  sleep: (ms: number) => Promise<unknown>;
}): Promise<T> {
  let last!: T;
  for (let attempt = 0; attempt < GEMINI_HARNESS_TRIES; attempt += 1) {
    const step = await input.run();
    last = step.value;
    if (step.status !== 429 && step.status !== 503) return step.value;
    if (attempt + 1 >= GEMINI_HARNESS_TRIES) return step.value;
    await input.sleep(geminiHarnessBackoffMs(attempt));
  }
  return last;
}
