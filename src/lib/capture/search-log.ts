import type { CaptureCandidate, CaptureResult } from './contract';

export type StoreAttempt = {
  result: CaptureResult<CaptureCandidate[]>;
  httpStatus: number | null;
};

// 店の検索 1 回につき 1 行。鍵も検索語も入れない。
export function reportStoreAttempt(
  provider: 'yahoo' | 'rakuten',
  attempt: StoreAttempt,
): CaptureResult<CaptureCandidate[]> {
  const result = attempt.result;
  console.info(JSON.stringify({
    provider,
    httpStatus: attempt.httpStatus,
    errorCode: result.ok ? null : result.error.code,
    hitCount: result.ok ? result.value.length : 0,
  }));
  return result;
}
