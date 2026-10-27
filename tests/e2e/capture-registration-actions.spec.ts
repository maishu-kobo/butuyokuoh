import { expect, test } from '@playwright/test';
import sharp from 'sharp';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`registration stays reachable with 40 candidates at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      id: `fixture-${i}`, candidateId: i + 1, source: i % 2 ? 'rakuten' : 'yahoo',
      title: `商品候補 ${i + 1}`, shopName: 'テスト店舗', price: 1000 + i,
      url: `https://item.rakuten.co.jp/test/item-${i}`, imageUrl: null,
      fetchedAt: '2026-10-27T00:00:00Z',
    }));
    await page.route('**/api/capture/identify', route => route.fulfill({ json: {
      confidence: 'sure', products: [{ name: 'テスト商品', brand: 'テスト', model: 'A1', jan: null }],
    } }));
    await page.route('**/api/capture/search', route => route.fulfill({ json: {
      candidates, failures: [], attribution: { yahoo: true, rakuten: true }, amazonUrl: 'https://www.amazon.co.jp/s?k=test',
    } }));
    let finish: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const submissions: unknown[] = [];
    await page.route('**/api/capture/register', async route => {
      submissions.push(route.request().postDataJSON());
      await pending;
      await route.fulfill({ status: 503, json: { error: 'テスト用の再試行案内' } });
    });
    const response = await page.request.post('/api/auth/register', { data: { email: `actions-${viewport.width}@example.test`, password: 'test-password' } });
    expect(response.ok()).toBeTruthy();
    await page.goto('/');
    await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
    await page.getByLabel('写真ファイル').setInputFiles({ name: 'product.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.getByText('候補が40件あります')).toBeVisible();
    const controls = page.getByRole('region', { name: '候補の登録操作' });
    const register = controls.getByRole('button', { name: '選んだ候補を登録', exact: true });
    await expect(controls.getByText('0件選択中')).toBeVisible();
    await expect(register).toBeDisabled();
    for (const n of [1, 40]) {
      const choice = page.getByRole('checkbox', { name: `候補を選ぶ 商品候補 ${n}`, exact: true });
      await choice.scrollIntoViewIfNeeded();
      await choice.focus();
      await page.keyboard.press('Space');
      await expect(choice).toBeChecked();
      await expect(register).toBeInViewport();
      const [bar, row] = await Promise.all([controls.boundingBox(), choice.boundingBox()]);
      expect(bar && row).toBeTruthy();
      expect(bar!.y + bar!.height).toBeLessThanOrEqual(row!.y);
    }
    await expect(controls.getByText('2件選択中')).toBeVisible();
    await register.click();
    await expect(controls.getByRole('button', { name: '登録しています…' })).toBeDisabled();
    expect(submissions).toEqual([{ candidateIds: [1, 40] }]);
    finish!();
    await expect(page.getByRole('alert').filter({ hasText: 'テスト用の再試行案内' })).toBeVisible();
    await expect(register).toBeEnabled();
    await page.getByLabel('検索サービスのクレジット').scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: 'Supported by Rakuten Developers' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
