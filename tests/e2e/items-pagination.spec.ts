import { test, expect, type Page } from '@playwright/test';
import type { Item } from '../../src/types';

// Synthetic catalogue only. Every API request is intercepted, including auth;
// this lane never calls a shopping site or photo model.
const catalogue: Item[] = Array.from({ length: 500 }, (_, i) => ({
  id: i + 1, name: `ページ商品${String(i + 1).padStart(4, '0')}`,
  url: `manual://pagination/${i + 1}`, image_url: null,
  current_price: (i + 1) * 100, original_price: null, source: 'other', source_name: null,
  priority: 3, planned_purchase_date: null, comparison_group_id: null, category_id: null,
  notes: null, is_purchased: false, purchased_at: null, target_price: null,
  target_currency: null, quantity: 1, deleted_at: null, sort_order: i,
  created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00',
}));

async function mockCatalogue(page: Page) {
  const requests: URL[] = [];
  let failMore = true;
  await page.clock.setFixedTime(new Date('2026-10-29T00:00:00Z'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/session') return respond({});
    if (path === '/api/auth/providers') return respond({});
    if (path === '/api/auth/guest') return respond({ enabled: false, ttlHours: 24 });
    if (path === '/api/auth/me') return respond({ user: { id: 9001, account_type: 'member', name: 'ページング検証', email: 'pagination@example.test' } });
    if (path === '/api/comparison-groups' || path === '/api/categories') return respond([]);
    if (path === '/api/purchased') return respond({ items: [] });
    if (path === '/api/capture') return respond({ enabled: false });
    if (path === '/api/items/page') {
      requests.push(url);
      const q = url.searchParams.get('q') || '';
      const sort = url.searchParams.get('sort');
      const rows = catalogue.filter(item => item.name.includes(q));
      if (sort === 'price_desc') rows.reverse();
      const offset = Number(url.searchParams.get('cursor') || 0);
      if (offset && failMore) { failMore = false; return respond({ error: 'simulated offline' }, 503); }
      return respond({
        items: rows.slice(offset, offset + 50), revision: JSON.stringify([q, sort]),
        totalCount: 500, matchedCount: rows.length, rowCount: rows.length,
        totalAmount: 12525000, lowestPriceInGroup: null,
        allIds: catalogue.map(item => item.id), matchedIds: rows.map(item => item.id),
        nextCursor: offset + 50 < rows.length ? String(offset + 50) : null,
      });
    }
    // Unexpected reads/writes fail visibly rather than reaching a real endpoint.
    return respond({ error: `Unmocked endpoint ${path}` }, 501);
  });
  return requests;
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`500-item catalogue: full-result filters, selection and append retry (${viewport.name})`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests = await mockCatalogue(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ほしいものリスト (500件)', exact: true })).toBeVisible();
    await expect(page.getByText('ページ商品0050', { exact: true })).toBeVisible();
    await expect(page.getByText('ページ商品0051', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ドラッグして並び替え' })).toHaveCount(0);

    await page.getByRole('button', { name: '選択', exact: true }).click();
    await page.getByRole('button', { name: '全選択', exact: true }).click();
    await expect(page.getByRole('heading', { name: '500件選択中', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await page.getByRole('button', { name: 'もっと見る', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('追加読み込みに失敗しました');
    await expect(page.getByText('ページ商品0001', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '追加読み込みを再試行', exact: true }).click();
    await expect(page.getByText('ページ商品0100', { exact: true })).toBeVisible();
    await expect(page.getByText('ページ商品0050', { exact: true })).toHaveCount(1);
    expect(requests.filter(url => url.searchParams.get('cursor') === '50')).toHaveLength(2);

    await page.getByRole('button', { name: /検索・フィルター/ }).click();
    const search = page.getByPlaceholder('商品名、メモ、カテゴリで検索...');
    await search.fill('ページ商品0500');
    await expect(page.getByRole('heading', { name: 'ほしいものリスト (1件)', exact: true })).toBeVisible();
    await expect(page.getByText('ページ商品0500', { exact: true })).toBeVisible();
    await expect(page.getByText('ページ商品0001', { exact: true })).toHaveCount(0);
    expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false);
    await search.fill('該当しない商品');
    await expect(page.getByText('条件に一致するアイテムがありません', { exact: true })).toBeVisible();
    await expect(page.getByText('まだアイテムがありません。上のフォームから追加してください。', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '条件をクリア', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ほしいものリスト (500件)', exact: true })).toBeVisible();

    // Existing filter markup has no label, so locate the select by its option.
    await page.locator('select').filter({ has: page.locator('option[value="price_desc"]') }).selectOption('price_desc');
    await expect(page.getByText('ページ商品0500', { exact: true })).toBeVisible();
    await expect(page.getByText('ページ商品0001', { exact: true })).toHaveCount(0);
    expect(requests.at(-1)!.searchParams.get('sort')).toBe('price_desc');
    expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false);
    await testInfo.attach(`pagination-${viewport.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
