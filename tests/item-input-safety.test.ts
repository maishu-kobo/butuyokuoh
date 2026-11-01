import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchServerItemMedia, normalizeItemName, sanitizeStoredItemUrl } from '../src/lib/item-input';
import { displayableItemImageUrl, safeImgSrc } from '../src/lib/capture/image-hosts';
import {
  AMAZON_IMAGE,
  AMAZON_NAME,
  AMAZON_PRICE,
  AMAZON_PRODUCT_URL,
  regressionFetchPort,
} from '../src/lib/product-regression-fixtures';
import { call, createMember, db } from './bugfix-harness';

const extensionAdd = '../src/app/api/extension-add/route.ts';

test('sanitizeStoredItemUrl strips tracking without dropping product identity', () => {
  assert.equal(
    sanitizeStoredItemUrl('https://www.amazon.co.jp/dp/B0TESTASIN/ref=sr_1_1?tag=shop-22&utm_source=x&gclid=1&th=1&psc=1'),
    'https://www.amazon.co.jp/dp/B0TESTASIN?th=1&psc=1',
  );
  assert.equal(
    sanitizeStoredItemUrl('https://item.rakuten.co.jp/shop/item/?utm_campaign=a&variantId=9&fbclid=1'),
    'https://item.rakuten.co.jp/shop/item/?variantId=9',
  );
  assert.equal(
    sanitizeStoredItemUrl('https://hb.afl.rakuten.co.jp/hgc/link/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2Fitem'),
    'https://item.rakuten.co.jp/shop/item',
  );
  // 解けない包装は 400 にせずラッパーを残す
  const brokenAffiliate = 'https://hb.afl.rakuten.co.jp/hgc/link/?pc=https%3A%2F%2Fevil.example%2Fx';
  assert.equal(sanitizeStoredItemUrl(brokenAffiliate), brokenAffiliate);
  assert.equal(sanitizeStoredItemUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeStoredItemUrl('manual://memo-1'), 'manual://memo-1');
});

test('sanitizeStoredItemUrl keeps generic-site affiliate-ish params and only drops shared trackers', () => {
  assert.equal(
    sanitizeStoredItemUrl('https://shop.example/item?tag=aff&si=1&camp=2&creative=3&adid=4&ref=x&sc_foo=1&pk_campaign=1&utm_source=x&gclid=1'),
    'https://shop.example/item?tag=aff&si=1&camp=2&creative=3&adid=4&ref=x&sc_foo=1&pk_campaign=1',
  );
});

test('sanitizeStoredItemUrl is lossless for encoded values, empty values, and no-op when nothing matches', () => {
  // Shift_JIS 風の %82%A0 を URLSearchParams で壊さない
  assert.equal(
    sanitizeStoredItemUrl('https://example.com/p?q=%82%A0&utm_source=x'),
    'https://example.com/p?q=%82%A0',
  );
  // EUC-JP 風
  assert.equal(
    sanitizeStoredItemUrl('https://example.com/p?q=%A4%A2&fbclid=1'),
    'https://example.com/p?q=%A4%A2',
  );
  // 値なしキーと %20
  assert.equal(
    sanitizeStoredItemUrl('https://example.com/p?flag&q=a%20b&gclid=zz'),
    'https://example.com/p?flag&q=a%20b',
  );
  // 一致がなければ一切変えない（末尾の余計な & も残す）
  const untouched = 'https://example.com/p?keep=%82%A0&flag&q=a%20b&';
  assert.equal(sanitizeStoredItemUrl(untouched), untouched);
});

test('normalizeItemName trims and caps at 200 characters', () => {
  assert.equal(normalizeItemName('  ペン  '), 'ペン');
  assert.equal(normalizeItemName(`  ${'あ'.repeat(250)}  `)?.length, 200);
  assert.equal(normalizeItemName('   '), null);
  assert.equal(normalizeItemName('\n\t'), null);
});

test('displayableItemImageUrl allows https/http and safe uploads without a host allowlist', () => {
  assert.equal(
    displayableItemImageUrl('https://pitakajapan.com/cdn/grip.webp?a=1&b=2'),
    'https://pitakajapan.com/cdn/grip.webp?a=1&b=2',
  );
  assert.equal(
    displayableItemImageUrl('http://m.media-amazon.com/images/I/case.jpg'),
    'http://m.media-amazon.com/images/I/case.jpg',
  );
  assert.equal(
    displayableItemImageUrl('https://image.rakuten.co.jp/shop/cabinet/x.jpg'),
    'https://image.rakuten.co.jp/shop/cabinet/x.jpg',
  );
  assert.equal(displayableItemImageUrl('/uploads/1_2.jpg'), '/uploads/1_2.jpg');
  assert.equal(displayableItemImageUrl('/uploads/abc.avif'), '/uploads/abc.avif');
  assert.equal(displayableItemImageUrl('/demo/wishlist.svg'), '/demo/wishlist.svg');
  assert.equal(displayableItemImageUrl('javascript:alert(1)'), null);
  assert.equal(displayableItemImageUrl('data:text/html,x'), null);
  assert.ok(displayableItemImageUrl('data:image/png;base64,xx'));
  assert.equal(displayableItemImageUrl('//evil.example/a.png'), null);
  assert.equal(displayableItemImageUrl('/uploads/../secret.jpg'), null);
  assert.equal(displayableItemImageUrl('https://user:pass@example.com/a.png'), null);
  assert.equal(safeImgSrc('https://cdn.example/a.png'), 'https://cdn.example/a.png');
  assert.equal(safeImgSrc('javascript:alert(1)'), null);
});

test('ItemCard and list views gate images through displayableItemImageUrl', () => {
  for (const file of [
    'src/components/ItemCard.tsx',
    'src/components/PurchasedHistory.tsx',
    'src/components/TrashView.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /displayableItemImageUrl\(/, file);
    assert.equal(source.includes('src={item.image_url}'), false, file);
  }
  const addForm = readFileSync('src/components/AddItemForm.tsx', 'utf8');
  const itemCard = readFileSync('src/components/ItemCard.tsx', 'utf8');
  assert.match(addForm, /uploadPreviewSrc/);
  assert.match(itemCard, /uploadPreviewSrc/);
  assert.match(addForm, /safeImgSrc\(/);
  assert.match(itemCard, /safeImgSrc\(/);
  // 編集開始時は保存済み画像をプレビュー。入力欄の文字列は img に載せない（CodeQL）。
  assert.match(itemCard, /safeImgSrc\(item\.image_url\)/);
  assert.match(itemCard, /nextUrl !== item\.url/);
});

test('renaming keeps stored affiliate URLs and source_item_code; sanitized URL clash is 409', async () => {
  const itemRoute = '../src/app/api/items/[id]/route.ts';
  const member = await createMember('rename-keep-url');
  const database = await db();

  const hbUrl = 'https://hb.afl.rakuten.co.jp/hgc/link/?pc=https%3A%2F%2Fevil.example%2Fx';
  const hbId = Number(
    database.prepare(`
      INSERT INTO items (user_id, name, url, source_item_code, price_fetched_at)
      VALUES (?, '楽天包装', ?, 'rakuten:shop:hb-item', '2026-01-01T00:00:00Z')
    `).run(member.id, hbUrl).lastInsertRowid,
  );
  const taggedUrl = 'https://www.amazon.co.jp/dp/B0KEEPURL/?tag=shop-22&th=1';
  const taggedId = Number(
    database.prepare(`
      INSERT INTO items (user_id, name, url, source_item_code, price_fetched_at)
      VALUES (?, 'タグ付き', ?, 'amazon:B0KEEPURL', '2026-01-02T00:00:00Z')
    `).run(member.id, taggedUrl).lastInsertRowid,
  );

  const renamedHb = await call(itemRoute, 'PATCH', `/api/items/${hbId}`, {
    name: '楽天包装 改',
    url: hbUrl,
  }, { id: String(hbId) });
  assert.equal(renamedHb.status, 200, renamedHb.text);
  assert.deepEqual(
    database.prepare('SELECT name, url, source_item_code, price_fetched_at FROM items WHERE id = ?').get(hbId),
    {
      name: '楽天包装 改',
      url: hbUrl,
      source_item_code: 'rakuten:shop:hb-item',
      price_fetched_at: '2026-01-01T00:00:00Z',
    },
  );

  const renamedTag = await call(itemRoute, 'PATCH', `/api/items/${taggedId}`, {
    name: 'タグ付き 改',
    url: taggedUrl,
  }, { id: String(taggedId) });
  assert.equal(renamedTag.status, 200, renamedTag.text);
  assert.deepEqual(
    database.prepare('SELECT name, url, source_item_code, price_fetched_at FROM items WHERE id = ?').get(taggedId),
    {
      name: 'タグ付き 改',
      url: taggedUrl,
      source_item_code: 'amazon:B0KEEPURL',
      price_fetched_at: '2026-01-02T00:00:00Z',
    },
  );

  database.prepare(`
    INSERT INTO items (user_id, name, url)
    VALUES (?, '既存クリーン', 'https://www.amazon.co.jp/dp/B0CLASH001')
  `).run(member.id);
  const clashId = Number(
    database.prepare(`
      INSERT INTO items (user_id, name, url)
      VALUES (?, '衝突元', 'https://www.amazon.co.jp/dp/B0CLASH001?tag=other-22')
    `).run(member.id).lastInsertRowid,
  );
  const clash = await call(itemRoute, 'PATCH', `/api/items/${clashId}`, {
    url: 'https://www.amazon.co.jp/dp/B0CLASH001?tag=moved-22',
  }, { id: String(clashId) });
  assert.equal(clash.status, 409, clash.text);
  assert.match(String((clash.json as { error?: string }).error || clash.text), /すでに登録/);
  assert.equal(
    (database.prepare('SELECT url FROM items WHERE id = ?').get(clashId) as { url: string }).url,
    'https://www.amazon.co.jp/dp/B0CLASH001?tag=other-22',
  );
});

test('POST /api/items and extension-import treat dirty stored URLs as duplicates after sanitize', async () => {
  const items = '../src/app/api/items/route.ts';
  const extensionImport = '../src/app/api/extension-import/route.ts';
  const member = await createMember('dirty-dupe');
  const database = await db();
  database.prepare(`
    INSERT INTO items (user_id, name, url)
    VALUES (?, '既存汚い', 'https://www.amazon.co.jp/dp/B0DIRTY001?tag=old-22&utm_source=x')
  `).run(member.id);

  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(regressionFetchPort());
  try {
    const again = await call(items, 'POST', '/api/items', {
      url: 'https://www.amazon.co.jp/dp/B0DIRTY001?tag=new-22',
      name: '再登録',
    });
    assert.equal(again.status, 400, again.text);
    assert.match(String((again.json as { error?: string }).error || again.text), /既に登録/);
  } finally {
    port.installProductFetchPort(null);
  }

  const { generateToken } = await import('../src/lib/auth');
  const token = generateToken(member as never);
  const imported = await call(extensionImport, 'POST', '/api/extension-import', {
    token,
    source: 'amazon',
    items: [
      { name: 'インポート重複', url: 'https://www.amazon.co.jp/dp/B0DIRTY001?tag=import-22', price: 10, imageUrl: null },
    ],
  });
  assert.equal(imported.status, 200, imported.text);
  assert.equal((imported.json as { imported?: number; skipped?: number }).imported, 0);
  assert.equal((imported.json as { skipped?: number }).skipped, 1);
  assert.equal(
    (database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(member.id) as { n: number }).n,
    1,
  );
});

test('extension-add rate limit message differs for members; popup timeout and version are updated', async () => {
  const previous = process.env.EXTENSION_ADDS_PER_MINUTE;
  process.env.EXTENSION_ADDS_PER_MINUTE = '1';
  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('ext-rate');
    const { generateToken } = await import('../src/lib/auth');
    const token = generateToken(member as never);
    const first = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: {
        name: '一件目',
        url: 'https://example.test/rate-1',
        price: null,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    });
    assert.equal(first.status, 200, first.text);
    const limited = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: {
        name: '二件目',
        url: 'https://example.test/rate-2',
        price: null,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    });
    assert.equal(limited.status, 429, limited.text);
    assert.match(String((limited.json as { error?: string }).error || ''), /追加が集中/);
    assert.equal(String((limited.json as { error?: string }).error || '').includes('ゲスト'), false);
  } finally {
    if (previous === undefined) delete process.env.EXTENSION_ADDS_PER_MINUTE;
    else process.env.EXTENSION_ADDS_PER_MINUTE = previous;
    port.installProductFetchPort(null);
  }

  const popup = readFileSync('extension/popup.js', 'utf8');
  assert.match(popup, /一覧に追加済みか確認してください/);
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8')) as { version: string };
  assert.equal(manifest.version, '1.2.0');
});

test('fetchServerItemMedia prefers scraped price and image, and leaves both empty when unusable', async () => {
  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(regressionFetchPort());
  try {
    const ok = await fetchServerItemMedia(AMAZON_PRODUCT_URL);
    assert.equal(ok.price, AMAZON_PRICE);
    assert.equal(ok.imageUrl, AMAZON_IMAGE);
    assert.equal(ok.source, 'amazon');

    const miss = await fetchServerItemMedia('https://example.test/no-fixture');
    assert.equal(miss.price, null);
    assert.equal(miss.imageUrl, null);

    const timedOut = await fetchServerItemMedia(AMAZON_PRODUCT_URL, {
      timeoutMs: 1,
      deps: {
        request: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { status: 200, body: Buffer.from(''), contentType: 'text/html' };
        },
        resolve: async () => [{ address: '8.8.8.8', family: 4 as const }],
        maxRetries: 0,
        timeoutMs: 50,
      },
    });
    assert.equal(timedOut.price, null);
    assert.equal(timedOut.imageUrl, null);
  } finally {
    port.installProductFetchPort(null);
  }
});

test('extension-add stores server-fetched price and image, ignores client values, and sanitizes url/name', async () => {
  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(regressionFetchPort());
  try {
    const member = await createMember('ext-safe');
    const { generateToken } = await import('../src/lib/auth');
    const token = generateToken(member as never);
    const database = await db();

    const dirty = `${AMAZON_PRODUCT_URL}/ref=sr_1_1?tag=affiliate-22&utm_medium=email`;
    const response = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: {
        name: `  ${AMAZON_NAME}  `,
        url: dirty,
        price: 1,
        imageUrl: 'https://evil.example/client.png',
        priority: 3,
        categoryId: null,
      },
    });
    assert.equal(response.status, 200, response.text);
    const id = (response.json as { id: number }).id;
    const row = database.prepare(
      'SELECT name, url, image_url, current_price, original_price, source FROM items WHERE id = ?',
    ).get(id) as {
      name: string;
      url: string;
      image_url: string | null;
      current_price: number | null;
      original_price: number | null;
      source: string;
    };
    assert.equal(row.name, AMAZON_NAME);
    assert.equal(row.url, AMAZON_PRODUCT_URL);
    assert.equal(row.image_url, AMAZON_IMAGE);
    assert.equal(row.current_price, AMAZON_PRICE);
    assert.equal(row.original_price, AMAZON_PRICE);
    assert.equal(row.source, 'amazon');
    assert.equal(
      (database.prepare('SELECT price FROM price_history WHERE item_id = ?').get(id) as { price: number }).price,
      AMAZON_PRICE,
    );

    const empty = await call(extensionAdd, 'POST', '/api/extension-add', {
      token,
      item: {
        name: '  名前だけ  ',
        url: 'https://example.test/extension-empty?utm_source=x',
        price: 9999,
        imageUrl: 'https://evil.example/nope.png',
        priority: 2,
        categoryId: null,
      },
    });
    assert.equal(empty.status, 200, empty.text);
    const emptyRow = database.prepare(
      'SELECT name, url, image_url, current_price FROM items WHERE id = ?',
    ).get((empty.json as { id: number }).id) as {
      name: string;
      url: string;
      image_url: string | null;
      current_price: number | null;
    };
    assert.equal(emptyRow.name, '名前だけ');
    assert.equal(emptyRow.url, 'https://example.test/extension-empty');
    assert.equal(emptyRow.image_url, null);
    assert.equal(emptyRow.current_price, null);
  } finally {
    port.installProductFetchPort(null);
  }
});
