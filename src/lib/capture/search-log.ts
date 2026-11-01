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
    error: result.ok ? null : result.error.error,
    hitCount: result.ok ? result.value.length : 0,
  }));
  return result;
}

// 照合の検索が店へ届かなかったとき。検索語は残さない。
export function logSearchRefusal(error: { code: string; error: string; failures?: { site: string; code: string; error: string }[] }): void {
  console.info(JSON.stringify({
    lookup: true,
    errorCode: error.code,
    error: error.error,
    failures: (error.failures ?? []).map((failure) => ({
      site: failure.site,
      code: failure.code,
      error: failure.error,
    })),
  }));
}
