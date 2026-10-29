import type { Page } from '@playwright/test';

export const UI_TIME = '2026-10-29T00:00:00.000Z';

export async function prepareHomeUi(page: Page, theme: 'light' | 'dark') {
  await page.clock.install({ time: new Date(UI_TIME) });
  await page.addInitScript(value => localStorage.setItem('theme', value), theme);
  const common = {
    url: 'https://example.test/item', image_url: null, original_price: null, previous_price: null,
    source: 'other', source_name: 'テスト店', priority: 3, planned_purchase_date: null,
    comparison_group_id: null, category_id: null, category_name: null, category_color: null,
    notes: '固定のUI検証データ', quantity: 1, is_purchased: false, purchased_at: null,
    target_price: null, target_currency: null, deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  };
  const items = [
    { ...common, id: 1, name: '検証用ケトル', current_price: 5200 },
    { ...common, id: 2, name: '検証用ヘッドホン', current_price: 18400 },
    { ...common, id: 3, name: '検証用カメラ', current_price: 128000, priority: 2 },
  ];
  // This suite checks presentation only. Real auth/persistence stays in the existing guest/capture suites.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/auth/session': {}, '/api/auth/providers': {},
      '/api/auth/me': { user: { id: 1, account_type: 'member', email: 'ui@example.test', name: 'テスト利用者' } },
      '/api/auth/guest': { enabled: true, ttlHours: 24 },
      '/api/items': items, '/api/categories': [], '/api/comparison-groups': [], '/api/purchased': [],
      '/api/capture': { enabled: true },
    };
    if (route.request().method() === 'GET' && path in responses) {
      await route.fulfill({ status: 200, json: responses[path] });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Unexpected UI fixture request' } });
    }
  });
  await page.route(/^https?:\/\/(?!localhost:3107(?:\/|$)|127\.0\.0\.1:3107(?:\/|$))/, route => route.abort());
}
