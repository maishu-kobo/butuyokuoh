import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { publicAddress, PublicPageError, type PageResolver } from './public-page';

// 名前解決したアドレスが非公開なら、その時点で接続しない。
// ゲストの取得と同じ判定で、プライベート、ループバック、リンクローカルに加え、
// マルチキャストや IPv4 射影など unicast 以外も拒否する。
export class BlockedTargetError extends Error {
  constructor() {
    super('内部アドレスへの取得はできません');
    this.name = 'BlockedTargetError';
  }
}

export class HttpError extends Error {
  status: number;

  constructor(status: number, url: string) {
    super(`HTTP error ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export type PinnedResponse = {
  status: number;
  location?: string;
  body: Buffer;
  contentType?: string;
};

export type PinnedRequest = (
  url: URL,
  address: { address: string; family: number },
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<PinnedResponse>;

export interface MemberFetchDeps {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  resolve?: PageResolver;
  request?: PinnedRequest;
}

const RETRY_DELAY_MULTIPLIERS = [1, 5, 15];
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

export async function resolvedPublicAddress(url: URL, resolve?: PageResolver) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedTargetError();
  try {
    return await publicAddress(url, resolve);
  } catch (error) {
    if (error instanceof PublicPageError) throw new BlockedTargetError();
    throw error;
  }
}

export function requestPinned(
  url: URL,
  address: { address: string; family: number },
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      agent: false,
      family: address.family,
      signal,
      headers,
      lookup: (_host, _options, callback) => {
        callback(null, address.address, address.family);
      },
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, (response) => {
      const status = response.statusCode || 502;
      response.on('error', reject);
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        resolve({
          status,
          location: Array.isArray(location) ? location[0] : location,
          body: Buffer.alloc(0),
        });
        response.resume();
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const contentType = response.headers['content-type'];
        resolve({
          status,
          body: Buffer.concat(chunks),
          contentType: Array.isArray(contentType) ? contentType[0] : contentType,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  const entries = headers instanceof Headers ? headers.entries() : Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of entries) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

async function followPublicRedirects(
  urlString: string,
  init: RequestInit | undefined,
  options: MemberFetchDeps & { timeoutMs: number },
) {
  let current = new URL(urlString);
  const request = options.request ?? requestPinned;
  const headers = headerRecord(init?.headers);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const address = await resolvedPublicAddress(current, options.resolve);
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    const result = await request(current, address, headers, signal);
    if (result.status >= 300 && result.status < 400) {
      if (!result.location || redirects === MAX_REDIRECTS) throw new HttpError(result.status, current.href);
      try {
        current = new URL(result.location, current);
      } catch {
        throw new BlockedTargetError();
      }
      continue;
    }
    if (result.status < 200 || result.status >= 300) throw new HttpError(result.status, current.href);
    const responseHeaders = new Headers();
    if (result.contentType) responseHeaders.set('content-type', result.contentType);
    return {
      response: new Response(new Uint8Array(result.body), { status: result.status, headers: responseHeaders }),
      url: current.href,
    };
  }
  throw new HttpError(310, urlString);
}

export async function fetchPublicMember(
  url: string,
  init?: RequestInit,
  options: MemberFetchDeps = {},
): Promise<{ response: Response; url: string }> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await followPublicRedirects(url, init, { ...options, timeoutMs });
    } catch (error) {
      if (error instanceof BlockedTargetError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = error instanceof HttpError ? error.status : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt === maxRetries) throw lastError;
      const multiplier = RETRY_DELAY_MULTIPLIERS[Math.min(attempt, RETRY_DELAY_MULTIPLIERS.length - 1)];
      const delayMs = baseDelayMs * multiplier;
      console.log(`Fetch failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms: ${url}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError ?? new Error(`Fetch failed after ${maxRetries + 1} attempts: ${url}`);
}
