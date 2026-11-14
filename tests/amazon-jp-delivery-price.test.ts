// お届け先が国外のとき、Amazon.co.jp の買ボックス価格が空になる。
// 日本の郵便番号へ切り替えたあとの円価格を保存すること。取得は fixture。
import './regression-harness';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { mock, test } from 'node:test';
import { installProductFetchPort, type ProductLookupContext } from '../src/lib/product-fetch-port';
import { scrapeUrl } from '../src/lib/scraper';
import { scrapeGuestUrl } from '../src/lib/guest-scraper';
import type { ProductFixture } from '../src/lib/product-regression-fixtures';

const COVER = 'https://m.media-amazon.com/images/I/71jQu7A+XPL._AC_SL1500_.jpg';
const PRODUCT = 'https://www.amazon.co.jp/dp/B0HFZ4DCL8';
const GLOW_CSRF = 'test-glow-csrf-token';
const TITLE = 'パナソニック 日本製 ドラム式洗濯乾燥機 洗濯12kg/乾燥6kg 左開き NA-LX123FL-W マットホワイト';

function usDeliveryPage(): string {
  return `<!doctype html><html lang="ja-jp"><body>
<span id="nav-global-location-data-modal-action"
  data-a-modal="{&quot;ajaxHeaders&quot;:{&quot;anti-csrftoken-a2z&quot;:&quot;${GLOW_CSRF}&quot;}}"></span>
<div id="glow-ingress-block">
  <span id="glow-ingress-line1">お届け先</span>
  <span id="glow-ingress-line2">アメリカ合衆国</span>
</div>
<img id="landingImage" data-old-hires="${COVER}" src="${COVER}">
<span id="productTitle">${TITLE}</span>
<div id="desktop_buybox"><div id="buybox">
  <div id="outOfStockBuyBox_feature_div" class="celwidget">
    <div class="a-section">この商品は選択したお届け先には発送できません。別のお届け先を選択してください。</div>
    <div>アメリカ合衆国にお届け</div>
  </div>
  <div id="corePrice_desktop" class="celwidget"><div class="a-section a-spacing-small"></div></div>
  <input type="hidden" id="offerListingID" name="offerListingID" value="">
</div></div>
<div id="recommendations"><span class="a-price"><span class="a-offscreen">￥133,000</span></span></div>
</body></html>`;
}

function jpDeliveryPage(yen: number): string {
  return `<!doctype html><html lang="ja-jp"><body>
<span id="nav-global-location-data-modal-action"
  data-a-modal="{&quot;ajaxHeaders&quot;:{&quot;anti-csrftoken-a2z&quot;:&quot;${GLOW_CSRF}&quot;}}"></span>
<div id="glow-ingress-block">
  <span id="glow-ingress-line1">お届け先</span>
  <span id="glow-ingress-line2">千代田区千代田&nbsp;100-0001</span>
</div>
<img id="landingImage" data-old-hires="${COVER}" src="${COVER}">
<span id="productTitle">${TITLE}</span>
<div id="desktop_buybox"><div id="buybox">
  <div id="corePrice_desktop" class="celwidget">
    <span class="a-price a-text-normal aok-align-center reinventPriceAccordionT2 apex-pricetopay-value"
      data-a-size="l" data-a-color="base">
      <span class="a-offscreen">￥${yen.toLocaleString('en-US')}</span>
      <span aria-hidden="true">
        <span class="a-price-symbol">￥</span>
        <span class="a-price-whole">${yen.toLocaleString('en-US')}</span>
      </span>
    </span>
  </div>
  <input type="hidden" id="offerListingID" name="offerListingID" value="offer-jp">
</div></div>
<div id="recommendations"><span class="a-price"><span class="a-offscreen">￥133,000</span></span></div>
</body></html>`;
}

type Hit = { method: string; href: string; cookie: string; body: string };

function fixture(body: string, setCookie: string[] = [], contentType = 'text/html; charset=UTF-8'): ProductFixture {
  return { status: 200, body: Buffer.from(body), contentType, setCookie };
}

function installDeliverySwitch(hits: Hit[], yen: number) {
  installProductFetchPort({
    lookup: (url, context?: ProductLookupContext) => {
      const method = (context?.method ?? 'GET').toUpperCase();
      const headers = context?.headers ?? {};
      const cookie = headers.Cookie ?? headers.cookie ?? '';
      hits.push({ method, href: url.href, cookie, body: context?.body ?? '' });
      if (url.pathname === '/gp/delivery/ajax/address-change.html'
        || url.pathname === '/portal-migration/hz/glow/address-change') {
        assert.equal(method, 'POST');
        assert.match(context?.body ?? '', /1000001|100-0001/);
        assert.equal(headers['anti-csrftoken-a2z'] ?? headers['Anti-Csrftoken-A2z'], GLOW_CSRF);
        return fixture(
          JSON.stringify({
            isValidAddress: 1,
            isAddressUpdated: 1,
            successful: 1,
            address: { countryCode: 'JP', zipCode: '1000001', state: '東京都', city: '千代田区千代田' },
          }),
          ['ubid-acbjp=TESTUBID; Domain=.amazon.co.jp; Path=/; Secure'],
          'application/json',
        );
      }
      if (url.pathname.startsWith('/dp/')) {
        // After a successful glow change the jar carries ubid-acbjp (or equivalent).
        if (cookie.includes('ubid-acbjp=TESTUBID')) return fixture(jpDeliveryPage(yen));
        return fixture(usDeliveryPage());
      }
      return undefined;
    },
    timeoutMs: 400,
  });
}

test('US delivery buybox is empty and recommendation yen is ignored', async () => {
  const { extractAmazonListing } = await import('../src/lib/amazon-product');
  const listing = extractAmazonListing(usDeliveryPage());
  assert.equal(listing.price, null);
  assert.equal(listing.usdPrice, null);
  assert.equal(listing.name, TITLE);
  assert.equal(listing.imageUrl, COVER);
});

test('selecting a Japan zip on a US-delivery Amazon page saves the yen buybox price', async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const hits: Hit[] = [];
  installDeliverySwitch(hits, 263_340);
  try {
    const result = await scrapeUrl(PRODUCT);
    assert.equal(result.price, 263_340);
    assert.equal(result.name, TITLE);
    assert.equal(result.imageUrl, COVER);
    assert.equal(result.note, undefined);
    const glow = hits.find((hit) => hit.href.includes('address-change'));
    assert.ok(glow, hits.map((hit) => hit.href).join('\n'));
    assert.equal(glow.method, 'POST');
    assert.match(glow.body, /1000001|100-0001/);
    const productGets = hits.filter((hit) => hit.href.startsWith(PRODUCT) && hit.method === 'GET');
    assert.equal(productGets.length >= 2, true, JSON.stringify(productGets.map((h) => h.cookie)));
    assert.match(productGets.at(-1)?.cookie ?? '', /ubid-acbjp=TESTUBID/);
  } finally {
    installProductFetchPort(null);
    mock.restoreAll();
  }
});

test('guest scrape also saves the yen buybox price after Japan zip selection', async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const hits: Hit[] = [];
  installDeliverySwitch(hits, 263_340);
  process.env.GUEST_MODE_ENABLED = 'true';
  try {
    const { db } = await import('./regression-harness');
    const database = await db();
    const { startGuest } = await import('../src/lib/guest');
    const guest = startGuest(undefined, database);
    const result = await scrapeGuestUrl(PRODUCT, guest.user.id);
    assert.equal(result.price, 263_340);
    assert.equal(result.name, TITLE);
    assert.equal(result.imageUrl, COVER);
    assert.ok(hits.some((hit) => hit.href.includes('address-change')), hits.map((h) => h.href).join('\n'));
  } finally {
    delete process.env.GUEST_MODE_ENABLED;
    installProductFetchPort(null);
    mock.restoreAll();
  }
});

test('a Japan-delivery page does not call address-change', async () => {
  mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const hits: Hit[] = [];
  installProductFetchPort({
    lookup: (url, context?: ProductLookupContext) => {
      const method = (context?.method ?? 'GET').toUpperCase();
      hits.push({ method, href: url.href, cookie: '', body: context?.body ?? '' });
      if (url.pathname.startsWith('/dp/')) return fixture(jpDeliveryPage(263_340));
      return undefined;
    },
    timeoutMs: 400,
  });
  try {
    const result = await scrapeUrl(PRODUCT);
    assert.equal(result.price, 263_340);
    assert.equal(hits.some((hit) => hit.href.includes('address-change')), false);
  } finally {
    installProductFetchPort(null);
    mock.restoreAll();
  }
});
