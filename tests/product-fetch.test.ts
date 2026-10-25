import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { isPublicAddress, publicPageUrl, fetchPublicPage, requestPage, MAX_PAGE_BYTES, MAX_AMAZON_PAGE_BYTES, PRODUCT_FETCH_HELP } from '../src/lib/public-page';
import { parseProductHtml } from '../src/lib/product-html';
import { extractAmazonProduct, isAmazonProductPage } from '../src/lib/amazon-product';

test('public addresses only, including normalized and mapped IP bypasses', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.31.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','192.0.2.1','198.18.0.1','224.0.0.1','255.255.255.255','::1','::','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::','64:ff9b::7f00:1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  for (const url of ['file:///etc/passwd','http://2130706433','http://0x7f000001','http://127.1','http://[::ffff:127.0.0.1]','http://localhost.','http://metadata.internal','https://user:pass@example.com','https://example.com:8443/']) {
    assert.throws(() => publicPageUrl(url), url);
  }
  assert.equal(publicPageUrl('https://example.com:443/product#x').href, 'https://example.com/product');
});

test('reject private DNS answers and private redirects before opening a socket', async () => {
  let requests = 0;
  const request: typeof requestPage = async () => { requests++; return {status:302,location:'http://169.254.169.254/latest/meta-data',html:''}; };
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolve: async () => [{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}], request,
  }));
  assert.equal(requests, 0);
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolve: async () => [{address:'8.8.8.8',family:4}], request,
  }));
  assert.equal(requests, 1);
});

test('pin each connection to the validated DNS result and revalidate every redirect', async () => {
  let lookups = 0, requests = 0;
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolve: async () => [{address:++lookups === 1 ? '8.8.8.8' : '127.0.0.1',family:4}],
    request: async (_url,address) => {
      requests++; assert.equal(address.address,'8.8.8.8');
      return {status:302,location:'/redirect',html:''};
    },
  }));
  assert.equal(lookups,2); assert.equal(requests,1);
  requests = 0;
  await assert.rejects(fetchPublicPage('https://example.com', {
    resolve: async () => [{address:'8.8.8.8',family:4}],
    request: async () => { requests++; return {status:302,location:'/loop',html:''}; },
  }));
  assert.equal(requests,4);
});

test('deadline includes DNS and response reading', async () => {
  let requests = 0;
  await assert.rejects(fetchPublicPage('https://example.com', {
    timeoutMs:20, resolve: async () => new Promise(() => {}),
    request: async () => { requests++; return {status:200,html:''}; },
  }), /時間がかかって/);
  assert.equal(requests,0);
  await assert.rejects(fetchPublicPage('https://example.com', {
    timeoutMs:20, resolve: async () => [{address:'8.8.8.8',family:4}],
    request: async () => new Promise(() => {}),
  }), /時間がかかって/);
});

test('HTTP transport bounds streamed bodies and refuses non-HTML and compressed payloads', async () => {
  // Test the transport directly on loopback; fetchPublicPage never allows it.
  const server = createServer((req,res) => {
    res.setHeader('Content-Type', req.url === '/json' ? 'application/json' : 'text/html');
    if (req.url === '/compressed') res.setHeader('Content-Encoding','gzip');
    if (req.url === '/large') { res.write('x'.repeat(MAX_PAGE_BYTES)); res.end('overflow'); }
    else if (req.url === '/redirect') { res.writeHead(302,{Location:'http://127.0.0.1/private'}); res.end(); }
    else res.end('<title>fixture</title>');
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port = (server.address() as {port:number}).port;
  const get = (path: string) => requestPage(new URL(`http://fixture.example:${port}${path}`), {address:'127.0.0.1',family:4}, AbortSignal.timeout(2000));
  try {
    assert.equal((await get('/ok')).html,'<title>fixture</title>');
    for (const path of ['/json','/compressed','/large']) await assert.rejects(get(path));
    assert.equal((await get('/redirect')).location,'http://127.0.0.1/private');
  } finally { server.closeAllConnections(); server.close(); }
});

test('PITAKA-style product metadata preserves decimal yen and HTTPS CDN images', () => {
  const html = `<title>MagEZ Grip 3 – PITAKA Japan</title>
    <meta property="og:image" content="http://pitakajapan.com/cdn/grip.webp?a=1&amp;b=2">
    <script type="application/ld+json">{"hasVariant":[{"offers":{"price":"3999.00","priceCurrency":"JPY"}}]}</script>`;
  assert.deepEqual(parseProductHtml(html,'https://pitakajapan.com/products/magez-grip'), {
    name:'MagEZ Grip 3',price:3999,imageUrl:'https://pitakajapan.com/cdn/grip.webp?a=1&b=2',source:'other',sourceName:'Pitakajapan',
  });
  const relative = parseProductHtml('<title>Product</title><meta property="og:image" content="//cdn.example.com/a.webp">','https://example.com/products/a');
  assert.equal(relative.imageUrl,'https://cdn.example.com/a.webp');
  assert.equal(parseProductHtml('<title>Product</title>','https://example.com').price,null);
});

const amazonProduct = `<img src="https://m.media-amazon.com/images/I/case.jpg" id="landingImage">
  <span id="productTitle">NIMASO &amp; ケース</span>
  <div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price a-text-price"><span class="a-offscreen">￥8,999</span></span>
    <div class="installment"><span class="a-price">￥300</span></div>
    <span class="a-price priceToPay"><span class="a-offscreen">￥3,499</span><span aria-hidden="true">￥3,499</span></span>
  </div><div id="recommendations"><span class="a-price">￥999</span></div>`;

test('Amazon parser uses the buy-box price and main image, independent of attribute order', () => {
  assert.deepEqual(extractAmazonProduct(amazonProduct), {
    name:'NIMASO & ケース',price:3499,imageUrl:'https://m.media-amazon.com/images/I/case.jpg',source:'amazon',sourceName:'Amazon',
  });
  const mobile = `<span id='productTitle'>モバイル商品</span><div id='corePrice_mobile_feature_div'><span class='a-price'><span>￥</span><span>2,999</span></span></div>`;
  assert.equal(extractAmazonProduct(mobile).price,2999);
  assert.equal(extractAmazonProduct(`<span id="productTitle">旧形式</span><span id="priceblock_dealprice">￥1,999</span>`).price,1999);
});

test('missing price is not replaced by recommendations, foreign currency or incomplete HTML', () => {
  const noOffer = `<span id="productTitle">在庫なし商品</span><div id="apex_desktop"></div><div id="recommendations"><span class="a-price">￥2,599</span></div>`;
  assert.equal(extractAmazonProduct(noOffer).price,null);
  assert.equal(extractAmazonProduct(`<span id="productTitle">商品</span><div id="apex_desktop"><span class="a-price">USD 20.50</span></div>`).price,null);
  assert.equal(extractAmazonProduct(`<span id="productTitle">商品</span><div id="apex_desktop"><span class="a-price">￥4,`).price,null);
  assert.equal(extractAmazonProduct('<title>Robot Check</title>').name,'不明な商品');
});

test('Amazon short-link redirect is revalidated and resolved as a product page', async () => {
  const visited: string[] = [];
  const page = await fetchPublicPage('https://amzn.asia/d/example', {
    resolve: async () => [{address:'8.8.8.8',family:4}],
    request: async url => {
      visited.push(url.hostname);
      return url.hostname === 'amzn.asia' ? {status:301,location:'https://www.amazon.co.jp/dp/B0HCNJW81Q',html:''} : {status:200,html:amazonProduct};
    },
  });
  assert.deepEqual(visited,['amzn.asia','www.amazon.co.jp']);
  assert.equal(isAmazonProductPage(new URL(page.url)),true);
  for (const url of ['https://amazon.co.jp.evil.example/dp/B0HCNJW81Q','https://evil.example/?url=https://www.amazon.co.jp/dp/B0HCNJW81Q','https://www.amazon.co.jp/s?k=case']) {
    assert.equal(isAmazonProductPage(new URL(url)),false);
  }
});

test('large Amazon HTML can be registered; beyond its cap keeps complete product metadata', async () => {
  const server = createServer((req,res) => {
    res.setHeader('Content-Type','text/html');
    const total = req.url?.endsWith('/oversized') ? MAX_AMAZON_PAGE_BYTES + 1000 : MAX_PAGE_BYTES + 1000;
    const prefix = Buffer.from(amazonProduct);
    if (req.url?.includes('declared')) res.setHeader('Content-Length',total);
    res.write(prefix);
    res.end(Buffer.alloc(total - prefix.length,32));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port = (server.address() as {port:number}).port;
  const get = (path:string,host='www.amazon.co.jp') => requestPage(new URL(`http://${host}:${port}${path}`), {address:'127.0.0.1',family:4}, AbortSignal.timeout(3000));
  try {
    for (const path of ['/dp/B0HCNJW81Q/normal','/dp/B0HCNJW81Q/declared']) {
      const result = await get(path);
      assert.equal(result.truncated,undefined);
      assert.equal(extractAmazonProduct(result.html).price,3499);
    }
    for (const path of ['/dp/B0HCNJW81Q/oversized','/dp/B0HCNJW81Q/declared/oversized']) {
      const result = await get(path);
      assert.equal(result.truncated,true);
      assert.equal(Buffer.byteLength(result.html),MAX_AMAZON_PAGE_BYTES);
      assert.equal(extractAmazonProduct(result.html).name,'NIMASO & ケース');
      assert.equal(extractAmazonProduct(result.html).price,3499);
    }
    await assert.rejects(get('/dp/B0HCNJW81Q/normal','www.amazon.co.jp.evil.example'), {message:PRODUCT_FETCH_HELP});
    assert.doesNotMatch(PRODUCT_FETCH_HELP,/大きすぎ|バイト|MiB/);
  } finally { server.closeAllConnections(); server.close(); }
});
