import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call } from './regression-harness';
import { installProductFetchPort } from '../src/lib/product-fetch-port';
import { scrapeFailureCaption } from '../src/lib/scrape-failure-caption';
import { CONFIGURATOR_PRICE_NOTE, PRICE_LATER_NOTE } from '../src/lib/scraper';
import { amazonUsdFallbackNote } from '../src/lib/amazon-product';

process.env.GUEST_MODE_ENABLED = 'true';
process.env.AUTH_URL = 'http://127.0.0.1:3000';
process.env.GUEST_SCRAPES_PER_MINUTE = '1000';
process.env.GUEST_GLOBAL_SCRAPES_PER_MINUTE = '1000';
process.env.GUEST_WRITES_PER_MINUTE = '1000';

const sameOrigin = { origin: 'http://127.0.0.1:3000' } as const;

const APPLE_BUY = 'https://www.apple.com/jp/shop/buy-mac/macbook-pro';
const GENERIC_NO_PRICE = 'https://shop.example.test/goods/NO-PRICE-001/';

const appleHtml = `<!doctype html><html><head>
<title>Liquid Retina XDRディスプレイ搭載MacBook Proを購入 - Apple</title>
<meta property="og:image" content="https://store.storeimages.cdn-apple.com/demo.jpg" />
</head><body><h1>MacBook Pro</h1></body></html>`;

const genericHtml = `<!doctype html><html><head>
<title>価格なしデモ商品 - Example Shop</title>
<meta property="og:image" content="https://cdn.example.test/demo.jpg" />
</head><body><h1>価格なしデモ商品</h1></body></html>`;

test('guest add with name but no price persists scrape_status failed so the card is not a bare ¥--- (#415)', async () => {
  const { getDb } = await import('../src/lib/db');
  const { installAuthTestHooks } = await import('../src/lib/auth');
  const { startGuest } = await import('../src/lib/guest');
  const database = getDb();
  const items = '../src/app/api/items/route.ts';

  installProductFetchPort({
    lookup(target) {
      if (target.href === APPLE_BUY || target.pathname.includes('/shop/buy-mac/')) {
        return { status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(appleHtml) };
      }
      if (target.href === GENERIC_NO_PRICE) {
        return { status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(genericHtml) };
      }
      return { status: 404, contentType: 'text/plain', body: Buffer.from('missing') };
    },
  });

  try {
    const guest = startGuest(undefined, database);
    installAuthTestHooks({ user: guest.user });

    const apple = await call(items, 'POST', '/api/items', { url: APPLE_BUY }, undefined, sameOrigin);
    assert.equal(apple.status, 201, apple.text);
    const appleBody = apple.json as {
      id: number;
      current_price: number | null;
      scrape_status: string | null;
      scrape_error: string | null;
      scrapeNote: string | null;
    };
    assert.equal(appleBody.current_price, null);
    assert.equal(appleBody.scrape_status, 'failed');
    assert.equal(appleBody.scrape_error, CONFIGURATOR_PRICE_NOTE);
    assert.equal(appleBody.scrapeNote, CONFIGURATOR_PRICE_NOTE);
    const appleRow = database.prepare(
      'SELECT current_price, scrape_status, scrape_error FROM items WHERE id = ?',
    ).get(appleBody.id) as { current_price: number | null; scrape_status: string | null; scrape_error: string | null };
    assert.equal(appleRow.current_price, null);
    assert.equal(appleRow.scrape_status, 'failed');
    assert.equal(appleRow.scrape_error, CONFIGURATOR_PRICE_NOTE);
    assert.match(
      scrapeFailureCaption(appleRow.scrape_error, 'other', { forGuest: true }),
      /構成ページ|価格未取得/,
    );

    const generic = await call(items, 'POST', '/api/items', { url: GENERIC_NO_PRICE }, undefined, sameOrigin);
    assert.equal(generic.status, 201, generic.text);
    const genericBody = generic.json as {
      id: number;
      current_price: number | null;
      scrape_status: string | null;
      scrape_error: string | null;
    };
    assert.equal(genericBody.current_price, null);
    assert.equal(genericBody.scrape_status, 'failed');
    assert.equal(genericBody.scrape_error, PRICE_LATER_NOTE);
    assert.match(
      scrapeFailureCaption(genericBody.scrape_error, 'other', { forGuest: true }),
      /価格を取得できませんでした/,
    );
    assert.notEqual(
      scrapeFailureCaption(genericBody.scrape_error, 'other', { forGuest: true }),
      '価格を更新できていません',
    );
  } finally {
    installProductFetchPort(null);
    installAuthTestHooks({ user: null });
  }
});

test('scrapeFailureCaption names missing-price and USD fallback clearly (#415)', () => {
  assert.match(scrapeFailureCaption(PRICE_LATER_NOTE), /価格を取得できませんでした/);
  assert.match(scrapeFailureCaption(CONFIGURATOR_PRICE_NOTE), /構成ページ|価格未取得/);
  assert.match(scrapeFailureCaption(amazonUsdFallbackNote(6.06), 'amazon'), /円の新品価格/);
  assert.equal(scrapeFailureCaption('price not found'), '価格を更新できていません');
});
