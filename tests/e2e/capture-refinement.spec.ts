import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('an uncertain photo asks for detail and a filename code is used only after confirmation', async ({ page }) => {
  const searches: unknown[] = [];
  await page.route('**/api/capture/identify', route => route.fulfill({ json: {
    confidence: 'unsure', products: [{ name: '黒い革のバッグ', brand: null, model: null, jan: null }],
  } }));
  await page.route('**/api/capture/search', route => {
    searches.push(route.request().postDataJSON());
    return route.fulfill({ json: { candidates: [], failures: [] } });
  });
  const response = await page.request.post('/api/auth/register', { data: { email: 'refinement@example.test', password: 'test-password' } });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  await page.getByLabel('写真ファイル').setInputFiles({ name: '7897722AA4V1000_F.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByText('写真だけでは商品を特定できませんでした。商品名を確認し、ブランド名や品番を補って探してください', { exact: true })).toBeVisible();
  await expect(page.getByText('ファイル名の品番候補（未確認）: 7897722AA4V1000')).toBeVisible();
  expect(searches).toEqual([]);
  await page.getByRole('button', { name: 'この品番で探す', exact: true }).click();
  await expect(page.getByText('見つかりませんでした', { exact: true })).toBeVisible();
  expect(searches).toEqual([{ name: '7897722AA4V1000', brand: null, model: null, jan: null }]);
  await expect(page.getByLabel('探す商品名', { exact: true })).toHaveValue('7897722AA4V1000');
  await page.getByLabel('探す商品名', { exact: true }).fill('Example Alpha');
  await page.getByRole('button', { name: 'この名前で探す', exact: true }).click();
  await expect.poll(() => searches.length).toBe(2);
  expect(searches[1]).toEqual({ name: 'Example Alpha', brand: null, model: null, jan: null });
});
