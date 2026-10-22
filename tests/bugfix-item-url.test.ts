import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { call, createMember, db } from './bugfix-harness';

const items = '../src/app/api/items/route.ts';
const itemRoute = '../src/app/api/items/[id]/route.ts';
const extensionAdd = '../src/app/api/extension-add/route.ts';
const extensionImport = '../src/app/api/extension-import/route.ts';

test('members can save http and https urls, and the manual placeholder', async () => {
  const owner = await createMember('url-ok');
  const https = await call(items, 'POST', '/api/items', {
    manual: true, name: '公開ページ', url: 'https://example.com/item', price: 100,
  });
  const http = await call(items, 'POST', '/api/items', {
    manual: true, name: '平文', url: 'http://example.com/item', price: 100,
  });
  const manual = await call(items, 'POST', '/api/items', {
    manual: true, name: 'メモ', url: 'manual://memo', price: 100,
  });
  assert.equal(https.status, 201);
  assert.equal(http.status, 201);
  assert.equal(manual.status, 201);
  const database = await db();
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').get(owner.id) as { n: number }).n, 3);
});

test('members cannot save a javascript or other non-http url', async () => {
  const owner = await createMember('url-bad');
  const database = await db();
  for (const url of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'file:///etc/passwd']) {
    const manual = await call(items, 'POST', '/api/items', { manual: true, name: '危険', url, price: 100 });
    const scraped = await call(items, 'POST', '/api/items', { url, name: '危険' });
    assert.equal(manual.status, 400, url);
    assert.equal(scraped.status, 400, url);
    assert.match(manual.text, /http/);
  }
  const existing = database.prepare(`
    INSERT INTO items (user_id, name, url) VALUES (?, '既存', 'https://example.com/keep')
  `).run(owner.id);
  const patched = await call(itemRoute, 'PATCH', `/api/items/${existing.lastInsertRowid}`, {
    url: 'javascript:alert(1)',
  }, { id: String(existing.lastInsertRowid) });
  assert.equal(patched.status, 400);
  const stored = database.prepare('SELECT url FROM items WHERE id = ?').get(existing.lastInsertRowid) as { url: string };
  assert.equal(stored.url, 'https://example.com/keep');

  const { generateToken } = await import('../src/lib/auth');
  const token = generateToken(owner as never);
  const extension = await call(extensionAdd, 'POST', '/api/extension-add', {
    token,
    item: { name: '拡張', url: 'javascript:alert(1)', price: 100, imageUrl: null, priority: 3, categoryId: null },
  });
  assert.equal(extension.status, 400);
  const imported = await call(extensionImport, 'POST', '/api/extension-import', {
    token,
    source: 'other',
    items: [
      { name: '安全', url: 'https://example.com/from-extension', price: 10, imageUrl: null },
      { name: '危険', url: 'javascript:alert(1)', price: 10, imageUrl: null },
    ],
  });
  assert.equal(imported.status, 200);
  const rows = database.prepare('SELECT url FROM items WHERE user_id = ? ORDER BY url').all(owner.id) as { url: string }[];
  assert.deepEqual(rows.map((row) => row.url), ['https://example.com/from-extension', 'https://example.com/keep']);
});

test('existing non-http urls stay on screen but are not links', async () => {
  for (const file of ['src/components/ItemCard.tsx', 'src/components/PurchasedHistory.tsx', 'src/components/TrashView.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.equal(source.includes('href={item.url}'), false, file);
    assert.match(source, /linkableHttpUrl\(/, file);
  }
  const { linkableHttpUrl } = await import('../src/lib/http-url');
  assert.equal(linkableHttpUrl('javascript:alert(1)'), null);
  assert.equal(linkableHttpUrl('manual://memo'), null);
  assert.equal(linkableHttpUrl('https://example.com/item'), 'https://example.com/item');
  assert.equal(linkableHttpUrl('http://example.com/item'), 'http://example.com/item');
});
