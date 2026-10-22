import { expect, test, type Page, type Route } from '@playwright/test';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const SURE_NAME = 'テスト用ゲルボールペン 0.5';

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: { email: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
}

async function shoot(page: Page) {
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'shot.jpg', mimeType: 'image/jpeg', buffer: jpeg });
}

async function expectManual(page: Page, name: string) {
  const productName = page.getByPlaceholder('商品名を入力');
  await expect(productName).toBeVisible();
  await expect(productName).toHaveValue(name);
  await expect(page.getByPlaceholder('画像URLを入力またはアップロード')).toHaveValue('');
  await expect(page.getByRole('img', { name: 'プレビュー' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'URLから追加' })).toBeVisible();
}

test('zero candidates open the manual form with the estimated name and no photo image', async ({ page }) => {
  await page.route('**/api/capture/search', (route) => json(route, 200, {
    candidates: [],
    amazonUrl: 'https://www.amazon.co.jp/s?k=4900000000009',
    failures: [],
  }));
  await member(page);
  await shoot(page);
  await expectManual(page, SURE_NAME);
});

test('an unreadable estimate opens the manual form with that product name and does not search', async ({ page }) => {
  let searches = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/capture/search')) searches += 1;
  });
  await page.route('**/api/capture/identify', (route) => json(route, 200, {
    confidence: 'unreadable',
    products: [{ name: '見えにくいペン', brand: null, model: null, jan: null }],
  }));
  await member(page);
  await shoot(page);
  await expectManual(page, '見えにくいペン');
  expect(searches).toBe(0);
});

test('the daily identify limit opens the manual form with the estimated name', async ({ page }) => {
  await page.route('**/api/capture/identify', (route) => json(route, 429, {
    code: 'AI_LIMIT',
    error: '今日は写真からの自動の判定が上限に達しました。商品名を入れて探してください',
    fallback: 'manual-entry',
    products: [{ name: '上限のペン', brand: null, model: null, jan: null }],
  }));
  await member(page);
  await shoot(page);
  await expectManual(page, '上限のペン');
});

test('a failed shop search opens the manual form with the estimated name and no photo image', async ({ page }) => {
  await page.route('**/api/capture/search', (route) => json(route, 502, {
    code: 'SEARCH_FAILED',
    error: '候補を取得できませんでした。もう一度試すか、商品名を入れて登録してください',
  }));
  await member(page);
  await shoot(page);
  await expectManual(page, SURE_NAME);
});
