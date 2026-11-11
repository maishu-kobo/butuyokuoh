// MCP の URL 登録が、Amazon 書籍ページの新品価格を保存すること。
// 取得は fixture。中古価格や別フォーマットの金額では埋めない。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { mock, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import { PRICE_LATER_NOTE } from '../src/lib/scraper';

const BOOK_URL = 'https://www.amazon.co.jp/dp/4344410009/';
const COVER = 'https://m.media-amazon.com/images/I/81am5vH8G-L._SL1262_.jpg';
const BOTH_FAILED = '価格と画像を取得できませんでした';
const PRICE_ONLY = '価格を取得できませんでした。時間をおいて再試行するか、別の店のURLを使ってください。';

const bookHtml = `<img id="imgBlkFront" data-old-hires="${COVER}" src="https://m.media-amazon.com/images/I/81am5vH8G-L.jpg">
<span id="productTitle">半島を出よ 上 (幻冬舎文庫 む 1-25)</span>
<div id="tmmSwatches">
  <a href="/dp/434400759X"><span class="a-color-price">￥1,650</span></a>
  <span>80 Used from ￥1</span>
</div>
<div id="desktop_buybox"><div id="buybox">
  <div id="booksHeaderSection">
    <span id="newBuyingOption">Buy new:</span>
    <span id="price" class="a-size-medium a-color-price header-price a-text-normal">￥796</span>
  </div>
</div></div>
<div id="usedAccordionRow"><span id="usedPrice" class="a-price"><span class="a-offscreen">￥1</span></span></div>
<div id="recommendations"><span class="a-price">￥999</span></div>`;

let exclusive: Promise<void> = Promise.resolve();
function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

test('MCP add_item_by_url stores the Amazon book new price and keeps the cover', () => serial(async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const { installProductFetchPort } = await import('../src/lib/product-fetch-port');
  installProductFetchPort({
    lookup: (candidate) => candidate.hostname === 'www.amazon.co.jp' && candidate.pathname.includes('/dp/4344410009')
      ? { status: 200, body: Buffer.from(bookHtml), contentType: 'text/html; charset=UTF-8' }
      : undefined,
    timeoutMs: 400,
  });
  try {
    await createMember('amazon-book-mcp');
    const tokenResponse = await call('../src/app/api/agent-tokens/route.ts', 'POST', '/api/agent-tokens',
      { name: 'book-price', scopes: ['read', 'write'] }, undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens');
    assert.equal(tokenResponse.status, 201, tokenResponse.text);
    const token = (tokenResponse.json as { token: string }).token;
    const response = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_item_by_url', arguments: { url: BOOK_URL, notes: '文庫の新品を残す' } },
    }, undefined, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
    const body = response.json as {
      result: {
        isError: boolean;
        structuredContent: {
          data: {
            media_fetched: boolean;
            media_fetch_errors: unknown[];
            item: {
              name: string;
              current_price: number | null;
              original_price: number | null;
              image_url: string | null;
              scrape_status: string | null;
              scrape_error: string | null;
            };
          };
        };
      };
    };
    assert.equal(body.result.isError, false, JSON.stringify(body));
    const item = body.result.structuredContent.data.item;
    assert.equal(item.name, '半島を出よ 上 (幻冬舎文庫 む 1-25)');
    assert.equal(item.current_price, 796);
    assert.equal(item.original_price, 796);
    assert.equal(item.image_url, COVER);
    assert.equal(item.scrape_error, null);
    assert.deepEqual(body.result.structuredContent.data.media_fetch_errors, []);
    assert.equal(body.result.structuredContent.data.media_fetched, true);
    const database = await db();
    const row = database.prepare('SELECT current_price, image_url FROM items WHERE url = ?').get(BOOK_URL) as {
      current_price: number | null;
      image_url: string | null;
    };
    assert.equal(row.current_price, 796);
    assert.equal(row.image_url, COVER);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM price_history WHERE price = 796').get() as { count: number }).count, 1);
  } finally {
    installProductFetchPort(null);
    mock.restoreAll();
  }
}));

test('get_item does not say the image failed when a cover was saved and only the price is missing', () => serial(async () => {
  const owner = await createMember('amazon-book-message');
  const tokenResponse = await call('../src/app/api/agent-tokens/route.ts', 'POST', '/api/agent-tokens',
    { name: 'book-message', scopes: ['read', 'write'] }, undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens');
  assert.equal(tokenResponse.status, 201, tokenResponse.text);
  const token = (tokenResponse.json as { token: string }).token;
  const database = await db();
  const insert = database.prepare(`
    INSERT INTO items (user_id, name, url, image_url, current_price, source, scrape_status, scrape_error)
    VALUES (?, '画像だけ', ?, ?, NULL, 'amazon', 'failed', ?)
  `);
  const laterId = Number(insert.run(owner.id, 'https://www.amazon.co.jp/dp/B0PRICEONLY/', COVER, PRICE_LATER_NOTE).lastInsertRowid);
  const internalId = Number(insert.run(
    owner.id,
    'https://www.amazon.co.jp/dp/B0PRICEINTL/',
    COVER,
    'HTTP error 502: https://internal.example/path ECONNRESET',
  ).lastInsertRowid);
  const neitherId = Number(database.prepare(`
    INSERT INTO items (user_id, name, url, image_url, current_price, source, scrape_status, scrape_error)
    VALUES (?, '両方なし', 'manual://neither', NULL, NULL, 'other', 'failed', ?)
  `).run(owner.id, 'HTTP error 502: https://internal.example/path ECONNRESET').lastInsertRowid);

  async function getItem(id: number) {
    const response = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_item', arguments: { item_id: id } },
    }, undefined, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
    const body = response.json as {
      result: { isError: boolean; structuredContent: { data: { scrape_error: string | null; scrape_error_code: string | null; image_url: string | null } } };
    };
    assert.equal(body.result.isError, false, JSON.stringify(body));
    return body.result.structuredContent.data;
  }

  const later = await getItem(laterId);
  assert.equal(later.image_url, COVER);
  assert.equal(later.scrape_error_code, 'FETCH_FAILED');
  assert.equal(later.scrape_error, PRICE_LATER_NOTE);
  assert.equal(later.scrape_error?.includes('画像'), false);

  const internal = await getItem(internalId);
  assert.equal(internal.scrape_error, PRICE_ONLY);
  assert.equal(internal.scrape_error?.includes(BOTH_FAILED), false);
  assert.equal(internal.scrape_error?.includes('ECONNRESET'), false);

  const neither = await getItem(neitherId);
  assert.match(neither.scrape_error ?? '', /価格と画像を取得できませんでした/);
}));
