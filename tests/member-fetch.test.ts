import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockedTargetError, fetchPublicMember, HttpError, type MemberFetchDeps } from '../src/lib/member-fetch';

// member-fetch の転送追跡。ネットワークは request/resolve の偽物で止める。
const PRODUCT = 'https://www.amazon.co.jp/dp/B0HCNJW81Q?th=1';
const publicAnswer = async () => [{ address: '1.1.1.1', family: 4 }];
const budget = { maxRetries: 0, baseDelayMs: 0, timeoutMs: 1000 };

async function failure(url: string, deps: MemberFetchDeps): Promise<unknown> {
  try {
    await fetchPublicMember(url, undefined, deps);
  } catch (error) {
    return error;
  }
  throw new Error('fetch did not fail');
}

test('a terminal 4xx after redirects carries the validated final URL on HttpError (#367)', async () => {
  const seen: string[] = [];
  const deps: MemberFetchDeps = {
    ...budget,
    resolve: publicAnswer,
    request: async (url, address) => {
      seen.push(`${url.href}@${address.address}`);
      if (url.hostname === 'amzn.asia') return { status: 301, location: PRODUCT, body: Buffer.alloc(0) };
      return { status: 404, body: Buffer.from('missing'), contentType: 'text/html' };
    },
  };
  const error = await failure('https://amzn.asia/d/x', deps);
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 404);
  // 転送先は接続前に公開アドレスへ解決済み。呼び出し側は文字列を解析せず url を読む。
  assert.equal(error.url, PRODUCT);
  assert.equal(error.message, `HTTP error 404: ${PRODUCT}`);
  assert.deepEqual(seen, ['https://amzn.asia/d/x@1.1.1.1', `${PRODUCT}@1.1.1.1`]);

  // 2xx で終わる転送は従来どおり最終 URL と応答を返す
  seen.length = 0;
  const ok = await fetchPublicMember('https://amzn.asia/d/x', undefined, {
    ...budget,
    resolve: publicAnswer,
    request: async (url) => {
      seen.push(url.href);
      if (url.hostname === 'amzn.asia') return { status: 301, location: PRODUCT, body: Buffer.alloc(0) };
      return { status: 200, body: Buffer.from('<title>ok</title>'), contentType: 'text/html' };
    },
  });
  assert.equal(ok.url, PRODUCT);
  assert.equal(ok.response.status, 200);
  assert.deepEqual(seen, ['https://amzn.asia/d/x', PRODUCT]);
});

test('a redirect the SSRF guard rejects is a BlockedTargetError and is never requested', async () => {
  for (const location of [
    'https://www.amazon.co.jp/dp/B0HCNJW81Q', // 名前解決が非公開アドレス
    'http://10.0.0.1/dp/B0HCNJW81Q',
    'http://[::1]/dp/B0HCNJW81Q',
    'http://169.254.169.254/latest/meta-data',
    'ftp://www.amazon.co.jp/dp/B0HCNJW81Q',
    'https://bad host/',
  ]) {
    const seen: string[] = [];
    const error = await failure('https://amzn.asia/d/x', {
      ...budget,
      resolve: async (host) => (host === 'amzn.asia' ? publicAnswer() : [{ address: '10.0.0.1', family: 4 }]),
      request: async (url) => {
        seen.push(url.hostname);
        return { status: 302, location, body: Buffer.alloc(0) };
      },
    });
    assert.ok(error instanceof BlockedTargetError, location);
    assert.equal(error instanceof HttpError, false, location);
    assert.deepEqual(seen, ['amzn.asia'], location);
  }
});

test('the redirect limit reports the last requested URL, not an unvisited location', async () => {
  const seen: string[] = [];
  const error = await failure('https://shop.example/start', {
    ...budget,
    resolve: publicAnswer,
    request: async (url) => {
      seen.push(url.href);
      return { status: 302, location: `/hop${seen.length}`, body: Buffer.alloc(0) };
    },
  });
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 302);
  assert.equal(error.url, 'https://shop.example/hop3');
  assert.deepEqual(seen, [
    'https://shop.example/start',
    'https://shop.example/hop1',
    'https://shop.example/hop2',
    'https://shop.example/hop3',
  ]);
});
