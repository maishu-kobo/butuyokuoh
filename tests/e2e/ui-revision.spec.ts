import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { japaneseScreenshotFont } from './ui-revision-font';

async function capture(page: Page, name: string) {
  await japaneseScreenshotFont(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  console.log('UI_V2|' + name + '|' + (await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true })).toString('base64'));
}
for (const concept of ['a', 'b', 'c']) for (const width of [390, 1280]) {
  test(`revision ${concept} completes photo-to-plan at ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', route => route.abort());
    await page.setContent(await readFile(path.resolve('docs/ui-refresh-256/v2/prototypes.html'), 'utf8'));
    await page.locator(`[data-choose="${concept}"]`).click();
    await capture(page, concept + '-' + width + '-list');
    await page.locator('#query').fill('存在しない商品');
    await expect(page.getByText(/一致する商品はありません/)).toBeVisible();
    await page.locator('#query').fill('読書灯');
    await expect(page.locator('[data-item]')).toHaveCount(1);
    await expect(page.getByText('価格未取得', { exact: true }).first()).toBeVisible();
    await page.locator('#query').fill('');
    await page.locator('#capture-top').focus();
    await page.keyboard.press('Enter');
    if (concept === 'c') {
      await expect(page.locator('#capture-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#capture-top')).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await page.locator('#photo-file').setInputFiles({
      name: 'anonymous.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
    });
    if (concept !== 'c') await expect(page.locator('[data-local-photo]')).toBeVisible();
    // Use the identical source image for the comparison screenshots.
    if (concept === 'c') await page.getByRole('button', { name: '写真を選び直す', exact: true }).click();
    await page.locator('#sample-photo').click();
    await expect(page.getByText('写真からの推定：ヘッドホン。ブランド・型番は未確定です。')).toBeVisible();
    const next = page.locator(concept === 'c' ? '#confirm-candidate' : '#register-candidate');
    await expect(next).toBeDisabled();
    await page.locator('#candidate-qc25').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#candidate-qc25')).toBeChecked();
    await capture(page, concept + '-' + width + '-candidates');
    if (concept === 'c') {
      await next.click();
      await expect(page.getByText(/写真から同一商品と確定できたわけではありません/)).toBeVisible();
    }
    await page.locator('#register-candidate').click();
    await expect(page.locator('#heading')).toContainText('Bose QuietComfort 25');
    await expect(page.locator('.offers .offer')).toHaveCount(2);
    const cheaper = page.getByRole('radio', { name: 'リユース音楽店（架空）を選ぶ' });
    await cheaper.focus();
    await page.keyboard.press('Space');
    await expect(cheaper).toBeFocused();
    await expect(cheaper).toBeChecked();
    await page.locator('#plan-date').fill('2026-11-25');
    await page.locator('#save-plan').click();
    await capture(page, concept + '-' + width + '-stores');
    await page.locator('#view-plans').click();
    await expect(page.locator('.summary-total')).toContainText('¥153,200');
    await expect(page.getByText('1件は価格未取得のため合計に含みません。')).toBeVisible();
    await capture(page, concept + '-' + width + '-plans');
    await page.locator('#theme').click();
    await capture(page, concept + '-' + width + '-dark');
    await page.locator('#reset').click();
    await expect(page.locator('[data-item]')).toHaveCount(4);
    await expect(page.locator('[data-item="registered-qc25"]')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });
}
