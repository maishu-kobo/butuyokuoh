import type { Page } from '@playwright/test';

export async function switchUiVersion(page: Page) {
  await page.getByRole('button', {name: '画面デザインを切り替える', exact: true}).click();
  await page.getByRole('menuitemradio', {checked: false}).click();
}
