import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { prepareHomeUi } from './home-ui-fixture';

// Temporary transport of synthetic-data screenshots; no application data or API calls.
test('revision baseline screenshots', async ({ page }) => {
  test.setTimeout(60000);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', route => route.abort());
    await page.setContent(await readFile(path.resolve('docs/ui-refresh-256/prototypes.html'), 'utf8'));
    for (const concept of ['a', 'b', 'c']) {
      await page.locator(`.study-controls [data-choose="${concept}"]`).click();
      await expect(page.locator('.prototype')).toHaveAttribute('data-concept', concept);
      const bytes = await page.screenshot({ type: 'jpeg', quality: 65, fullPage: true });
      console.log('UI_BASELINE|' + concept + '-' + width + '|' + bytes.toString('base64'));
    }
  }
  await page.unroute('**/*');
  await prepareHomeUi(page, 'light');
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: '商品名、メモ、カテゴリで検索' })).toBeVisible();
  await page.clock.runFor(250);
  console.log('UI_BASELINE|app-1280|' + (await page.screenshot({ type: 'jpeg', quality: 65, fullPage: true })).toString('base64'));
});
