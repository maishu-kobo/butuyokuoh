import { test, expect } from '@playwright/test';

const pitakaUrl = 'https://pitakajapan.com/products/magez-grip';
const pitakaName = 'MagEZ Grip 3';

test('product card offers exactly one dedicated store-page control', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByPlaceholder('https://www.amazon.co.jp/...').fill(pitakaUrl);
  await page.getByRole('button', { name: '追加', exact: true }).click();

  const card = page
    .locator('div.rounded-lg.shadow-md')
    .filter({ has: page.getByRole('heading', { name: pitakaName, exact: true }) })
    .first();
  await expect(card).toBeVisible();

  // 専用コントロールは「〇〇で開く」テキスト付きリンク1つだけ（右上アイコンは置かない）。
  const storeTextLinks = card.getByRole('link').filter({ hasText: /で開く|商品ページを開く/ });
  await expect(storeTextLinks).toHaveCount(1);
  await expect(storeTextLinks).toHaveAttribute('href', pitakaUrl);
  await expect(storeTextLinks).toHaveAttribute('target', '_blank');

  // 画像リンク（中に img）は別。右上にあったアイコン専用コントロールだけを数える。
  const iconOnlyStoreControls = await card.evaluate((el) =>
    [...el.querySelectorAll('a[target="_blank"]')].filter((anchor) => {
      if (anchor.querySelector('img')) return false;
      const text = (anchor.textContent || '').replace(/\s+/g, '');
      const aria = anchor.getAttribute('aria-label') || '';
      const looksLikeStore = /で開く|商品ページを開く/.test(aria) || /で開く|商品ページを開く/.test(text);
      return looksLikeStore && text.length === 0;
    }).length,
  );
  expect(iconOnlyStoreControls).toBe(0);
});
