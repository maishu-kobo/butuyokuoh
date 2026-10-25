import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';

const origin = 'http://localhost:3107';
const db = () => new Database(process.env.E2E_DB_PATH!);

// 未設定の実行を成功にしない。CI の既定レーンには入れない。
test.beforeAll(() => {
  const missing = ['E2E_LIVE_SCRAPE', 'E2E_LIVE_AMAZON', 'E2E_LIVE_RAKUTEN'].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`実店舗の検証を未実施のまま成功にしません。不足: ${missing.join(', ')}`);
});

test('live PITAKA URL add, refresh and editing preserve the fetched image', async ({ page, context: browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill('https://pitakajapan.com/products/magez-grip');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText(/PITAKA MagEZ Grip 3/).first()).toBeVisible();
  const items = await (await browser.request.get('/api/items')).json();
  const item = items.find((row: { url: string }) => row.url === 'https://pitakajapan.com/products/magez-grip');
  expect(item.current_price).toBeGreaterThan(0);
  expect(item.image_url).toMatch(/^https:\/\//);
  expect((await browser.request.patch(`/api/items/${item.id}`, { headers: { Origin: origin }, data: { name: 'MagEZ Grip', current_price: null, image_url: null } })).status()).toBe(200);
  await page.reload();
  const card = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByText('MagEZ Grip', { exact: true }) }).first();
  await card.getByRole('button', { name: '価格を更新', exact: true }).click();
  await expect(page.getByText('商品情報を更新しました')).toBeVisible();
  const refreshedCard = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByText(item.name, { exact: true }) }).first();
  await expect.poll(() => refreshedCard.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await refreshedCard.getByRole('button', { name: '編集', exact: true }).click();
  await refreshedCard.getByPlaceholder('商品名', { exact: true }).fill('PITAKA 動作確認');
  await refreshedCard.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('PITAKA 動作確認', { exact: true })).toBeVisible();
  expect((await (await browser.request.get(`/api/items/${item.id}`)).json()).image_url).toBe(item.image_url);
  await page.screenshot({ path: 'test-results/guest-url-product.png', fullPage: true });
  const connection = db();
  connection.prepare('UPDATE items SET current_price = 1 WHERE id = ?').run(item.id);
  connection.close();
  const refresh = await browser.request.post(`/api/items/${item.id}/refresh`, { headers: { Origin: origin } });
  expect(refresh.status()).toBe(409);
  expect((await (await browser.request.get(`/api/items/${item.id}`)).json()).current_price).toBe(1);
  const add = await browser.request.post('/api/items', { headers: { Origin: origin }, data: { url: 'https://pitakajapan.com/products/magez-grip?quota-test=1' } });
  expect(add.status()).toBe(409);
  expect(await (await browser.request.get('/api/items')).json()).toHaveLength(items.length);
  await page.goto('/add');
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill('https://pitakajapan.com/products/magez-grip');
  await page.getByRole('button', { name: '商品情報を取得', exact: true }).click();
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible();
});

test('live Amazon short link registers product metadata even without a published price', async ({ page, context: browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  const url = 'https://amzn.asia/d/0gH1wHkC';
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill(url);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: /NIMASO/ })).toBeVisible({ timeout: 20_000 });
  const items = await (await browser.request.get('/api/items')).json();
  const item = items.find((row: { url: string }) => row.url === url);
  expect(item).toMatchObject({ source: 'amazon', source_name: 'Amazon' });
  const image = new URL(item.image_url);
  expect(image.protocol).toBe('https:');
  expect(image.hostname === 'media-amazon.com' || image.hostname.endsWith('.media-amazon.com')).toBe(true);
  expect(item.name).toContain('NIMASO');
  if (item.current_price === null) await expect(page.getByText(/商品を追加しました。価格は取得できませんでした/)).toBeVisible();
  const card = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: item.name, exact: true }) }).first();
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await card.screenshot({ path: 'test-results/amazon-guest-registration.png' });
  const preview = await browser.request.post('/api/items/preview', { headers: { Origin: origin }, data: { url: 'https://www.amazon.co.jp/dp/B0HCNJW81Q' } });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({ name: item.name, source: 'amazon' });
  await card.getByRole('button', { name: '価格を更新', exact: true }).click();
  await expect(card.getByRole('status')).toBeVisible();
  expect((await (await browser.request.get(`/api/items/${item.id}`)).json()).image_url).toMatch(/^https:\/\//);
});

test('live Rakuten EUC-JP product is readable on add, preview and refresh of a garbled name', async ({ page, context: browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  const url = 'https://item.rakuten.co.jp/crispin/giacometti_fg173_anero/?variantId=43308';
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill(url);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: /ジャコメッティ/ })).toBeVisible({ timeout: 20_000 });
  const items = await (await browser.request.get('/api/items')).json();
  const item = items.find((row: { url: string }) => row.url === url);
  expect(item.name).not.toContain('\ufffd');
  expect(item.current_price).toBe(107800);
  expect(item.image_url).toMatch(/^https:\/\/shop.r10s.jp\//);
  const preview = await browser.request.post('/api/items/preview', { headers: { Origin: origin }, data: { url } });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toMatchObject({ name: item.name, price: 107800 });
  const garbledName = '\ufffd\ufffd文字化け再現';
  expect((await browser.request.patch(`/api/items/${item.id}`, { headers: { Origin: origin }, data: { name: garbledName } })).status()).toBe(200);
  await page.reload();
  const brokenCard = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: garbledName, exact: true }) }).first();
  await brokenCard.getByRole('button', { name: '価格を更新', exact: true }).click();
  await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible({ timeout: 20_000 });
  const card = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: item.name, exact: true }) }).first();
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await (await browser.request.get(`/api/items/${item.id}`)).json()).toMatchObject({ name: item.name, current_price: 107800, image_url: item.image_url });
  await card.getByRole('button', { name: '編集', exact: true }).click();
  await expect(card.getByPlaceholder('商品名', { exact: true })).toHaveValue(item.name);
  await card.screenshot({ path: 'test-results/rakuten-encoding.png' });
});
