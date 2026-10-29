import { test, expect } from '@playwright/test';
import { prepareHomeUi } from './home-ui-fixture';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`home discovery remains keyboard usable at ${width} in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await prepareHomeUi(page, theme);
      await page.goto('/');
      const search = page.getByRole('searchbox', { name: '商品名、メモ、カテゴリで検索' });
      const filters = page.getByRole('button', { name: /^絞り込み/ });
      await expect(search).toBeVisible();
      await expect(filters).toHaveAttribute('aria-expanded', 'false');
      await search.fill('このテストに存在しない商品XYZ');
      await expect(page.getByText('条件に一致するアイテムがありません')).toBeVisible();
      await search.fill('');
      await filters.focus();
      await page.keyboard.press('Enter');
      await expect(filters).toHaveAttribute('aria-expanded', 'true');
      await page.getByLabel('優先度', { exact: true }).selectOption('3');
      await expect(filters).toContainText('適用中');
      await filters.focus();
      await page.keyboard.press('Enter');
      await expect(filters).toHaveAttribute('aria-expanded', 'false');
      await expect(search).toBeVisible();
      await expect(page.getByLabel('並び順', { exact: true })).toBeVisible();
      const nav = page.getByRole('navigation', { name: '物欲王の画面' });
      const purchased = nav.getByRole('button', { name: '購入済', exact: true });
      await purchased.focus();
      await page.keyboard.press('Enter');
      await expect(purchased).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('heading', { name: '購入済み合計' })).toBeVisible();
      await expect(page.getByText('購入済みのアイテムはありません', { exact: true })).toBeVisible();
      const list = nav.getByRole('button', { name: 'リスト', exact: true });
      await list.focus();
      await page.keyboard.press('Enter');
      await expect(list).toHaveAttribute('aria-pressed', 'true');
      await expect(search).toBeVisible();
      await expect(page.getByRole('link', { name: '設定', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`home-${theme}-${width}.png`), fullPage: true });
    });
  }
}
