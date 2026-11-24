import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

test.beforeEach(async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-11-23T03:00:00Z'));
});

async function prepare(page: Page) {
  const member = await page.request.post('/api/auth/register', {
    data: { email: `desktop-${crypto.randomUUID()}@example.test`, password: 'test-password' },
  });
  expect(member.ok()).toBeTruthy();
  for (const [index, name] of ['読書灯', '折りたたみ傘', '小さなカメラ'].entries()) {
    const item = await page.request.post('/api/items', { headers: { Origin: 'http://localhost:3107' },
      data: { manual: true, name, price: (index + 1) * 1000, priority: 3,
        planned_purchase_date: index ? '2027-02-10' : '2027-01-10', image_url: '/demo/wishlist.svg' },
    });
    expect(item.ok()).toBeTruthy();
  }
  await page.goto('/design?pc=workspace');
  await expect(page.getByRole('heading', { name: 'ほしいものリスト', exact: true })).toBeVisible({ timeout: 20_000 });
}

for (const width of [1280, 1920]) {
  test(`reading menus keep a single content column at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1100 });
    await prepare(page);
    await page.getByRole('button', { name: '縦リスト', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
    const original = await nav.elementHandle();
    for (const [index, name] of ['出費予定', '購入履歴', '統計', 'ゴミ箱', '設定'].entries()) {
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
      const content = name === '出費予定' ? page.locator('.spend-view') : page.locator('.desktop-page-content main');
      await expect(content).toBeVisible();
      expect((await content.boundingBox())!.width).toBeLessThanOrEqual(721);
      expect(await original!.evaluate(node => node.isConnected)).toBeTruthy();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await page.screenshot({ path: info.outputPath(`reading-menu-${index}-${width}.png`) });
    }
    const account = await page.getByRole('heading', { name: 'アカウント情報', exact: true }).boundingBox();
    const password = await page.getByRole('button', { name: 'パスワード変更', exact: true }).boundingBox();
    const palette = await page.getByRole('button', { name: '配色を変更', exact: true }).boundingBox();
    expect(password!.y).toBeGreaterThan(account!.y);
    expect(palette!.y).toBeGreaterThan(password!.y);
    await page.getByRole('button', { name: '配色を変更', exact: true }).click();
    await expect(page.getByRole('group', { name: '配色', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'PC専用', exact: true }).click();
    expect((await page.locator('.desktop-page-content main').boundingBox())!.width).toBeGreaterThan(1000);
    await expect(page.getByRole('group', { name: '配色', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '縦リスト', exact: true }).click();
    await nav.getByRole('link', { name: '出費予定', exact: true }).click();
    await page.getByRole('button', { name: '絞り込み・並べ替え', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ほしいものリスト', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '並び順', exact: true })).toBeVisible();
    await expect(page).toHaveURL(url => !url.searchParams.has('tab'));
  });
}

test('reading list integrates filters, shelf and bulk actions without leaving the list', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  const category = await page.request.post('/api/categories', { headers: { Origin: 'http://localhost:3107' }, data: { name: '部屋のもの', color: '#775544' } });
  expect(category.ok()).toBeTruthy();
  const savedCategory = await category.json();
  const items = await (await page.request.get('/api/items')).json();
  await page.reload();
  await page.getByRole('button', { name: '縦リスト', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await expect(nav.getByRole('link', { name: 'リストの管理', exact: true })).toHaveCount(0);
  const url = page.url();
  await page.getByRole('button', { name: '絞り込み・並べ替え', exact: true }).click();
  await page.getByRole('combobox', { name: '並び順', exact: true }).selectOption('price_desc');
  await expect(page.locator('.rank-product strong')).toHaveText(['小さなカメラ', '折りたたみ傘', '読書灯']);
  await page.getByRole('combobox', { name: '並び順', exact: true }).selectOption('priority');
  await page.getByRole('button', { name: '絞り込み・並べ替え', exact: true }).click();
  await page.getByRole('button', { name: '選択', exact: true }).click();
  await page.getByRole('checkbox', { name: '読書灯を選択', exact: true }).check();
  await page.getByRole('combobox', { name: 'カテゴリ変更', exact: true }).selectOption(String(savedCategory.id));
  await expect(page.getByText('1件選択中', { exact: true })).toHaveCount(0);
  const updated = await (await page.request.get('/api/items')).json();
  expect(updated.find((item: {name:string}) => item.name === '読書灯').category_id).toBe(savedCategory.id);
  expect(updated.find((item: {name:string}) => item.name === '折りたたみ傘').category_id).toBeNull();
  await page.getByRole('button', { name: '選択を終了', exact: true }).click();
  await page.getByRole('button', { name: '絞り込み・並べ替え', exact: true }).click();
  await page.getByRole('button', { name: '部屋のもの', exact: true }).click();
  await expect(page.locator('.rank-product strong')).toHaveText(['読書灯']);
  await page.getByRole('button', { name: '条件をクリア', exact: true }).click();
  await expect(page.locator('.rank-product strong')).toHaveCount(3);
  await page.getByRole('button', { name: '写真棚', exact: true }).click();
  await expect(page.locator('.agenda-product-grid')).toBeVisible();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(page.locator('.rank-product strong')).toHaveCount(3);
  await page.getByRole('button', { name: 'リストの操作', exact: true }).click();
  await page.getByRole('button', { name: 'インポート', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'リストをインポート', exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  expect((await (await page.request.get('/api/items')).json()).length).toBe(items.length);
  await page.screenshot({ path: info.outputPath('integrated-list-import.png') });
});

test('reading comparison preserves a registration draft opened from the previous management route', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await prepare(page);
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await nav.getByRole('link', { name: 'リストの管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'リストの管理', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: '登録', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
  await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
  await sheet.getByRole('textbox', { name: '商品名', exact: true }).fill('比較中の登録');
  await sheet.getByRole('button', { name: '縦リスト', exact: true }).click();
  await expect(sheet.getByRole('textbox', { name: '商品名', exact: true })).toHaveValue('比較中の登録');
  await expect(sheet.getByRole('button', { name: '登録する', exact: true })).toBeInViewport();
});

test('integrated select-all respects the priority display and price refresh stays in the list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  const items = await (await page.request.get('/api/items')).json();
  const lamp = items.find((item: {name:string}) => item.name === '読書灯');
  await page.request.patch(`/api/items/${lamp.id}`, { headers: { Origin: 'http://localhost:3107' }, data: { priority: 2 } });
  await page.reload();
  await page.getByRole('button', { name: '縦リスト', exact: true }).click();
  await page.getByRole('button', { name: 'リストの表示: すべて', exact: true }).click();
  await page.getByRole('button', { name: '優先度 高のみ', exact: false }).click();
  await expect(page.locator('.rank-product strong')).toHaveText(['読書灯']);
  await page.getByRole('button', { name: '選択', exact: true }).click();
  await page.getByRole('button', { name: '全選択', exact: true }).click();
  await expect(page.getByRole('region', { name: '選択した商品の操作' })).toContainText('1件選択中');
  await expect(page.getByRole('checkbox', { name: '読書灯を選択', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '選択を終了', exact: true }).click();
  const requests: string[] = [];
  await page.route('**/api/items/*/refresh', route => { requests.push(route.request().url()); return route.fulfill({ json: { success: true } }); });
  await page.getByRole('button', { name: 'リストの操作', exact: true }).click();
  await page.getByRole('button', { name: '価格を更新', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.getByRole('heading', { name: 'ほしいものリスト', exact: true })).toBeVisible();
  await expect(page).toHaveURL(url => !url.searchParams.has('tab'));
  await page.getByRole('button', { name: '選択', exact: true }).click();
  await page.getByRole('checkbox', { name: '読書灯を選択', exact: true }).check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('region', { name: '選択した商品の操作' }).getByRole('button', { name: '購入済み', exact: true }).click();
  await expect(page.getByRole('region', { name: '選択した商品の操作' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'PCナビゲーション' }).getByRole('link', { name: '出費予定', exact: true }).click();
  await expect(page.getByTestId('spend-selected-total')).toHaveText('¥5,000');
  await expect(page.getByRole('button', { name: '読書灯の詳細', exact: true })).toHaveCount(0);
});

test('photo group bulk selection changes only the shops matching the search', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  const origin = { Origin: 'http://localhost:3107' };
  const group = await (await page.request.post('/api/comparison-groups', { headers: origin, data: { name: '机の照明' } })).json();
  const category = await (await page.request.post('/api/categories', { headers: origin, data: { name: '一括変更の確認', color: '#775544' } })).json();
  const items = await (await page.request.get('/api/items')).json();
  const face = items.find((item: {name:string}) => item.name === '読書灯');
  const match = items.find((item: {name:string}) => item.name === '折りたたみ傘');
  for (const item of [face, match]) {
    expect((await page.request.patch(`/api/items/${item.id}`, { headers: origin, data: { comparison_group_id: group.id } })).ok()).toBeTruthy();
  }
  const db = new Database(process.env.E2E_DB_PATH!);
  db.prepare("UPDATE comparison_groups SET origin = 'photo' WHERE id = ?").run(group.id);
  db.close();
  await page.reload();
  await page.getByRole('button', { name: '縦リスト', exact: true }).click();
  await page.getByRole('searchbox', { name: '商品名・メモ・お店で検索' }).fill('折りたたみ傘');
  await expect(page.locator('.rank-product strong')).toHaveText(['机の照明']);
  await page.getByRole('button', { name: '選択', exact: true }).click();
  await page.getByRole('checkbox', { name: '机の照明を選択', exact: true }).check();
  await page.getByRole('combobox', { name: 'カテゴリ変更', exact: true }).selectOption(String(category.id));
  await expect(page.getByRole('region', { name: '選択した商品の操作' })).toHaveCount(0);
  const updated = await (await page.request.get('/api/items')).json();
  expect(updated.find((item: {id:number}) => item.id === match.id).category_id).toBe(category.id);
  expect(updated.find((item: {id:number}) => item.id === face.id).category_id).toBeNull();
  await page.getByRole('button', { name: '全選択', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '机の照明を選択', exact: true })).toBeChecked();
  await expect(page.getByRole('region', { name: '選択した商品の操作' })).toContainText('1件選択中');
});

test('a shelf edit survives desktop comparisons and resizing before saving', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  const items = await (await page.request.get('/api/items')).json();
  const db = new Database(process.env.E2E_DB_PATH!);
  db.prepare('UPDATE items SET source_name = ? WHERE id = ?').run('お気に入りのお店', items[0].id);
  db.close();
  await page.reload();
  await page.getByRole('button', { name: '縦リスト', exact: true }).click();
  await page.getByRole('searchbox', { name: '商品名・メモ・お店で検索' }).fill('お気に入りのお店');
  await page.getByRole('button', { name: '写真棚', exact: true }).click();
  const shelf = page.locator('.agenda-product-grid');
  await shelf.getByRole('button', { name: '編集', exact: true }).first().click();
  const name = shelf.getByPlaceholder('商品名', { exact: true });
  await name.fill('編集を続ける読書灯');
  await page.getByRole('button', { name: 'PC専用', exact: true }).click();
  await page.getByRole('button', { name: '縦リスト', exact: true }).click();
  await expect(shelf).toBeVisible();
  await expect(name).toHaveValue('編集を続ける読書灯');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(name).toHaveValue('編集を続ける読書灯');
  await shelf.getByRole('button', { name: '保存', exact: true }).click();
  await expect(shelf.getByRole('heading', { name: '編集を続ける読書灯', exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/items')).json();
  expect(saved.some((item: {name:string}) => item.name === '編集を続ける読書灯')).toBeTruthy();
});

test('all desktop menus share the same sidebar, including settings', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await expect(nav).toBeVisible();
  const original = await nav.elementHandle();
  for (const [index, name] of ['コーヒーカップ', '週末用のバッグ', '古い購入候補'].entries()) {
    const response = await page.request.post('/api/items', { headers: { Origin: 'http://localhost:3107' },
      data: { manual: true, name, price: (index + 1) * 3500, image_url: '/demo/wishlist.svg' } });
    const saved = await response.json();
    expect(response.ok()).toBeTruthy();
    const changed = index === 2 ? await page.request.delete(`/api/items/${saved.id}`, { headers: { Origin: 'http://localhost:3107' } })
      : await page.request.patch(`/api/items/${saved.id}`, { headers: { Origin: 'http://localhost:3107' }, data: { is_purchased: true, purchased_at: '2026-11-01' } });
    expect(changed.ok()).toBeTruthy();
  }
  const menus = ['リストの管理', '購入履歴', '統計', 'ゴミ箱', '設定', 'ほしいものリスト'];
  for (const name of menus) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    expect(await original!.evaluate(node => node.isConnected)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    if (name !== 'ほしいものリスト') {
      await expect(page.getByText('読み込み中...', { exact: true })).toHaveCount(0);
      const content = await page.locator('.desktop-page-content').boundingBox();
      expect(content!.width).toBeGreaterThan(1200);
      await page.screenshot({ path: info.outputPath(`menu-${menus.indexOf(name)}.png`) });
    }
    await page.getByRole('button', { name: '今のPC表示', exact: true }).click();
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'PC専用', exact: true }).click();
    await expect(nav).toBeVisible();
  }
});

test('URL registration from trash refreshes the restored item in the current page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  const url = 'https://example.com/discontinued';
  const saved = await page.request.post('/api/items', { headers: { Origin: 'http://localhost:3107' },
    data: { manual: true, name: '復元する購入候補', price: 1800, url } });
  expect(saved.ok()).toBeTruthy();
  const item = await saved.json();
  expect((await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: 'http://localhost:3107' } })).ok()).toBeTruthy();
  await page.route('**/api/items/preview', route => route.fulfill({ status: 422, json: { error: '商品情報を取得できませんでした' } }));
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await nav.getByRole('link', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.getByRole('heading', { name: '復元する購入候補', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: '登録', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
  await sheet.getByRole('textbox', { name: '商品URL', exact: true }).fill(url);
  await sheet.getByRole('button', { name: '商品情報を取得', exact: true }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await sheet.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('ゴミ箱は空です', { exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'ゴミ箱', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('secondary pages keep registration drafts and settings controls during comparisons', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await nav.getByRole('link', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '配色を変更', exact: true }).click();
  await expect(page.getByRole('group', { name: '配色', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: '登録', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
  await expect(sheet.getByRole('tab', { name: 'URL', exact: true })).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
  await sheet.getByRole('textbox', { name: '商品名', exact: true }).fill('設定から登録した本');
  await sheet.getByRole('button', { name: '今のPC表示', exact: true }).click();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(sheet.getByRole('button', { name: '登録する', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sheet.getByRole('button', { name: '登録する', exact: true })).toBeInViewport();
  const mobileSheet = await sheet.boundingBox();
  expect(mobileSheet!.x).toBeGreaterThanOrEqual(0);
  expect(mobileSheet!.x + mobileSheet!.width).toBeLessThanOrEqual(391);
  await page.setViewportSize({ width: 1280, height: 900 });
  await sheet.getByRole('button', { name: 'PC専用', exact: true }).click();
  await expect(sheet.getByRole('textbox', { name: '商品名', exact: true })).toHaveValue('設定から登録した本');
  await sheet.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('group', { name: '配色', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'ほしいものリスト', exact: true }).click();
  await expect(page.getByRole('button', { name: '設定から登録した本の詳細', exact: true })).toBeVisible();
  for (const name of ['購入履歴', '統計', 'ゴミ箱', '設定']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await nav.getByRole('link', { name, exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(nav).toBeHidden();
    await expect(page.getByRole('group', { name: 'PCの表示を比較' })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  }
});

test('registering from statistics refreshes the visible totals without leaving the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await nav.getByRole('link', { name: '統計', exact: true }).click();
  const overview = page.locator('.agenda-stats-overview');
  await expect(overview.getByText('¥6,000', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: '登録', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
  await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
  await sheet.getByRole('textbox', { name: '商品名', exact: true }).fill('集計に反映する本');
  await sheet.getByRole('spinbutton', { name: '価格', exact: true }).fill('2000');
  await sheet.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(overview.getByText('¥8,000', { exact: true })).toBeVisible();
  await expect(overview.getByText('4件', { exact: true })).toBeVisible();
});

test('a delayed statistics response cannot replace the totals after registration', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  let releaseOld = () => {};
  let capturedOld = () => {};
  const delayed = new Promise<void>(resolve => { releaseOld = resolve; });
  const captured = new Promise<void>(resolve => { capturedOld = resolve; });
  let first = true;
  await page.route('**/api/stats', async route => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    const json = await response.json();
    capturedOld();
    await delayed;
    await route.fulfill({ response, json });
  });
  const nav = page.getByRole('navigation', { name: 'PCナビゲーション' });
  await nav.getByRole('link', { name: '統計', exact: true }).click();
  await captured;
  await nav.getByRole('button', { name: '登録', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
  await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
  await sheet.getByRole('textbox', { name: '商品名', exact: true }).fill('遅延中に登録する本');
  await sheet.getByRole('spinbutton', { name: '価格', exact: true }).fill('2000');
  await sheet.getByRole('button', { name: '登録する', exact: true }).click();
  const overview = page.locator('.agenda-stats-overview');
  await expect(overview.getByText('¥8,000', { exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse('**/api/stats');
  releaseOld();
  await (await oldResponse).finished();
  await expect(overview.getByText('¥8,000', { exact: true })).toBeVisible();
  await expect(overview.getByText('3件', { exact: true })).toHaveCount(0);
});

for (const width of [1100, 1440]) {
  test(`reading rows center images and stabilize dates with optional conditions at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1100 });
    await prepare(page);
    const items = await (await page.request.get('/api/items')).json();
    for (const [name, date, month, condition] of [
      ['読書灯', '2026-12-10', '2026-12', ''],
      ['折りたたみ傘', '2027-12-10', '2027-12', 'セールになったら買う'],
      ['小さなカメラ', null, '', ''],
    ]) {
      const item = items.find((entry: {name:string}) => entry.name === name);
      expect((await page.request.patch(`/api/items/${item.id}`, { headers: { Origin: 'http://localhost:3107' }, data: { planned_purchase_date: date } })).ok()).toBeTruthy();
      expect((await page.request.post('/api/items/ranking', { headers: { Origin: 'http://localhost:3107' }, data: { action: 'guide', itemId: item.id, priority: 3, month, timing: 'by', condition } })).ok()).toBeTruthy();
    }
    const longName = '持ち運びやすさと画質をお店で比べてから選ぶ、旅行用ミラーレスカメラと交換レンズのセット。'.repeat(2);
    const longCondition = 'お店で重さと持ちやすさを確認し、今の機材を下取りしたあとの金額と保証の範囲を比べてから買う。'.repeat(3);
    const added = await page.request.post('/api/items', { headers: { Origin: 'http://localhost:3107' }, data: { manual: true, name: longName, price: 128000, priority: 3, planned_purchase_date: '2027-12-10', image_url: '/demo/wishlist.svg' } });
    expect(added.ok()).toBeTruthy();
    const longItem = await added.json();
    expect((await page.request.post('/api/items/ranking', { headers: { Origin: 'http://localhost:3107' }, data: { action: 'guide', itemId: longItem.id, priority: 3, month: '2027-12', timing: 'by', condition: longCondition } })).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: '縦リスト', exact: true }).click();
    const rows = page.locator('.rank-row');
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      const bounds = (await row.boundingBox())!;
      const picture = (await row.locator('.rank-picture').boundingBox())!;
      const handle = (await row.locator('.rank-grip').boundingBox())!;
      const center = bounds.y + (bounds.height - 1) / 2;
      expect(Math.abs(picture.y + picture.height / 2 - center)).toBeLessThan(1);
      expect(Math.abs(handle.y + handle.height / 2 - center)).toBeLessThan(1);
      expect(picture.width).toBe(96);
    }
    const first = rows.filter({ has: page.getByRole('button', { name: '読書灯の詳細', exact: true }) });
    const second = rows.filter({ has: page.getByRole('button', { name: '折りたたみ傘の詳細', exact: true }) });
    for (const selector of ['.rank-product', '.rank-meta', '.focused-date']) {
      const firstTop = (await first.locator(selector).boundingBox())!.y - (await first.boundingBox())!.y;
      const secondTop = (await second.locator(selector).boundingBox())!.y - (await second.boundingBox())!.y;
      expect(Math.abs(firstTop - secondTop)).toBeLessThan(1);
    }
    await expect(first.locator('.focused-date')).toHaveText('2026年12月10日');
    await expect(second.locator('.focused-date')).toHaveText('2027年12月10日');
    await expect(first.locator('.rank-month')).toHaveText('2026年12月まで');
    const dateBoxes = await rows.locator('.focused-date-text').evaluateAll(elements => elements.map(element => ({ height: element.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(element).lineHeight) })));
    for (const box of dateBoxes) expect(box.height).toBeLessThanOrEqual(box.lineHeight + 1);
    await expect(rows.filter({ has: page.getByRole('button', { name: '小さなカメラの詳細', exact: true }) }).locator('.focused-date')).toHaveCount(0);
    const longRow = rows.filter({ has: page.getByRole('button', { name: longName + 'の詳細', exact: true }) });
    const clippedName = await longRow.locator('.rank-product strong').evaluate(element => ({ height: element.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(element).lineHeight), fullText: element.textContent }));
    expect(clippedName.height).toBeLessThanOrEqual(clippedName.lineHeight * 2 + 1);
    expect(clippedName.fullText).toBe(longName);
    const clipped = await longRow.locator('.focused-condition > span').evaluate(element => ({ height: element.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(element).lineHeight), fullText: element.textContent }));
    expect(clipped.height).toBeLessThanOrEqual(clipped.lineHeight * 2 + 1);
    expect(clipped.fullText).toBe(longCondition);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`aligned-rows-${width}.png`) });
    await longRow.getByRole('button', { name: longName + 'の詳細', exact: true }).click();
    await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible();
    await longRow.getByRole('button', { name: longName + 'の買う条件を編集', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /どんなときに買う/ })).toHaveValue(longCondition);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });
}

for (const width of [1280, 1440, 1920]) {
  test(`reading layout groups product information and uses the full height at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1200 });
    await prepare(page);
    await page.getByRole('button', { name: '縦リスト', exact: true }).click();
    const sidebar = page.getByRole('navigation', { name: 'PCナビゲーション' });
    await expect(sidebar).toBeVisible();
    const frame = await page.locator('.review-frame').boundingBox();
    expect(frame!.height).toBeGreaterThan(1180);
    const list = await page.locator('.focused-list').boundingBox();
    expect(list!.width).toBeLessThanOrEqual(681);
    expect(list!.x).toBeGreaterThan(208);
    const product = page.getByRole('button', { name: '読書灯の詳細', exact: true });
    const name = await product.locator('strong').boundingBox();
    const price = await product.locator('.rank-price').boundingBox();
    expect(Math.abs(name!.x - price!.x)).toBeLessThan(2);
    expect(price!.y).toBeGreaterThanOrEqual(name!.y + name!.height);
    const guide = await page.getByRole('button', { name: '読書灯の優先度・買いどきを編集', exact: true }).boundingBox();
    expect(Math.abs(name!.x - guide!.x)).toBeLessThan(2);
    const picture = await page.getByRole('button', { name: '読書灯の写真を拡大', exact: true }).boundingBox();
    expect(picture!.width).toBe(96);
    expect(picture!.height).toBe(96);
    const handle = page.getByRole('button', { name: /読書灯を同じ優先度内で並べ替え/ });
    const grip = await handle.boundingBox();
    expect(grip!.width).toBeGreaterThanOrEqual(44);
    expect(grip!.height).toBeGreaterThanOrEqual(44);
    expect(grip!.x + grip!.width).toBeLessThanOrEqual(picture!.x);
    expect(grip!.y).toBeGreaterThanOrEqual(picture!.y);
    expect(grip!.y + grip!.height).toBeLessThanOrEqual(picture!.y + picture!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`reading-${width}.png`) });
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(page.locator('.rank-product strong')).toHaveText(['折りたたみ傘', '読書灯', '小さなカメラ']);
    await page.getByRole('button', { name: '読書灯の写真を拡大', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: '読書灯の写真を拡大', exact: true })).toBeFocused();
    const search = page.getByRole('searchbox', { name: '商品名・メモ・お店で検索' });
    await search.fill('読書灯');
    await page.getByRole('button', { name: 'PC専用', exact: true }).click();
    await expect(search).toHaveValue('読書灯');
    await page.getByRole('button', { name: '縦リスト', exact: true }).click();
    await expect(search).toHaveValue('読書灯');
    await sidebar.getByRole('link', { name: '設定', exact: true }).click();
    await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
    await sidebar.getByRole('link', { name: 'ほしいものリスト', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ほしいものリスト', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '縦リスト', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ほしいものリスト', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '縦リスト', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(sidebar).toBeHidden();
    expect((await page.getByRole('button', { name: '読書灯の写真を拡大', exact: true }).boundingBox())!.width).toBe(64);
    await expect(page.getByRole('navigation', { name: '主な操作' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });

  test(`desktop preview uses the window and keeps data when comparing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await prepare(page);
    const data = await (await page.request.get('/api/items')).json();
    const main = page.getByRole('main');
    const sidebar = page.getByRole('navigation', { name: 'PCナビゲーション' });
    await expect(sidebar).toBeVisible();
    await expect(main).toHaveAttribute('data-desktop-layout', 'workspace');
    const frame = await page.locator('.review-frame').boundingBox();
    expect(frame!.y).toBeLessThan(4);
    expect(frame!.height).toBeGreaterThan(980);
    expect(frame!.x + frame!.width).toBeGreaterThan(width - 4);
    await expect(page.getByRole('searchbox', { name: '商品名・メモ・お店で検索' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`desktop-${width}.png`) });
    await page.getByRole('button', { name: '今のPC表示', exact: true }).click();
    await expect(sidebar).toBeHidden();
    await expect(main).toHaveAttribute('data-desktop-layout', 'current');
    expect((await page.locator('.review-frame').boundingBox())!.width).toBeLessThanOrEqual(1161);
    await page.getByRole('button', { name: 'PC専用', exact: true }).click();
    await expect(sidebar).toBeVisible();
    expect(await (await page.request.get('/api/items')).json()).toEqual(data);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });
}

test('registration draft, budget selection and old/new UI survive desktop comparisons', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await page.getByRole('navigation', { name: 'PCナビゲーション' }).getByRole('button', { name: '登録', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
  await expect(sheet).not.toHaveAttribute('aria-modal', 'true');
  const list = page.getByRole('region', { name: '買う候補', exact: true });
  expect((await list.boundingBox())!.x + (await list.boundingBox())!.width).toBeLessThanOrEqual((await sheet.boundingBox())!.x + 2);
  await expect(sheet.getByRole('tab', { name: 'URL', exact: true })).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('textbox', { name: '商品URL', exact: true }).fill('https://example.test/preview');
  await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
  await sheet.getByRole('textbox', { name: '商品名', exact: true }).fill('PCで登録する本');
  await sheet.getByRole('spinbutton', { name: '価格', exact: true }).fill('3500');
  await sheet.getByRole('button', { name: '縦リスト', exact: true }).click();
  await expect(sheet.getByRole('textbox', { name: '商品名', exact: true })).toHaveValue('PCで登録する本');
  await expect(sheet.getByRole('button', { name: '登録する', exact: true })).toBeInViewport();
  await sheet.getByRole('button', { name: '今のPC表示', exact: true }).click();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(sheet.getByRole('textbox', { name: '商品名', exact: true })).toHaveValue('PCで登録する本');
  await sheet.getByRole('button', { name: 'PC専用', exact: true }).click();
  await sheet.getByRole('tab', { name: 'URL', exact: true }).click();
  await expect(sheet.getByRole('textbox', { name: '商品URL', exact: true })).toHaveValue('https://example.test/preview');
  await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
  await expect(sheet.getByRole('button', { name: '登録する', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('desktop-registration.png') });
  await sheet.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PCで登録する本の詳細', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'PCナビゲーション' }).getByRole('link', { name: '出費予定', exact: true }).click();
  const total = page.getByTestId('spend-selected-total');
  await expect(total).toHaveText('¥9,500');
  await page.getByRole('checkbox', { name: '表示中の商品を全選択' }).click();
  await page.getByRole('checkbox', { name: '2027年1月の商品を全選択' }).click();
  await expect(total).toHaveText('¥1,000');
  await page.getByRole('button', { name: '今のPC表示', exact: true }).click();
  await expect(total).toHaveText('¥1,000');
  await page.getByRole('button', { name: 'PC専用', exact: true }).click();
  await expect(total).toHaveText('¥1,000');
  await page.screenshot({ path: info.outputPath('desktop-budget.png') });
  await page.getByRole('switch', { name: '新しい表示を使う' }).click();
  await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('tab') === 'budget');
  await page.getByRole('switch', { name: '新しい表示を使う' }).click();
  await expect(page.getByRole('navigation', { name: 'PCナビゲーション' })).toBeVisible();
  await expect(total).toBeVisible();
});

test('desktop side editor follows the selected product and keeps same-priority ordering', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await prepare(page);
  const rows = await (await page.request.get('/api/items')).json();
  const first = rows.find((row:{name:string})=>row.name==='読書灯');
  const second = rows.find((row:{name:string})=>row.name==='折りたたみ傘');
  for (const [itemId,month,condition] of [[first.id,'2027-01','実物を見てから'],[second.id,'2027-02','値下がりしたら']]) {
    const saved=await page.request.post('/api/items/ranking',{headers:{Origin:'http://localhost:3107'},data:{action:'guide',itemId,priority:3,month,timing:'by',condition}});
    expect(saved.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('button',{name:'読書灯の優先度・買いどきを編集',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'優先度と買いどき',exact:true});
  await expect(editor.getByRole('textbox',{name:/どんなときに買う/})).toHaveValue('実物を見てから');
  await page.getByRole('button',{name:'折りたたみ傘の優先度・買いどきを編集',exact:true}).click();
  await expect(editor.getByRole('textbox',{name:/どんなときに買う/})).toHaveValue('値下がりしたら');
  await expect(editor.getByRole('combobox',{name:'目安の月'})).toHaveValue('02');
  await editor.getByRole('textbox',{name:/どんなときに買う/}).fill('値下がりを確認してから');
  let releaseSave!:()=>void;
  const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;});
  await page.route('**/api/items/ranking',async route=>{await saveGate;await route.continue();});
  await editor.getByRole('button',{name:'保存',exact:true}).click();
  await expect(editor.getByRole('button',{name:'優先度と買いどきを閉じる'})).toBeDisabled();
  releaseSave();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button',{name:'折りたたみ傘の優先度・買いどきを編集',exact:true})).toBeFocused();
  const updatedGuides=await (await page.request.get('/api/items?with=buy-guide')).json();
  expect(updatedGuides.find((row:{id:number})=>row.id===first.id).buy_guide.condition).toBe('実物を見てから');
  expect(updatedGuides.find((row:{id:number})=>row.id===second.id).buy_guide.condition).toBe('値下がりを確認してから');
  await page.getByRole('button',{name:/折りたたみ傘を同じ優先度内で並べ替え/}).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(async()=>{
    const updated=await (await page.request.get('/api/items')).json();
    return updated.find((row:{id:number})=>row.id===second.id).sort_order < updated.find((row:{id:number})=>row.id===first.id).sort_order;
  }).toBeTruthy();
  await page.getByRole('button',{name:'折りたたみ傘の写真を拡大',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'折りたたみ傘の写真',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
});

for (const width of [320, 390]) {
  test(`desktop preference leaves mobile layout and registration unchanged at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await prepare(page);
    await expect(page.getByRole('navigation', { name: 'PCナビゲーション' })).toBeHidden();
    await expect(page.getByRole('group', { name: 'PCの表示を比較' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: '主な操作' })).toBeVisible();
    expect((await page.locator('.review-frame').boundingBox())!.width).toBeCloseTo(width, 0);
    await page.getByRole('button', { name: '登録', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'ほしいものを登録', exact: true });
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(sheet.getByRole('group', { name: 'PCの表示を比較' })).toBeHidden();
    await expect(sheet.getByRole('tab', { name: 'URL', exact: true })).toHaveAttribute('aria-selected', 'true');
    await sheet.getByRole('tab', { name: '手入力', exact: true }).click();
    await expect(sheet.getByRole('button', { name: '登録する', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`mobile-${width}.png`) });
  });
}
