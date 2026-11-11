// ドル表示の Amazon 新品価格は、円を選ぶ操作のあとの金額を保存する。
// 取得は fixture。中古・別フォーマットの円は新品価格にしない。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import fc from 'fast-check';
import { mock, test } from 'node:test';
import { call, createMember, db } from './regression-harness';
import { extractAmazonListing, extractAmazonProduct } from '../src/lib/amazon-product';
import { installProductFetchPort, type ProductLookupContext } from '../src/lib/product-fetch-port';
import { scrapeUrl } from '../src/lib/scraper';
import type { ProductFixture } from '../src/lib/product-regression-fixtures';

const COVER = 'https://m.media-amazon.com/images/I/81am5vH8G-L.jpg';
const PRODUCT = 'https://www.amazon.co.jp/dp/4344410009';
const CSRF = 'test-csrf-token';

function dollarPage(amount: string): string {
  const [whole, fraction] = amount.split('.');
  const cents = fraction ?? '00';
  return `<img id="imgBlkFront" data-old-hires="${COVER}">
<span id="productTitle">半島を出よ 上 (幻冬舎文庫 む 1-25)</span>
<div id="tmmSwatches">
  <span class="a-color-price">￥1,650</span>
  <span>80 Used from ￥1</span>
</div>
<div id="desktop_buybox"><div id="corePriceDisplay_desktop_feature_div">
  <span class="a-price aok-align-center priceToPay">
    <span class="a-offscreen"> </span>
    <span aria-hidden="true"><span class="a-price-symbol">USD</span><span class="a-price-whole">${whole}<span class="a-price-decimal">.</span></span><span class="a-price-fraction">${cents}</span></span>
  </span>
</div></div>
<div id="usedAccordionRow"><span id="usedPrice" class="a-price"><span class="a-offscreen">￥1</span></span></div>
<div id="recommendations"><span class="a-price">￥2,013</span></div>`;
}

function yenPage(yen: number): string {
  return `<img id="imgBlkFront" data-old-hires="${COVER}">
<span id="productTitle">半島を出よ 上 (幻冬舎文庫 む 1-25)</span>
<div id="tmmSwatches"><span class="a-color-price">￥1,650</span><span>80 Used from ￥1</span></div>
<div id="desktop_buybox"><div id="corePriceDisplay_desktop_feature_div">
  <span class="a-price priceToPay"><span class="a-offscreen"> </span><span aria-hidden="true"><span class="a-price-symbol">￥</span><span class="a-price-whole">${yen.toLocaleString('en-US')}</span></span></span>
</div></div>
<div id="usedAccordionRow"><span class="a-color-price">￥1</span></div>
<div id="recommendations"><span class="a-price">￥2,013</span></div>`;
}

function currencyForm(options: string): string {
  return `<form method="post" id="international-customer-select-preferences-form">
<input type="hidden" name="anti-csrftoken-a2z" value="${CSRF}" />
<input type="radio" name="lop" value="ja_JP" checked />
<input type="radio" name="lop" value="en_US" />
<select name="cop" id="icp-currency-dropdown">
  <option value="">通貨を選択する</option>
  ${options}
</select>
</form>`;
}

const yenChoice = currencyForm('<option value="JPY" selected>￥ - JPY - 日本円</option><option value="USD">$ - USD - 米ドル</option>');
const noYenChoice = currencyForm('<option value="USD" selected>$ - USD - 米ドル</option>');

type Hit = { method: string; href: string; cookie: string; body: string };

function fixture(body: string, setCookie: string[] = [], contentType = 'text/html; charset=UTF-8'): ProductFixture {
  return { status: 200, body: Buffer.from(body), contentType, setCookie };
}

function installSwitch(hits: Hit[], form: string, yenHtml: string) {
  installProductFetchPort({
    lookup: (url, context?: ProductLookupContext) => {
      const method = (context?.method ?? 'GET').toUpperCase();
      const headers = context?.headers ?? {};
      const cookie = headers.Cookie ?? headers.cookie ?? '';
      hits.push({ method, href: url.href, cookie, body: context?.body ?? '' });
      if (url.pathname === '/customer-preferences/edit') {
        return fixture(form, ['session-id=TESTSESSION; Domain=.amazon.co.jp; Path=/; Secure']);
      }
      if (url.pathname === '/customer-preferences/ajax/save-preferences') {
        return fixture('{}', ['i18n-prefs=JPY; Domain=.amazon.co.jp; Path=/'], 'application/json');
      }
      if (url.pathname.startsWith('/dp/')) {
        return fixture(cookie.includes('session-id=TESTSESSION') ? yenHtml : dollarPage('6.06'));
      }
      return undefined;
    },
    timeoutMs: 400,
  });
}

test('a dollar new-item price is not saved as yen, and other yen amounts are ignored', () => {
  const parsed = extractAmazonProduct(dollarPage('6.06'));
  assert.equal(parsed.price, null);
  assert.equal(parsed.name, '半島を出よ 上 (幻冬舎文庫 む 1-25)');
  assert.equal(parsed.imageUrl, COVER);
  const listing = extractAmazonListing(dollarPage('6.06'));
  assert.equal(listing.price, null);
  assert.equal(listing.usdPrice, 6.06);

  fc.assert(fc.property(
    fc.integer({ min: 1, max: 99999 }),
    fc.integer({ min: 0, max: 99 }),
    (dollars, cents) => {
      const amount = Number(`${dollars}.${String(cents).padStart(2, '0')}`);
      const html = dollarPage(amount.toFixed(2));
      assert.equal(extractAmazonProduct(html).price, null);
      assert.equal(extractAmazonListing(html).usdPrice, amount);
    },
  ));
});

test('selecting yen on a dollar Amazon page saves the yen new price', async () => {
  const hits: Hit[] = [];
  installSwitch(hits, yenChoice, yenPage(957));
  try {
    const result = await scrapeUrl(PRODUCT);
    assert.equal(result.price, 957);
    assert.equal(result.name, '半島を出よ 上 (幻冬舎文庫 む 1-25)');
    assert.equal(result.imageUrl, COVER);
    assert.equal(result.note, undefined);
    const save = hits.find((hit) => hit.href.includes('/customer-preferences/ajax/save-preferences'));
    assert.ok(save, hits.map((hit) => hit.href).join('\n'));
    assert.equal(save.method, 'POST');
    assert.match(save.body, /"cop":"JPY"/);
    assert.match(save.body, /"lop":"ja_JP"/);
    assert.match(save.cookie, /session-id=TESTSESSION/);
    const again = hits.filter((hit) => hit.href.startsWith(PRODUCT));
    assert.equal(again.length >= 2, true);
    assert.match(again.at(-1)?.cookie ?? '', /session-id=TESTSESSION/);
    assert.match(again.at(-1)?.cookie ?? '', /i18n-prefs=JPY/);
  } finally {
    installProductFetchPort(null);
  }
});

test('a yen page does not ask Amazon to switch currency', async () => {
  const hits: Hit[] = [];
  installSwitch(hits, yenChoice, yenPage(957));
  installProductFetchPort({
    lookup: (url) => {
      hits.push({ method: 'GET', href: url.href, cookie: '', body: '' });
      if (url.pathname.startsWith('/dp/')) return fixture(yenPage(796));
      return undefined;
    },
    timeoutMs: 400,
  });
  try {
    const result = await scrapeUrl(PRODUCT);
    assert.equal(result.price, 796);
    assert.equal(hits.some((hit) => hit.href.includes('customer-preferences')), false);
  } finally {
    installProductFetchPort(null);
  }
});

function redirect(location: string, setCookie: string[] = []): ProductFixture {
  return { status: 302, location, body: Buffer.alloc(0), setCookie };
}

test('a currency-switch redirect on an allowed Amazon path still saves the yen new price', async () => {
  const hits: Hit[] = [];
  installProductFetchPort({
    lookup: (url, context?: ProductLookupContext) => {
      const method = (context?.method ?? 'GET').toUpperCase();
      const headers = context?.headers ?? {};
      const cookie = headers.Cookie ?? headers.cookie ?? '';
      hits.push({ method, href: url.href, cookie, body: context?.body ?? '' });
      if (url.pathname === '/customer-preferences/edit' && url.searchParams.get('step') !== 'form') {
        return redirect('https://www.amazon.co.jp/customer-preferences/edit?step=form', [
          'session-id=TESTSESSION; Domain=.amazon.co.jp; Path=/; Secure',
        ]);
      }
      if (url.pathname === '/customer-preferences/edit') return fixture(yenChoice);
      if (url.pathname === '/customer-preferences/ajax/save-preferences' && url.searchParams.get('done') !== '1') {
        return redirect('https://www.amazon.co.jp/customer-preferences/ajax/save-preferences?ref=icp_save_cop_to_JPY&done=1', [
          'i18n-prefs=JPY; Domain=.amazon.co.jp; Path=/',
        ]);
      }
      if (url.pathname === '/customer-preferences/ajax/save-preferences') {
        return fixture('{}', [], 'application/json');
      }
      if (url.pathname.startsWith('/dp/') && cookie.includes('session-id=TESTSESSION') && url.searchParams.get('landed') !== '1') {
        return redirect('https://www.amazon.co.jp/dp/4344410009?landed=1');
      }
      if (url.pathname.startsWith('/dp/') && url.searchParams.get('landed') === '1') return fixture(yenPage(957));
      if (url.pathname.startsWith('/dp/')) return fixture(dollarPage('6.06'));
      return undefined;
    },
    timeoutMs: 400,
  });
  try {
    const result = await scrapeUrl(PRODUCT);
    assert.equal(result.price, 957);
    assert.equal(result.note, undefined);
    assert.equal(hits.some((hit) => hit.href.includes('step=form')), true);
    assert.equal(hits.some((hit) => hit.href.includes('done=1')), true);
    assert.equal(hits.some((hit) => hit.href.includes('landed=1')), true);
    assert.match(hits.find((hit) => hit.href.includes('step=form'))?.cookie ?? '', /session-id=TESTSESSION/);
  } finally {
    installProductFetchPort(null);
  }
});

test('a currency-switch redirect off Amazon or off the allowed paths is not followed', async () => {
  const outside: Hit[] = [];
  installProductFetchPort({
    lookup: (url, context?: ProductLookupContext) => {
      outside.push({
        method: (context?.method ?? 'GET').toUpperCase(),
        href: url.href,
        cookie: context?.headers?.Cookie ?? context?.headers?.cookie ?? '',
        body: context?.body ?? '',
      });
      if (url.pathname === '/customer-preferences/edit') {
        return redirect('https://evil.example/customer-preferences/edit');
      }
      if (url.pathname.startsWith('/dp/')) return fixture(dollarPage('6.06'));
      return undefined;
    },
    timeoutMs: 400,
  });
  try {
    const escaped = await scrapeUrl(PRODUCT);
    assert.equal(escaped.price, null);
    assert.match(escaped.note ?? '', /USD 6\.06/);
    assert.equal(outside.some((hit) => hit.href.includes('evil.example')), false);
  } finally {
    installProductFetchPort(null);
  }

  const offPath: Hit[] = [];
  installProductFetchPort({
    lookup: (url, context?: ProductLookupContext) => {
      offPath.push({
        method: (context?.method ?? 'GET').toUpperCase(),
        href: url.href,
        cookie: context?.headers?.Cookie ?? context?.headers?.cookie ?? '',
        body: context?.body ?? '',
      });
      if (url.pathname === '/customer-preferences/edit') return fixture(yenChoice, ['session-id=TESTSESSION; Domain=.amazon.co.jp; Path=/']);
      if (url.pathname === '/customer-preferences/ajax/save-preferences') {
        return redirect('https://www.amazon.co.jp/s?k=secret');
      }
      if (url.pathname.startsWith('/dp/')) return cookiePage(context);
      return undefined;
    },
    timeoutMs: 400,
  });
  try {
    const blocked = await scrapeUrl(PRODUCT);
    assert.equal(blocked.price, null);
    assert.match(blocked.note ?? '', /USD 6\.06/);
    assert.equal(offPath.some((hit) => new URL(hit.href).pathname === '/s'), false);
  } finally {
    installProductFetchPort(null);
  }
});

function cookiePage(context: ProductLookupContext | undefined): ProductFixture {
  const cookie = context?.headers?.Cookie ?? context?.headers?.cookie ?? '';
  return fixture(cookie.includes('session-id=TESTSESSION') ? yenPage(957) : dollarPage('6.06'));
}

test('when yen cannot be selected, the visible USD new price is recorded and not stored as yen', async () => {
  const hits: Hit[] = [];
  installSwitch(hits, noYenChoice, yenPage(957));
  try {
    const result = await scrapeUrl(PRODUCT);
    assert.equal(result.price, null);
    assert.match(result.note ?? '', /USD 6\.06/);
    assert.equal(result.note?.includes('1,650'), false);
    assert.equal(result.note?.includes('2,013'), false);
    assert.equal(hits.some((hit) => hit.method === 'POST'), false);
  } finally {
    installProductFetchPort(null);
  }
});

let exclusive: Promise<void> = Promise.resolve();
function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

test('MCP add_item_by_url stores the yen price after a dollar Amazon page', () => serial(async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const hits: Hit[] = [];
  installSwitch(hits, yenChoice, yenPage(957));
  try {
    await createMember('amazon-yen-switch');
    const tokenResponse = await call('../src/app/api/agent-tokens/route.ts', 'POST', '/api/agent-tokens',
      { name: 'yen-switch', scopes: ['read', 'write'] }, undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens');
    assert.equal(tokenResponse.status, 201, tokenResponse.text);
    const token = (tokenResponse.json as { token: string }).token;
    const response = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_item_by_url', arguments: { url: PRODUCT, notes: 'ドル表示だった文庫' } },
    }, undefined, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
    const body = response.json as {
      result: { isError: boolean; structuredContent: { data: { item: { current_price: number | null; image_url: string | null; scrape_error: string | null } } } };
    };
    assert.equal(body.result.isError, false, JSON.stringify(body));
    const item = body.result.structuredContent.data.item;
    assert.equal(item.current_price, 957);
    assert.equal(item.image_url, COVER);
    assert.equal(item.scrape_error, null);
    const database = await db();
    const row = database.prepare('SELECT current_price FROM items WHERE url = ?').get(PRODUCT) as { current_price: number | null };
    assert.equal(row.current_price, 957);
  } finally {
    installProductFetchPort(null);
    mock.restoreAll();
  }
}));

test('MCP keeps a record when the dollar page has no yen choice', () => serial(async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  installSwitch([], noYenChoice, yenPage(957));
  try {
    await createMember('amazon-usd-fallback');
    const tokenResponse = await call('../src/app/api/agent-tokens/route.ts', 'POST', '/api/agent-tokens',
      { name: 'usd-fallback', scopes: ['read', 'write'] }, undefined, { origin: 'http://localhost' }, 'http://localhost/api/agent-tokens');
    assert.equal(tokenResponse.status, 201, tokenResponse.text);
    const token = (tokenResponse.json as { token: string }).token;
    const added = await call('../src/app/api/mcp/route.ts', 'POST', '/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_item_by_url', arguments: { url: PRODUCT, notes: '円を選べなかった' } },
    }, undefined, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
    const addedBody = added.json as {
      result: { isError: boolean; structuredContent: { data: { item: { id: number; current_price: number | null; image_url: string | null } } } };
    };
    assert.equal(addedBody.result.isError, false, JSON.stringify(addedBody));
    const saved = addedBody.result.structuredContent.data.item;
    assert.equal(saved.current_price, null);
    assert.equal(saved.image_url, COVER);
    const database = await db();
    const row = database.prepare('SELECT current_price, scrape_status, scrape_error FROM items WHERE id = ?').get(saved.id) as {
      current_price: number | null;
      scrape_status: string | null;
      scrape_error: string | null;
    };
    assert.equal(row.current_price, null);
    assert.equal(row.scrape_status, 'failed');
    assert.match(row.scrape_error ?? '', /USD 6\.06/);
  } finally {
    installProductFetchPort(null);
    mock.restoreAll();
  }
}));
