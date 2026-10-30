import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { UI_TIME } from './home-ui-fixture';

for (const concept of ['a', 'b', 'c']) {
  for (const width of [390, 1280]) {
    test(`prototype ${concept} works at ${width}`, async ({ page }, testInfo) => {
      await page.clock.install({ time: new Date(UI_TIME) });
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/*', route => route.abort());
      await page.setContent(await readFile(path.resolve('docs/ui-refresh-256/prototypes.html'), 'utf8'));
      await page.locator(`.study-controls [data-choose="${concept}"]`).click();
      await expect(page.locator('.prototype')).toHaveAttribute('data-concept', concept);
      const first = page.locator('[data-select]').first();
      await first.focus();
      await page.keyboard.press('Space');
      await expect(first).toBeChecked();
      await expect(first).toBeFocused();
      await page.locator('[data-select]').nth(1).check();
      await page.locator('#selected-compare').click();
      await expect(page.locator('#compare-dialog')).toBeVisible();
      await expect(page.locator('.compare-items section')).toHaveCount(2);
      await page.keyboard.press('Escape');
      const detail = page.locator('[data-detail]').first();
      await detail.click();
      await page.locator('#detail-date').fill('2026-12-15');
      await page.locator('#detail-save').click();
      await expect(detail).toBeFocused();
      await page.locator('#add-top').click();
      await page.locator('#product-url').fill('https://example.test/product');
      await page.locator('#url-preview').click();
      await page.locator('#url-save').click();
      await expect(page.locator('#app-status')).toContainText('1件');
      await page.locator('#add-top').click();
      await page.locator('#photo-mode').click();
      await page.locator('#photo-file').setInputFiles({
        name: 'anonymous.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'),
      });
      await expect(page.locator('#picked-photo')).toHaveAttribute('data-photo', 'local');
      await page.locator('#sample-photo').click();
      await expect(page.locator('#picked-photo')).toHaveAttribute('src', /^data:image\//);
      await expect(page.locator('#photo-result')).toContainText('ブランド・型番は未確定');
      await page.locator('#simulate-error').click();
      await expect(page.locator('#add-status')).toContainText('検索に失敗');
      await page.locator('#search-candidates').click();
      await expect(page.locator('.candidate-check')).toHaveCount(2);
      await page.locator('.candidate-check').first().check();
      await page.screenshot({ path: testInfo.outputPath(`${concept}-${width}-photo.png`), fullPage: true });
      await page.locator('#register-candidates').click();
      await expect(page.locator('#app-status')).toContainText('1件を登録');
      await page.locator('#query').fill('この試作に存在しないXYZ');
      await expect(page.locator('#products')).toContainText('条件に合う商品がありません');
      await page.locator('#query').fill('');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`${concept}-${width}-light.png`), fullPage: true });
      await page.locator('#theme-toggle').click();
      await expect(page.locator('#butuyoku-ui-study')).toHaveAttribute('data-theme', 'dark');
      await page.screenshot({ path: testInfo.outputPath(`${concept}-${width}-dark.png`), fullPage: true });
    });
  }
}
