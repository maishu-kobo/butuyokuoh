import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';

const pixel = { create: { width: 8, height: 8, channels: 3 as const, background: { r: 20, g: 40, b: 60 } } };
let jpeg: Buffer;
const SURE_NAME = 'テスト用ゲルボールペン 0.5';

test.beforeAll(async () => {
  jpeg = await sharp(pixel).jpeg().toBuffer();
});

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

test('zero candidates say nothing was found and keep the search name editable', async ({ page }) => {
  const bodies: string[] = [];
  await page.route('**/api/capture/search', (route) => {
    bodies.push(route.request().postData() ?? '');
    return json(route, 200, {
      candidates: [],
      amazonUrl: 'https://www.amazon.co.jp/s?k=pen',
      failures: [],
    });
  });
  await member(page);
  await shoot(page);
  await expect(page.getByRole('status').filter({ hasText: '見つかりませんでした' })).toBeVisible();
  await expect(page.getByText('候補を取得できませんでした')).toHaveCount(0);
  await expect(page.getByPlaceholder('商品名を入力')).toHaveCount(0);
  const name = page.getByLabel('探す商品名');
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue(SURE_NAME);
  await expect(page.getByRole('button', { name: 'この名前で探す' })).toBeEnabled();
  const amazon = page.getByRole('link', { name: 'Amazonで探す' });
  await expect(amazon).toHaveAttribute('href', 'https://www.amazon.co.jp/s?k=pen');
  await expect(amazon).toHaveAttribute('target', '_blank');
  await expect(amazon).toHaveAttribute('rel', 'noopener noreferrer');
  await name.fill('ニーモシネ');
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(JSON.parse(bodies[1]).name).toBe('ニーモシネ');
  await expect(page.getByRole('status').filter({ hasText: '見つかりませんでした' })).toBeVisible();
  await expect(page.getByPlaceholder('商品名を入力')).toHaveCount(0);
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

test('an identify parse failure is retryable and is not shown as an unreadable photo', async ({ page }) => {
  let identifies = 0;
  await page.route('**/api/capture/identify', (route) => {
    identifies += 1;
    return json(route, 502, {
      code: 'AI_INVALID_RESPONSE',
      error: '写真の判定に失敗しました。もう一度試すか、商品名を入れてください',
      retryable: true,
      fallback: 'manual-entry',
    });
  });
  await member(page);
  await shoot(page);
  await expect(page.getByRole('status').filter({ hasText: '写真の判定に失敗しました' })).toBeVisible();
  await expect(page.getByText('この写真からは商品が読み取れません')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'もう一度判定する' })).toBeVisible();
  const before = identifies;
  await page.getByRole('button', { name: 'もう一度判定する' }).click();
  await expect.poll(() => identifies).toBeGreaterThan(before);
});

test('an unreadable photo does not offer another identify attempt', async ({ page }) => {
  await page.route('**/api/capture/identify', (route) => json(route, 200, {
    confidence: 'unreadable',
    products: [],
  }));
  await member(page);
  await shoot(page);
  await expect(page.getByRole('status').filter({ hasText: 'この写真からは商品が読み取れません。もう一度撮ってください' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'もう一度判定する' })).toHaveCount(0);
});

test('missing store keys disable another search instead of asking for a retry', async ({ page }) => {
  await page.route('**/api/capture/search', (route) => json(route, 503, {
    code: 'SEARCH_NOT_CONFIGURED',
    error: 'ストア検索のキーが未設定のため候補を出せません。商品名を確認して登録してください',
  }));
  await member(page);
  await shoot(page);
  await expect(page.getByRole('status').filter({ hasText: 'ストア検索のキーが未設定のため候補を出せません' })).toBeVisible();
  await expect(page.getByText('もう一度試すか、商品名を入れて登録してください')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この名前で探す' })).toBeDisabled();
  await expectManual(page, SURE_NAME);
});

test('a thrown shop search retries the same name and does not identify again', async ({ page }) => {
  let identifies = 0;
  let searches = 0;
  await page.route('**/api/capture/identify', async (route) => {
    identifies += 1;
    await route.continue();
  });
  await page.route('**/api/capture/search', async (route) => {
    searches += 1;
    if (searches === 1) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await member(page);
  await shoot(page);
  await expect(page.getByRole('status').filter({ hasText: '候補を取得できませんでした' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'もう一度判定する' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'もう一度探す' })).toBeVisible();
  await expectManual(page, SURE_NAME);
  const identifiesBefore = identifies;
  await page.getByRole('button', { name: 'もう一度探す' }).click();
  await expect.poll(() => searches).toBe(2);
  expect(identifies).toBe(identifiesBefore);
  await expect(page.getByRole('status').filter({ hasText: '候補が' })).toBeVisible();
  await expect(page.getByPlaceholder('商品名を入力')).toHaveCount(0);
  await expect(page.getByPlaceholder('https://www.amazon.co.jp/...')).toHaveCount(0);
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
