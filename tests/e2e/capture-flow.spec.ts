import { expect, test, type Page } from '@playwright/test';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: { email: `flow-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

test('a member can take or choose a photo, edit the name, and register a candidate', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url().includes('/api/capture/identify')) calls.push('identify');
    if (request.url().includes('/api/capture/search')) calls.push('search');
  });

  await member(page);
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();

  const shoot = page.getByRole('button', { name: '撮る', exact: true });
  await expect(shoot).toBeVisible();
  const box = await shoot.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  const camera = page.getByLabel('写真を撮る');
  await expect(camera).toHaveAttribute('capture', 'environment');
  await expect(page.getByRole('button', { name: '写真を選ぶ' })).toBeVisible();

  await camera.setInputFiles({ name: 'shot.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('button', { name: 'テスト用ゲルボールペン 0.5' })).toBeVisible();
  await expect(page.getByText('sure')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '候補が2件あります' })).toBeVisible();
  await expect(page.getByText('テストショップ')).toBeVisible();
  await expect(page.getByText('¥980')).toBeVisible();
  await expect(page.getByRole('link', { name: '商品ページ' }).first()).toHaveAttribute('href', /store\.shopping\.yahoo\.co\.jp/);
  const chooseBox = await page.getByRole('checkbox', { name: '候補を選ぶ テスト用ゲルボールペン 0.5' }).first().boundingBox();
  expect(chooseBox).toBeTruthy();
  expect(chooseBox!.width).toBeGreaterThanOrEqual(24);
  expect(chooseBox!.height).toBeGreaterThanOrEqual(24);

  await page.getByRole('button', { name: '安い順' }).click();
  await expect(page.getByRole('button', { name: '安い順' })).toHaveAttribute('aria-pressed', 'true');

  const identifies = () => calls.filter((call) => call === 'identify').length;
  const searches = () => calls.filter((call) => call === 'search').length;
  const identifyBefore = identifies();
  const searchBefore = searches();
  expect(identifyBefore).toBeGreaterThan(0);
  expect(searchBefore).toBeGreaterThan(0);

  await page.getByLabel('探す商品名').fill('別のペン');
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect(page.getByRole('checkbox', { name: '候補を選ぶ 別のペン' }).first()).toBeVisible();
  expect(identifies()).toBe(identifyBefore);
  expect(searches()).toBe(searchBefore + 1);

  await page.getByRole('checkbox', { name: '候補を選ぶ 別のペン' }).first().check();
  await page.getByRole('button', { name: '選んだ候補を登録' }).click();
  await expect(page.getByRole('heading', { name: '別のペン' })).toBeVisible();
});
