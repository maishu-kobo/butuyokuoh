import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeUrl, type ScrapedItem } from '../src/lib/scraper';

type Address = { address: string; family: number };
type Probe = {
  resolve?: (host: string) => Promise<Address[]>;
  request?: (
    url: URL,
    address: Address,
    headers: Record<string, string>,
    signal: AbortSignal,
  ) => Promise<{ status: number; location?: string; body: Buffer; contentType?: string }>;
};

const scrape = scrapeUrl as (url: string, deps?: Probe) => Promise<ScrapedItem>;

async function withoutNetwork<T>(run: (requested: string[]) => Promise<T>): Promise<T> {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response('<title>leaked</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    return await run(requested);
  } finally {
    globalThis.fetch = original;
  }
}

test('member scrape does not open private, loopback, or link-local addresses', async () => {
  const leaked = await withoutNetwork(async (requested) => {
    const failures: string[] = [];
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://172.31.0.1/',
      'http://0.0.0.0/',
      'http://127.0.0.1/',
      'http://10.1.2.3/',
      'http://192.168.0.5/',
      'http://172.16.0.1/',
    ]) {
      requested.length = 0;
      const result = await scrape(url);
      if (requested.length !== 0 || result.name !== '無効なURL') {
        failures.push(`${url} name=${result.name} fetches=${requested.length}`);
      }
    }
    return failures;
  });
  assert.deepEqual(leaked, []);
});

test('a Rakuten affiliate link is priced from its item page, and a bad target is not fetched', async () => {
  const seen: string[] = [];
  const deps = {
    resolve: async () => [{ address: '1.1.1.1', family: 4 }],
    request: async (url: URL) => {
      seen.push(url.href);
      return {
        status: 200,
        body: Buffer.from('<title>ペン</title>'),
        contentType: 'text/html',
      };
    },
  };
  const product = 'https://item.rakuten.co.jp/example/pen';
  const affiliate = `https://hb.afl.rakuten.co.jp/hgc/link/?pc=${encodeURIComponent(product)}`;
  const result = await scrape(affiliate, deps);
  assert.equal(seen.length, 1);
  assert.equal(new URL(seen[0]).hostname, 'item.rakuten.co.jp');
  assert.equal(new URL(seen[0]).pathname, '/example/pen');
  assert.equal(seen[0].includes('hb.afl.rakuten.co.jp'), false);
  assert.notEqual(result.name, '無効なURL');

  seen.length = 0;
  for (const bad of [
    'https://hb.afl.rakuten.co.jp/hgc/link/?pc=https://evil.example/pen',
    'https://hb.afl.rakuten.co.jp/hgc/link/?pc=http://169.254.169.254/',
    `https://user:pw@hb.afl.rakuten.co.jp/hgc/link/?pc=${encodeURIComponent(product)}`,
    'https://hb.afl.rakuten.co.jp/hgc/link/',
    `https://hb.afl.rakuten.co.jp/hgc/link/?pc=${encodeURIComponent(product)}&m=${encodeURIComponent('https://evil.example/phish')}`,
    `https://hb.afl.rakuten.co.jp/hgc/link/?pc=${encodeURIComponent(product)}&m=`,
  ]) {
    const blocked = await scrape(bad, deps);
    assert.equal(blocked.name, '無効なURL', bad);
  }
  assert.equal(seen.length, 0);
});

test('member scrape blocks a private DNS answer and a redirect onto an internal address', async () => {
  const seen: string[] = [];
  const result = await withoutNetwork(async (requested) => {
    const resolve = async (host: string) => {
      if (host === 'shop.example') return [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }];
      if (host === 'ok.example') return [{ address: '1.1.1.1', family: 4 }];
      if (host === 'shop2.example') return [{ address: '8.8.8.8', family: 4 }];
      if (host === 'meta.example') return [{ address: '169.254.169.254', family: 4 }];
      throw new Error(`unexpected host ${host}`);
    };
    const mixed = await scrape('http://shop.example/item', {
      resolve,
      request: async () => {
        seen.push('mixed');
        return { status: 200, body: Buffer.from('<title>no</title>'), contentType: 'text/html' };
      },
    });
    const redirected = await scrape('http://ok.example/item', {
      resolve,
      request: async (url, address) => {
        seen.push(`${url.hostname}@${address.address}`);
        return { status: 302, location: 'http://meta.example/latest/meta-data', body: Buffer.alloc(0) };
      },
    });
    const followed = await scrape('http://ok.example/start', {
      resolve,
      request: async (url, address) => {
        seen.push(`${url.hostname}@${address.address}`);
        if (url.hostname === 'ok.example') {
          return { status: 302, location: 'https://shop2.example/item', body: Buffer.alloc(0) };
        }
        return { status: 200, body: Buffer.from('<title>Public Item</title>'), contentType: 'text/html' };
      },
    });
    return { mixed, redirected, followed, requested: [...requested] };
  });

  assert.equal(result.mixed.name, '無効なURL');
  assert.equal(result.redirected.name, '無効なURL');
  assert.equal(result.followed.name, 'Public Item');
  assert.deepEqual(seen, [
    'ok.example@1.1.1.1',
    'ok.example@1.1.1.1',
    'shop2.example@8.8.8.8',
  ]);
  assert.deepEqual(result.requested, []);
});
