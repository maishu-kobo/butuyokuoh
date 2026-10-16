import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { decodeHtml, readHtmlResponse } from '../src/lib/html-encoding';
import { requestPage } from '../src/lib/public-page';
import { parseProductHtml } from '../src/lib/product-html';
import { scrapeUrl } from '../src/lib/scraper';

const name = '日本語の商品';
// Fixed encoded bytes, independent of the decoder under test.
const eucName = Buffer.from('c6fccbdcb8eca4cebea6c9ca', 'hex');
const sjisName = Buffer.from('93fa967b8cea82cc8fa49569', 'hex');
const productUrl = 'https://item.rakuten.co.jp/crispin/giacometti_fg173_anero/?variantId=43308';
function page(title: Buffer, declaration = '') {
  return Buffer.concat([
    Buffer.from(`${declaration}<title>`), title,
    Buffer.from('</title><span class="normal_reserve_item_name"><b>nested name</b></span><p>200'),
    Buffer.from(title === eucName ? 'b1df' : '897e', 'hex'), // 円 in the matching encoding.
    Buffer.from('</p><meta property="og:image" content="https://shop.r10s.jp/example/shoes.jpg"><script type="application/ld+json">{"offers":{"price":107800,"priceCurrency":"JPY"}}</script>'),
  ]);
}

test('HTTP charset decodes EUC-JP and Shift_JIS before product extraction', () => {
  for (const [bytes, contentType] of [
    [page(eucName), 'text/html;charset=EUC-JP'],
    [page(sjisName), 'text/html; CHARSET = "Windows-31J"'],
    [page(eucName, '<meta charset="UTF-8">'), "text/html; charset='euc-jp'"],
  ] as const) {
    const product = parseProductHtml(decodeHtml(bytes, contentType), productUrl);
    assert.equal(product.name, name);
    assert.equal(product.price, 107800);
    assert.equal(product.imageUrl, 'https://shop.r10s.jp/example/shoes.jpg');
  }
});

test('HTML charset declarations support legacy http-equiv and skip comments/scripts', () => {
  for (const declaration of [
    '<meta charset=Shift_JIS>',
    "<META CONTENT='text/html; charset=Shift_JIS' HTTP-EQUIV='Content-Type'>",
    '<!-- <meta charset="UTF-8"> --><script>const x = \'<meta charset="UTF-8">\';</script><meta charset=Shift_JIS>',
    '<meta data-charset="UTF-8"><meta charset="unknown-encoding"><meta charset=Shift_JIS>',
  ]) {
    for (const header of ['text/html', 'text/html; charset=unknown-encoding']) {
      assert.equal(parseProductHtml(decodeHtml(page(sjisName, declaration), header), productUrl).name, name);
    }
  }
  assert.equal(parseProductHtml(decodeHtml(page(eucName, '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">')), productUrl).name, name);
});

test('BOM wins over conflicting declarations and UTF-8 remains the default', () => {
  const html = `<title>${name} 🥾</title>`;
  for (const header of ['', 'text/html', 'text/html; charset=unknown-encoding']) {
    assert.equal(decodeHtml(Buffer.from(html), header), html);
  }
  assert.equal(decodeHtml(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(html)]), 'text/html; charset=EUC-JP'), html);
  assert.equal(decodeHtml(Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(html, 'utf16le')]), 'text/html; charset=Shift_JIS'), html);
  assert.equal(decodeHtml(Buffer.concat([Buffer.from([0xfe,0xff]), Buffer.from(html, 'utf16le').swap16()])), html);
});

test('bounded guest transport decodes multi-byte characters split across chunks', async () => {
  const bytes = page(eucName);
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=EUC-JP');
    res.write(bytes.subarray(0,8)); // Split inside the first Japanese character.
    setImmediate(() => res.end(bytes.subarray(8)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as {port:number}).port;
  try {
    const result = await requestPage(new URL(`http://fixture.example:${port}/product`), {address:'127.0.0.1',family:4}, AbortSignal.timeout(2000));
    assert.equal(parseProductHtml(result.html, productUrl).name, name);
    assert.equal(parseProductHtml(result.html, productUrl).price, 107800);
  } finally { server.closeAllConnections(); server.close(); }
});

test('member Rakuten and generic scraping use the same byte decoder and preserve metadata', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(page(eucName), {headers:{'Content-Type':'text/html;charset=EUC-JP'}}));
  for (const url of [productUrl, 'https://example.com/products/shoes']) {
    const product = await scrapeUrl(url);
    assert.equal(product.name, name);
    assert.equal(product.price, 107800); // Not the shipping charge in the body.
    assert.equal(product.imageUrl, 'https://shop.r10s.jp/example/shoes.jpg');
  }
  const response = new Response(page(sjisName, '<meta charset="Shift_JIS">'), {headers:{'Content-Type':'text/html'}});
  assert.equal(parseProductHtml(await readHtmlResponse(response), productUrl).name, name);
});
