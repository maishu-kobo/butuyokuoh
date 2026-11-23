// Apple 構成ページと不完全な価格断片を、スクレイプ／エージェント追加の両方で価格未取得にする（#397）。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { after, before, mock, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import { installProductFetchPort } from '../src/lib/product-fetch-port';
import { installFrozenClock } from './trash-restore-clock';

const APPLE_BUY_URL = 'https://www.apple.com/jp/shop/buy-mac/macbook-pro-proled-xdr';
const appleBuyHtml = `<title>MacBook Proを購入 - Apple</title>
<meta property="og:description" content="分割払いで9,366円/月（税込）から。" />
<meta property="og:image" content="https://store.storeimages.cdn-apple.com/pro.png" />
<p>最低購入金額は3,000円です。月々の支払い。</p>
<script type="application/ld+json">{"@type":"Product","name":"MacBook Pro","offers":{"price":3000,"priceCurrency":"JPY"}}</script>
<meta property="og:price:currency" content="JPY" />
<meta property="og:price:amount" content="3000" />`;

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const byUrlPath = '../src/app/api/agent/v1/items/by-url/route.ts';
const mcpPath = '../src/app/api/mcp/route.ts';
const sameOrigin = { origin: 'http://localhost' } as const;

let releaseClock: (() => void) | null = null;
before(async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  releaseClock = installFrozenClock(await db());
});
after(() => {
  releaseClock?.();
  mock.restoreAll();
});

let exclusive: Promise<void> = Promise.resolve();
function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

async function createToken(name: string) {
  const created = await call(
    tokensPath,
    'POST',
    '/api/agent-tokens',
    { name, scopes: ['read', 'write'], expiresInDays: 30 },
    undefined,
    sameOrigin,
    'http://localhost/api/agent-tokens',
  );
  assert.equal(created.status, 201, created.text);
  return (created.json as { token: string }).token;
}

test('agent REST/MCP: tester MacBook Pro configurator URL keeps price null (not 3000)', () => serial(async () => {
  // テスター報告: Claude Code / MCP でこの URL を追加すると current_price が 3,000円になった。
  // 構成（多モデル）ページなので単一売価は無く、最低購入・分割・修理料・構造化の 3000 を事実として残さない（#397）。
  installProductFetchPort({
    lookup: (candidate) => {
      if (candidate.hostname === 'www.apple.com' || candidate.hostname === 'apple.com') {
        return { status: 200, body: Buffer.from(appleBuyHtml), contentType: 'text/html; charset=UTF-8' };
      }
      return undefined;
    },
  });
  try {
    await createMember('apple-config-price');
    const token = await createToken('apple-config-price');

    const rest = await call(
      byUrlPath,
      'POST',
      '/api/agent/v1/items/by-url',
      { url: APPLE_BUY_URL, name: 'MacBook Pro' },
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(rest.status, 201, rest.text);
    const restItem = (rest.json as {
      data: { item: { current_price: number | null; name: string; url: string; scrape_status: string | null } };
    }).data.item;
    assert.equal(restItem.current_price, null);
    assert.notEqual(restItem.current_price, 3000);
    assert.match(restItem.name, /MacBook Pro/);
    assert.equal(restItem.url, APPLE_BUY_URL);

    const mcp = await call(
      mcpPath,
      'POST',
      '/api/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'add_item_by_url',
          arguments: { url: APPLE_BUY_URL },
        },
      },
      undefined,
      { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    );
    assert.equal(mcp.status, 200, mcp.text);
    // 同一 URL は重複。1件目の価格が null のままであることを DB で固定する。
    const database = await db();
    const rows = database.prepare(
      'SELECT url, current_price, name FROM items WHERE url = ? ORDER BY id',
    ).all(APPLE_BUY_URL) as { url: string; current_price: number | null; name: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].current_price, null);
    assert.notEqual(rows[0].current_price, 3000);
  } finally {
    installProductFetchPort(null);
  }
}));
