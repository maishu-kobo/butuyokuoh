import { test, expect } from '@playwright/test';

const pitakaUrl = 'https://pitakajapan.com/products/magez-grip';
const pitakaName = 'MagEZ Grip 3';
const pitakaImage = 'https://pitakajapan.com/cdn/grip.webp?a=1&b=2';
const rakutenUrl = 'https://item.rakuten.co.jp/crispin/giacometti_fg173_anero/?variantId=43308';
const rakutenName = '日本語の商品';
const failUrl = 'https://example.com/products/fetch-failed';
const origin = 'http://localhost:3107';

test('guest fixture URL shows the price and image, and editing keeps the image', async ({ page, context }) => {
  const request = context.request;
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill(pitakaUrl);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  const card = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: pitakaName, exact: true }) }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('¥3,999');
  await expect(card.getByRole('img', { name: pitakaName })).toHaveAttribute('src', pitakaImage);
  const items = await (await request.get('/api/items')).json();
  const item = items.find((row: { url: string }) => row.url === pitakaUrl);
  expect(item).toMatchObject({ name: pitakaName, current_price: 3999, image_url: pitakaImage });
  expect((await request.patch(`/api/items/${item.id}`, {
    headers: { Origin: origin },
    data: { name: 'MagEZ Grip', current_price: null, image_url: null },
  })).ok()).toBeTruthy();
  await page.reload();
  const cleared = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: 'MagEZ Grip', exact: true }) }).first();
  await cleared.getByRole('button', { name: '価格を更新', exact: true }).click();
  const restored = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: pitakaName, exact: true }) }).first();
  await expect(restored).toContainText('¥3,999');
  await expect(restored.getByRole('img', { name: pitakaName })).toHaveAttribute('src', pitakaImage);
  await restored.getByRole('button', { name: '編集', exact: true }).click();
  await restored.getByPlaceholder('商品名', { exact: true }).fill('編集後のグリップ');
  await restored.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '編集後のグリップ', exact: true })).toBeVisible();
  expect(await (await request.get(`/api/items/${item.id}`)).json()).toMatchObject({
    name: '編集後のグリップ', image_url: pitakaImage,
  });
});

test('server-side fetch failure keeps the form and explains manual entry once', async ({ page, context }) => {
  const request = context.request;
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill(failUrl);
  await page.getByPlaceholder('購入理由や比較ポイントなど').fill('入力したメモを残す');
  await page.locator('label', { hasText: /^優先度$/ }).locator('xpath=..').locator('select').selectOption('1');
  await page.locator('label', { hasText: /^購入予定日$/ }).locator('xpath=..').locator('input').fill('2026-11-01');
  await page.locator('label', { hasText: /^個数$/ }).locator('xpath=..').locator('input').fill('2');
  await page.locator('label', { hasText: /^カテゴリ$/ }).locator('xpath=..').locator('select').selectOption({ label: 'ガジェット' });
  await page.locator('label', { hasText: /^比較グループ$/ }).locator('xpath=..').locator('select').selectOption({ label: 'デスクの椅子選び' });
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('alert', { name: '商品追加エラー' })).toContainText('商品情報を自動取得できませんでした');
  await expect(page.getByRole('alert', { name: '商品追加エラー' })).not.toContainText('大きすぎ');
  await expect(page.getByRole('alert').filter({ hasText: '商品情報を自動取得できませんでした' })).toHaveCount(1);
  await page.getByRole('button', { name: '商品名を入力して追加', exact: true }).click();
  await expect(page.getByPlaceholder('https://...', { exact: true })).toHaveValue(failUrl);
  await expect(page.getByPlaceholder('購入理由や比較ポイントなど')).toHaveValue('入力したメモを残す');
  await expect(page.locator('label', { hasText: /^優先度$/ }).locator('xpath=..').locator('select')).toHaveValue('1');
  await expect(page.locator('label', { hasText: /^購入予定日$/ }).locator('xpath=..').locator('input')).toHaveValue('2026-11-01');
  await expect(page.locator('label', { hasText: /^個数$/ }).locator('xpath=..').locator('input')).toHaveValue('2');
  await expect(page.locator('label', { hasText: /^カテゴリ$/ }).locator('xpath=..').locator('select')).toHaveValue(/.+/);
  await expect(page.locator('label', { hasText: /^比較グループ$/ }).locator('xpath=..').locator('select')).toHaveValue(/.+/);
  await page.getByPlaceholder('商品名を入力').fill('手動で保存できた商品');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('手動で保存できた商品', { exact: true })).toBeVisible();
  const items = await (await request.get('/api/items')).json();
  const saved = items.find((item: { url: string }) => item.url === failUrl);
  expect(saved).toMatchObject({
    name: '手動で保存できた商品', notes: '入力したメモを残す', priority: 1, quantity: 2, planned_purchase_date: '2026-11-01',
  });
  expect(saved.category_id).toEqual(expect.any(Number));
  expect(saved.comparison_group_id).toEqual(expect.any(Number));
});

test('member fixture decodes the Rakuten name on add and refresh', async ({ page, context }) => {
  const request = context.request;
  const registered = await request.post('/api/auth/register', {
    data: { email: `rakuten-fixture-${Date.now()}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill(rakutenUrl);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: rakutenName, exact: true })).toBeVisible();
  const items = await (await request.get('/api/items')).json();
  const item = items.find((row: { url: string }) => row.url === rakutenUrl);
  expect(item).toMatchObject({ name: rakutenName, current_price: 107800, image_url: 'https://shop.r10s.jp/example/shoes.jpg' });
  expect((await request.patch(`/api/items/${item.id}`, {
    headers: { Origin: origin }, data: { name: '文字化け再現' },
  })).ok()).toBeTruthy();
  await page.reload();
  const broken = page.locator('div.rounded-lg.shadow-md').filter({ has: page.getByRole('heading', { name: '文字化け再現', exact: true }) }).first();
  await broken.getByRole('button', { name: '価格を更新', exact: true }).click();
  await expect(page.getByRole('heading', { name: rakutenName, exact: true })).toBeVisible();
  expect(await (await request.get(`/api/items/${item.id}`)).json()).toMatchObject({
    name: rakutenName, current_price: 107800, image_url: item.image_url,
  });
});
