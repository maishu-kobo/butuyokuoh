import { isAmazonProductPage } from './amazon-product';
import { decodeHtml } from './html-encoding';
import type { MemberFetchDeps } from './member-fetch';
import { regressionLookup } from './product-regression-fixtures';
import {
  MAX_AMAZON_PAGE_BYTES,
  MAX_PAGE_BYTES,
  PRODUCT_FETCH_HELP,
  PublicPageError,
  type PageResolver,
} from './public-page';
import type { ProductFixture } from './product-regression-fixtures';

// 本番では使わない。環境変数もヘッダーも、本番の公開IP検査を外さない。
// 差し替えはプロセス内のポートだけ。未登録のURLは店へ出さず失敗にする。

export type ProductFetchPort = {
  lookup: (url: URL) => ProductFixture | undefined;
  timeoutMs?: number;
};

let installed: ProductFetchPort | null = null;

const PUBLIC_ANSWER = [{ address: '8.8.8.8', family: 4 }];

export function installProductFetchPort(port: ProductFetchPort | null): void {
  if (process.env.NODE_ENV === 'production') {
    installed = null;
    throw new Error('Product fetch fixtures are unavailable in production');
  }
  installed = port;
}

function activePort(): ProductFetchPort | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (installed) return installed;
  if (process.env.E2E_PRODUCT_FIXTURES === '1') {
    return { lookup: regressionLookup, timeoutMs: 400 };
  }
  return null;
}

const resolvePublic: PageResolver = async () => PUBLIC_ANSWER;

export function productFetchDeps(): MemberFetchDeps | undefined {
  const port = activePort();
  if (!port) return undefined;
  return {
    maxRetries: 0,
    baseDelayMs: 0,
    timeoutMs: port.timeoutMs ?? 400,
    resolve: resolvePublic,
    request: async (url, _address, _headers, signal) => {
      const fixture = port.lookup(url);
      if (!fixture) throw new Error('fixture miss');
      if (fixture.hang) {
        await new Promise((_resolve, reject) => {
          const abort = () => reject(new Error('aborted'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      }
      return {
        status: fixture.status,
        location: fixture.location,
        body: fixture.body ?? Buffer.alloc(0),
        contentType: fixture.contentType,
      };
    },
  };
}

export function productFetchGuestDeps(): {
  resolve: PageResolver;
  request: (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<{ status: number; location?: string; html: string; truncated?: boolean }>;
  timeoutMs: number;
} | undefined {
  const port = activePort();
  if (!port) return undefined;
  return {
    timeoutMs: port.timeoutMs ?? 400,
    resolve: resolvePublic,
    request: async (url, _address, signal) => {
      const fixture = port.lookup(url);
      if (!fixture) throw new PublicPageError(502, PRODUCT_FETCH_HELP);
      if (fixture.hang) {
        await new Promise((_resolve, reject) => {
          const abort = () => reject(new PublicPageError(504, '取得に時間がかかっています。少し待って再試行するか、手動で追加してください'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (fixture.status >= 300 && fixture.status < 400) {
        return { status: fixture.status, location: fixture.location, html: '' };
      }
      if (fixture.status < 200 || fixture.status >= 300) throw new PublicPageError(502, PRODUCT_FETCH_HELP);
      const body = fixture.body ?? Buffer.alloc(0);
      const amazon = isAmazonProductPage(url);
      const max = amazon ? MAX_AMAZON_PAGE_BYTES : MAX_PAGE_BYTES;
      if (!amazon && body.length > max) throw new PublicPageError(502, PRODUCT_FETCH_HELP);
      const bytes = body.length > max ? body.subarray(0, max) : body;
      return {
        status: fixture.status,
        html: decodeHtml(bytes, fixture.contentType || 'text/html'),
        ...(body.length > max ? { truncated: true } : {}),
      };
    },
  };
}
