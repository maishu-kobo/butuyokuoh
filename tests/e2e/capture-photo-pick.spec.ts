import { expect, test, type Page } from '@playwright/test';

const jpeg = [0xff, 0xd8, 0xff, 0x00];
const heic = Buffer.concat([Buffer.of(0, 0, 0, 0x18), Buffer.from('ftypheic'), Buffer.alloc(4)]);

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: { email: `pick-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

async function openAdd(page: Page) {
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
}

async function dropFiles(page: Page, files: { name: string; type: string; bytes: number[] }[]) {
  await page.locator('[data-testid="capture-photo-card"]').evaluate((card, payload) => {
    const transfer = new DataTransfer();
    for (const file of payload) {
      transfer.items.add(new File([Uint8Array.from(file.bytes)], file.name, { type: file.type }));
    }
    for (const type of ['dragover', 'drop'] as const) {
      card.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }, files);
}

test('a member chooses one readable photo and is guided away from files we cannot read', async ({ page }) => {
  await member(page);
  await openAdd(page);

  const choose = page.getByRole('button', { name: '写真を選ぶ' });
  await expect(choose).toBeVisible();
  const input = page.getByLabel('写真ファイル');
  await expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  await expect(input).toHaveJSProperty('multiple', false);
  expect(await input.evaluate((node: HTMLInputElement) => node.hasAttribute('capture'))).toBe(false);

  await input.setInputFiles({ name: 'a.heic', mimeType: 'image/heic', buffer: heic });
  await expect(page.getByRole('alert').filter({ hasText: 'この写真は読めません' })).toBeVisible();

  await dropFiles(page, [
    { name: 'a.jpg', type: 'image/jpeg', bytes: jpeg },
    { name: 'b.jpg', type: 'image/jpeg', bytes: jpeg },
  ]);
  await expect(page.getByRole('alert').filter({ hasText: '写真は1枚だけ選べます' })).toBeVisible();

  await dropFiles(page, [{ name: 'a.jpg', type: 'image/jpeg', bytes: jpeg }]);
  await expect(page.getByRole('status').filter({ hasText: '1枚の写真を選びました' })).toBeVisible();
  await expect(page.getByText('この写真は読めません')).toHaveCount(0);
  await expect(page.getByText('写真は1枚だけ選べます')).toHaveCount(0);
});

test('guests do not get the photo picker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'ゲスト体験' })).toBeVisible();
  await openAdd(page);
  await expect(page.getByRole('heading', { name: '新しいアイテムを追加' })).toBeVisible();
  await expect(page.getByRole('button', { name: '写真を選ぶ' })).toHaveCount(0);
});

test('the photo picker stays closed when capture is switched off', async ({ page }) => {
  await page.route('**/api/capture', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false, aiEnabled: false }),
    });
  });
  await member(page);
  const flags = page.waitForResponse(response => (
    response.url().includes('/api/capture') && response.request().method() === 'GET'
  ));
  await openAdd(page);
  expect(await (await flags).json()).toEqual({ enabled: false, aiEnabled: false });
  await expect(page.getByRole('heading', { name: '新しいアイテムを追加' })).toBeVisible();
  await expect(page.getByRole('button', { name: '写真を選ぶ' })).toHaveCount(0);
});
