import './regression-harness';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import { test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import { parseProductHtml } from '../src/lib/product-html';
import { deriveScrapeOutcome, scrapeUrl } from '../src/lib/scraper';
import { installProductFetchPort } from '../src/lib/product-fetch-port';
import type { AgentMediaFetchError } from '../src/lib/agent-items';
import { BOT_URL, PITAKA_URL, regressionLookup } from '../src/lib/product-regression-fixtures';

const url = 'https://www.patagonia.jp/product/terravia-convertible-tote-bag-backpack-24-liters/48814.html';
const waiting = readFileSync(new URL('./fixtures/patagonia-waiting.html', import.meta.url), 'utf8');
const messagePattern = /待機ページ|ボット対策/;
function installFixture() {
  installProductFetchPort({ lookup: candidate => candidate.hostname === 'www.patagonia.jp'
    ? { status: 200, body: Buffer.from(waiting), contentType: 'text/html' }
    : regressionLookup(candidate) });
}

test('waiting page is a failed scrape even with a price/image in its template; normal products still parse', () => {
  for (const html of [waiting, waiting.replace('<title>', '<title data-testid="title">'), waiting.toUpperCase(),
    `${waiting}<meta property="og:image" content="https://example.com/logo.png"><p>¥14,850</p>`]) {
    const result = parseProductHtml(html, url);
    assert.equal(result.name, '取得失敗');
    assert.equal(result.price, null);
    assert.equal(result.imageUrl, null);
    assert.match(result.note ?? '', messagePattern);
    assert.equal(deriveScrapeOutcome(result).status, 'failed');
  }
  const normal = parseProductHtml('<title>テラヴィア・トート・パック 24L</title><p>Hang Tight! botfailover</p><meta property="og:image" content="https://example.com/bag.jpg"><script type="application/ld+json">{"offers":{"price":14850,"priceCurrency":"JPY"}}</script>', url);
  assert.equal(normal.price, 14850);
  assert.equal(normal.imageUrl, 'https://example.com/bag.jpg');
  assert.equal(normal.name, 'テラヴィア・トート・パック 24L');
});

test('Web registration/preview and the bounded guest scraper explain the waiting page', async () => {
  const user = await createMember('waiting-web');
  installFixture();
  try {
    for (const [module, path] of [
      ['../src/app/api/items/preview/route.ts', '/api/items/preview'],
      ['../src/app/api/items/route.ts', '/api/items'],
    ]) {
      const response = await call(module, 'POST', path, { url });
      assert.equal(response.status, 422, response.text);
      assert.equal((response.json as { code: string }).code, 'SCRAPE_FAILED');
      assert.match((response.json as { error: string }).error, messagePattern);
    }
    const { scrapeGuestUrl } = await import('../src/lib/guest-scraper');
    await assert.rejects(() => scrapeGuestUrl(url, user.id), error =>
      error instanceof Error && messagePattern.test(error.message));
    const database = await db();
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM items WHERE user_id = ?').get(user.id) as { count: number }).count, 0);
  } finally { installProductFetchPort(null); }
});

test('Web rejects an Amazon bot page with guidance for an item that has not been saved', async () => {
  const owner = await createMember('amazon-bot-guidance');
  installFixture();
  try {
    for (const [module, path] of [
      ['../src/app/api/items/preview/route.ts', '/api/items/preview'],
      ['../src/app/api/items/route.ts', '/api/items'],
    ]) {
      const response = await call(module, 'POST', path, { url: BOT_URL });
      assert.equal(response.status, 422, response.text);
      assert.equal((response.json as { code: string }).code, 'SCRAPE_FAILED');
      // soft-404/ボット検知では汎用文面ではなく Amazon 向け note を返す（#368）
      assert.match((response.json as { error: string }).error, /ボット対策|自動取得が制限/);
    }
    const database = await db();
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM items WHERE user_id = ?').get(owner.id) as { count: number }).count, 0);
  } finally { installProductFetchPort(null); }
});

test('MCP returns per-URL failure reasons and saves a failed status for Web cards, including mixed stores', async (t) => {
  // DNS and shop responses are fixed; no network connections are made.
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  await createMember('waiting-mcp');
  const tokenResponse = await call('../src/app/api/agent-tokens/route.ts', 'POST', '/api/agent-tokens',
    { name: 'waiting-test', scopes: ['read', 'write'] }, undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens');
  assert.equal(tokenResponse.status, 201, tokenResponse.text);
  const token = (tokenResponse.json as { token: string }).token;
  installFixture();
  type Data = { media_fetched: boolean; media_fetch_errors: AgentMediaFetchError[] };
  async function mcp(name: string, args: object) {
    const response = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, undefined,
      { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
    return response.json as { result: { isError: boolean; structuredContent: { data: Data }; content: { text: string }[] } };
  }
  try {
    const noName = await mcp('add_item_by_url', { url });
    assert.equal(noName.result.isError, true, JSON.stringify(noName));
    assert.match(noName.result.content[0].text, messagePattern);
    for (const [tool, args, failedUrl] of [
      ['add_item_by_url', { url, name: 'テラヴィア・トート・パック 24L' }, url],
      ['add_item', { url: `${url}?color=black`, name: '黒' }, `${url}?color=black`],
      ['add_item_by_url', { urls: [PITAKA_URL, `${url}?color=blue`], name: '候補' }, `${url}?color=blue`],
    ] as const) {
      const result = await mcp(tool, args);
      assert.equal(result.result.isError, false, JSON.stringify(result));
      const data = result.result.structuredContent.data;
      assert.equal(data.media_fetched, 'urls' in args);
      assert.equal(data.media_fetch_errors.length, 1);
      assert.equal(data.media_fetch_errors[0].url, failedUrl);
      assert.equal(data.media_fetch_errors[0].code, 'BOT_CHALLENGE');
      assert.match(data.media_fetch_errors[0].message, messagePattern);
      const database = await db();
      const row = database.prepare('SELECT current_price, image_url, scrape_status, scrape_error FROM items WHERE url = ?').get(failedUrl) as {
        current_price: number | null; image_url: string | null; scrape_status: string; scrape_error: string;
      };
      assert.equal(row.current_price, null);
      assert.equal(row.image_url, null);
      assert.equal(row.scrape_status, 'failed');
      assert.match(row.scrape_error, messagePattern);
    }
  } finally { installProductFetchPort(null); }
});

test('refresh retains known product data and records failure; scheduled scraper outcome also reports it', async () => {
  const owner = await createMember('waiting-refresh');
  const database = await db();
  const id = Number(database.prepare("INSERT INTO items (user_id, name, url, current_price, image_url, source) VALUES (?, '保存済みの商品名', ?, 14850, 'https://example.com/bag.jpg', 'other')")
    .run(owner.id, url).lastInsertRowid);
  installFixture();
  try {
    const response = await call('../src/app/api/items/[id]/refresh/route.ts', 'POST', `/api/items/${id}/refresh`, {}, { id: String(id) });
    assert.equal(response.status, 200, response.text);
    const row = response.json as { name: string; current_price: number; image_url: string; scrape_status: string; scrape_error: string };
    assert.equal(row.name, '保存済みの商品名');
    assert.equal(row.current_price, 14850);
    assert.equal(row.image_url, 'https://example.com/bag.jpg');
    assert.equal(row.scrape_status, 'failed');
    assert.match(row.scrape_error, messagePattern);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM price_history WHERE item_id = ?').get(id) as { count: number }).count, 0);
    // check-prices.ts uses these same functions before updating price/history.
    // Do not execute the scheduled job, which would access production services.
    const outcome = deriveScrapeOutcome(await scrapeUrl(url));
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.error ?? '', messagePattern);
  } finally { installProductFetchPort(null); }
});
