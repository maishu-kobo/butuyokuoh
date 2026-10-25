import { test, expect } from '@playwright/test';

test('production server keeps guest entry and hides the capture test page', async ({ page, request }) => {
  expect((await request.get('/capture-hydration')).status()).toBe(404);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ゲストで試す', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await expect(page.getByRole('button', { name: '新しいアイテムを追加' })).toBeVisible();
  expect((await request.get('/api/auth/me')).ok()).toBeTruthy();
  const registered = await request.post('/api/auth/register', {
    data: { email: `prod-smoke-${Date.now()}@example.test`, password: 'test-password' },
  });
  expect(registered.ok()).toBeTruthy();
  expect((await request.get('/api/items')).ok()).toBeTruthy();
});
