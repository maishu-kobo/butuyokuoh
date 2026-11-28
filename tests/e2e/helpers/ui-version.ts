import type { Page } from '@playwright/test';

export async function switchUiVersion(page: Page) {
  await page.getByRole('button', {name: '画面の表示切替', exact: true}).click();
  await page.getByRole('menuitemradio', {checked: false}).click();
}
