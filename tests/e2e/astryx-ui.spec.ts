import { switchUiVersion } from './helpers/ui-version';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const origin = 'http://localhost:3107';
async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: {email: `astryx-${crypto.randomUUID()}@example.test`, password: 'test-password'},
  });
  expect(response.ok()).toBeTruthy();
}
async function item(page: Page, name: string, fields: Record<string, unknown> = {}) {
  const response = await page.request.post('/api/items', {
    headers: {Origin: origin}, data: {manual: true, name, price: 1200, priority: 3, ...fields},
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function newHome(page: Page) {
  await page.goto('/design');
  await expect(page.getByRole('heading', {name: 'ほしいものリスト', exact: true})).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/agenda/);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
}

for (const width of [320, 390, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`display picker names both interfaces and preserves navigation at ${width}px in ${theme}`, async ({page}, info) => {
      await page.setViewportSize({width, height: 844});
      if (width === 390 && theme === 'dark') await page.emulateMedia({reducedMotion: 'reduce'});
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await member(page);
      await item(page, '切替を確認する本', {planned_purchase_date: '2027-02-03'});
      await newHome(page);
      const trigger = page.getByRole('button', {name: '画面の表示切替', exact: true});
      await expect(trigger).toContainText('表示切替');
      const bounds = await trigger.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await fits(page);

      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', {name: '画面デザイン', exact: true});
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitemradio', {name: '新しい表示', exact: true})).toHaveAttribute('aria-checked', 'true');
      await expect(menu.getByRole('menuitemradio', {name: '従来の表示', exact: true})).toHaveAttribute('aria-checked', 'false');
      await expect(menu.getByRole('menuitemradio', {name: '新しい表示', exact: true})).toBeFocused();
      const menuBounds = await menu.boundingBox();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({path: info.outputPath(`display-picker-${width}-${theme}.png`)});
      await page.keyboard.press('Escape');
      await expect(menu).not.toBeVisible();
      await expect(trigger).toBeFocused();

      await trigger.click();
      await menu.getByRole('menuitemradio', {name: '新しい表示', exact: true}).click();
      await expect(menu).not.toBeVisible();
      await expect(page).toHaveURL(/\/design$/);
      await trigger.click();
      // On a narrow screen the menu overlaps the heading; use empty page space below it.
      await page.mouse.click(8, 360);
      await expect(menu).not.toBeVisible();

      await page.getByRole('link', {name: '出費予定', exact: true}).click();
      await switchUiVersion(page);
      await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('tab') === 'budget');
      await expect(page.locator('html')).not.toHaveAttribute('data-astryx-theme');
      await fits(page);
      await trigger.click();
      await expect(menu.getByRole('menuitemradio', {name: '従来の表示', exact: true})).toHaveAttribute('aria-checked', 'true');
      await page.screenshot({path: info.outputPath(`display-picker-legacy-${width}-${theme}.png`)});
      await menu.getByRole('menuitemradio', {name: '新しい表示', exact: true}).click();
      await expect(page).toHaveURL(url => url.pathname === '/design' && url.searchParams.get('tab') === 'budget');
      await expect(page.getByTestId('spend-selected-total')).toHaveText('¥1,200');
      await page.reload();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /agenda/);
      await expect(page.getByTestId('spend-selected-total')).toHaveText('¥1,200');
    });
  }
}

test('new UI preserves login and guest entry from an unauthenticated visit', async ({page}) => {
  await page.goto('/design');
  await page.getByRole('button', {name: 'ゲストで試す', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'ほしいものリスト', exact: true})).toBeVisible();
  await expect(page.getByRole('complementary', {name: 'ゲスト体験'})).toBeVisible();
  await switchUiVersion(page);
  await expect(page.getByRole('button', {name: '新しいアイテムを追加'})).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-astryx-theme');
});

test('invalid stored dates keep the new list and budget usable without rewriting saved values', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await member(page);
  const saved = await item(page, '以前の日付の商品', {planned_purchase_date: '2027-13-01'});
  await newHome(page);
  await expect(page.getByRole('button', {name: '以前の日付の商品の詳細'})).toBeVisible();
  await page.getByRole('link', {name: '出費予定', exact: true}).click();
  await expect(page.getByTestId('spend-selected-total')).toHaveText('¥1,200');
  await expect(page.getByRole('button', {name: '以前の日付の商品の詳細'})).toBeVisible();
  await expect(page.getByRole('button', {name: '以前の日付の商品の購入時期を変更'})).toContainText('決める');
  expect(errors).toEqual([]);
  const rows = await (await page.request.get('/api/items')).json();
  expect(rows.find((entry: {id: number}) => entry.id === saved.id).planned_purchase_date).toBe('2027-13-01');
  await switchUiVersion(page);
  await expect(page).toHaveURL(url => url.pathname === '/' && url.searchParams.get('tab') === 'budget');
  await expect(page.getByText('以前の日付の商品', {exact: true})).toBeVisible();
});

for (const width of [320, 390, 1440]) {
  test(`adopted list, registration, budget and legacy switch keep real data at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: width < 500 ? 844 : 1000});
    await member(page);
    await item(page, '折りたたみ傘', {planned_purchase_date: '2027-02-03', image_url: '/demo/wishlist.svg'});
    await item(page, '小さな読書灯', {price: 2800, planned_purchase_date: '2027-03-04'});
    await item(page, '未価格の商品', {price: null});
    await newHome(page);
    await expect(page.getByRole('button', {name: '折りたたみ傘の詳細'})).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('body')).toHaveCSS('font-family', /Zen Kaku Gothic New/);
    await fits(page);
    await page.screenshot({path: info.outputPath(`list-${width}.png`), fullPage: true});
    await page.getByRole('button', {name: '折りたたみ傘の写真を拡大'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: '登録', exact: true}).click();
    const sheet = page.getByRole('dialog', {name: 'ほしいものを登録'});
    await expect(sheet.getByRole('tab', {name: 'URL', exact: true})).toHaveAttribute('aria-selected', 'true');
    await sheet.getByRole('textbox', {name: '商品URL', exact: true}).fill('https://pitakajapan.com/products/magez-grip');
    await sheet.getByRole('tab', {name: '手入力'}).click();
    await sheet.getByRole('textbox', {name: '商品名', exact: true}).fill('シートから追加');
    await sheet.getByRole('spinbutton', {name: '価格', exact: true}).fill('3500');
    await sheet.getByRole('tab', {name: 'URL', exact: true}).click();
    await expect(sheet.getByRole('textbox', {name: '商品URL', exact: true})).toHaveValue('https://pitakajapan.com/products/magez-grip');
    await sheet.getByRole('tab', {name: '手入力'}).click();
    const save = sheet.getByRole('button', {name: '登録する', exact: true});
    await expect(save).toBeInViewport();
    await save.click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'シートから追加の詳細'})).toBeVisible();
    await expect(page).toHaveURL(/\/design$/);
    await page.getByRole('link', {name: '出費予定', exact: true}).click();
    await expect(page.getByTestId('spend-selected-total')).toHaveText('¥7,500');
    await expect(page.getByRole('button', {name: '試算する'})).toHaveCount(0);
    const all = page.getByRole('checkbox', {name: '表示中の商品を全選択'});
    await all.click();
    await expect(page.getByTestId('spend-selected-total')).toHaveText('¥0');
    await page.getByRole('checkbox', {name: '2027年2月の商品を全選択'}).click();
    await expect(all).toHaveAttribute('aria-checked', 'mixed');
    await expect(page.getByTestId('spend-selected-total')).toHaveText('¥1,200');
    await fits(page);
    await page.screenshot({path: info.outputPath(`budget-${width}.png`), fullPage: true});
    await switchUiVersion(page);
    await expect(page).toHaveURL(/\/\?tab=budget$/);
    await expect(page.locator('html')).not.toHaveClass(/agenda/);
    await switchUiVersion(page);
    await expect(page).toHaveURL(/\/design\?tab=budget$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/design$/);
    await expect(page.getByRole('button', {name: 'シートから追加の詳細'})).toBeVisible();
  });
}

test('priority and rough timing are independent, same-priority keyboard drag persists in both UIs', async ({page}) => {
  await member(page);
  const first = await item(page, '先頭の商品');
  const second = await item(page, '次の商品');
  await newHome(page);
  const handle = page.getByRole('button', {name: /次の商品を同じ優先度内で並べ替え/});
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(async () => {
    const rows = await (await page.request.get('/api/items')).json();
    return rows.find((x: {id: number}) => x.id === second.id).sort_order < rows.find((x: {id: number}) => x.id === first.id).sort_order;
  }).toBeTruthy();
  await page.getByRole('button', {name: '次の商品の優先度・購入時期を編集'}).click();
  const dialog = page.getByRole('dialog', {name: '優先度と購入時期'});
  await dialog.getByRole('radio', {name: '低', exact: true}).check();
  await dialog.getByRole('radio', {name: '月', exact: true}).check();
  await dialog.getByRole('textbox', {name: '購入する年'}).fill('2027');
  await dialog.getByRole('combobox', {name: '購入する月'}).selectOption('02');
  await dialog.getByRole('combobox', {name: '時期の表し方'}).selectOption('around');
  await dialog.getByRole('textbox', {name: /どんなときに買う/}).fill('値下がりしたら');
  await dialog.getByRole('button', {name: '保存', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const rows = await (await page.request.get('/api/items?with=buy-guide')).json();
  expect(rows.find((x: {id: number}) => x.id === second.id)).toMatchObject({priority: 4, planned_purchase_date: null, buy_guide: {month: '2027-02', timing: 'around', condition: '値下がりしたら'}});
  await switchUiVersion(page);
  await expect(page.getByRole('heading', {name: '次の商品', exact: true})).toBeVisible();
});

test('URL registration uses the existing fetch pipeline and photo registration saves an uploaded image in place', async ({page}) => {
  await member(page);
  await newHome(page);
  await page.getByRole('button', {name: '登録', exact: true}).click();
  const sheet = page.getByRole('dialog', {name: 'ほしいものを登録'});
  await sheet.getByRole('textbox', {name: '商品URL', exact: true}).fill('https://pitakajapan.com/products/magez-grip');
  await sheet.getByRole('button', {name: '商品情報を取得'}).click();
  await expect(sheet.getByText('MagEZ Grip 3', {exact: true})).toBeVisible();
  await sheet.getByRole('button', {name: '登録する', exact: true}).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'MagEZ Grip 3の詳細'})).toBeVisible();
  await page.getByRole('button', {name: '登録', exact: true}).click();
  await sheet.getByRole('tab', {name: '写真', exact: true}).click();
  const buffer = await sharp({create: {width: 24, height: 24, channels: 3, background: '#654321'}}).png().toBuffer();
  await sheet.getByLabel('登録する画像ファイル').setInputFiles({name: 'lamp.png', mimeType: 'image/png', buffer});
  await expect(sheet.getByRole('img', {name: '選択した写真'})).toBeVisible();
  await sheet.locator('summary').filter({hasText: '商品名を指定'}).click();
  await sheet.getByRole('textbox', {name: '商品名', exact: true}).fill('店頭の写真');
  await sheet.getByRole('button', {name: '登録する', exact: true}).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', {name: '店頭の写真の詳細'})).toBeVisible();
  const rows = await (await page.request.get('/api/items')).json();
  expect(rows.find((x: {name: string}) => x.name === '店頭の写真').image_url).toMatch(/^\/uploads\/.*\.jpg$/);
  await expect(page).toHaveURL(/\/design$/);
});

test('appearance and AI settings expand in place; color, dark mode and selected UI survive reload', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await member(page);
  await newHome(page);
  await page.getByRole('button', {name: 'メニュー', exact: true}).click();
  await page.getByRole('link', {name: '設定', exact: true}).click();
  await page.getByRole('button', {name: '配色を変更', exact: true}).click();
  const url = page.url();
  await page.getByRole('button', {name: '藍色', exact: true}).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('html')).toHaveAttribute('data-light-palette', 'indigo');
  await page.getByRole('button', {name: 'テーマ', exact: true}).click();
  await expect(page.getByText('カラースキーム', {exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'ダーク', exact: true}).click();
  await page.getByRole('button', {name: 'AI連携', exact: true}).click();
  await expect(page).toHaveURL(url);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/agenda.*dark|dark.*agenda/);
  await expect(page.locator('html')).toHaveAttribute('data-light-palette', 'indigo');
  await fits(page);
  await page.goto('/design');
  await switchUiVersion(page);
  await page.getByRole('link', {name: '設定', exact: true}).click();
  await page.getByRole('button', {name: 'テーマ', exact: true}).click();
  await expect(page.getByText('カラースキーム', {exact: true})).toBeVisible();
});

test('URL sheet restores an offline trashed URL and carries a failed URL to manual entry', async ({page}) => {
  await member(page);
  const url = 'https://example.com/discontinued';
  const saved = await item(page, '取り扱い終了の商品', {url});
  expect((await page.request.delete(`/api/items/${saved.id}`, {headers: {Origin: origin}})).ok()).toBeTruthy();
  await page.route('**/api/items/preview', route => route.fulfill({status: 422, json: {error: '商品情報を取得できませんでした'}}));
  await newHome(page);
  await page.getByRole('button', {name: '登録', exact: true}).click();
  const sheet = page.getByRole('dialog', {name: 'ほしいものを登録'});
  await sheet.getByRole('textbox', {name: '商品URL', exact: true}).fill(url);
  await sheet.getByRole('button', {name: '商品情報を取得'}).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/items', async route => {
    if (route.request().method() === 'POST') await pending;
    await route.continue();
  });
  await sheet.getByRole('button', {name: '登録する', exact: true}).click();
  await expect(sheet.getByRole('button', {name: '商品情報を取得'})).toBeDisabled();
  await expect(sheet.getByRole('textbox', {name: '商品URL', exact: true})).toHaveAttribute('readonly', '');
  release();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', {name: '取り扱い終了の商品の詳細'})).toBeVisible();
  expect((await (await page.request.get('/api/items')).json()).filter((x: {url: string}) => x.url === url)).toHaveLength(1);
  await page.getByRole('button', {name: '登録', exact: true}).click();
  const nextUrl = 'https://example.com/new-manual';
  await sheet.getByRole('textbox', {name: '商品URL', exact: true}).fill(nextUrl);
  await sheet.getByRole('button', {name: '商品情報を取得'}).click();
  await sheet.getByRole('button', {name: '商品名を入力して登録'}).click();
  await expect(sheet.getByRole('tab', {name: '手入力'})).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.getByRole('textbox', {name: '商品URL', exact: true})).toHaveValue(nextUrl);
});

test('spending refresh waits for deletion and sees changes from another tab when resumed', async ({page}) => {
  await member(page);
  const gone = await item(page, '削除する商品');
  const remaining = await item(page, '残す商品', {price: 100});
  await newHome(page);
  await page.getByRole('link', {name: '出費予定', exact: true}).click();
  await expect(page.getByTestId('spend-selected-total')).toHaveText('¥1,300');
  await expect(page.getByRole('heading', {name: '出費予定', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '削除する商品の詳細'}).click();
  const detail = page.getByRole('dialog', {name: '商品と販売候補'});
  await detail.locator('summary').filter({hasText: '編集・価格履歴・購入済み操作'}).click();
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route(`**/api/items/${gone.id}`, async route => {
    if (route.request().method() === 'DELETE') await pending;
    await route.continue();
  });
  await detail.getByRole('button', {name: '削除', exact: true}).click();
  await expect(page.getByTestId('spend-selected-total')).toHaveText('¥1,300');
  release();
  await expect(detail.getByText('この商品はリストから移動しました。')).toBeVisible();
  await detail.getByRole('button', {name: '商品と販売候補を閉じる'}).click();
  await expect(page.getByTestId('spend-selected-total')).toHaveText('¥100');
  expect((await page.request.patch(`/api/items/${remaining.id}`, {headers: {Origin: origin}, data: {current_price: 350}})).ok()).toBeTruthy();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByTestId('spend-selected-total')).toHaveText('¥350');
});

test('guest notice and registration dock fit a phone and guest restrictions remain', async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  expect((await page.request.post('/api/auth/guest', {headers: {Origin: origin}})).status()).toBe(201);
  await newHome(page);
  const register = page.getByRole('button', {name: '登録', exact: true});
  await expect(page.getByRole('complementary', {name: 'ゲスト体験'})).toBeVisible();
  await expect.poll(async () => {const b = await register.boundingBox(); return !!b && b.y >= 0 && b.y + b.height <= 844;}).toBeTruthy();
  await register.click();
  const sheet = page.getByRole('dialog', {name: 'ほしいものを登録'});
  await sheet.getByRole('tab', {name: '写真', exact: true}).click();
  await expect(sheet.getByText('写真の登録はログイン後に利用できます。')).toBeVisible();
  await expect(sheet.getByRole('button', {name: '登録する', exact: true})).toBeDisabled();
  await fits(page);
  await page.screenshot({path: info.outputPath('guest-registration-390.png'), fullPage: true});
});

test('spending amounts and controls do not clip with larger text on a narrow phone', async ({page}) => {
  await member(page);
  await item(page, 'とても長い商品名でも価格を最後まで確認できる商品', {price: 999999999, quantity: 9, planned_purchase_date: '2027-02-03'});
  await page.setViewportSize({width: 320, height: 844});
  await newHome(page);
  await page.getByRole('link', {name: '出費予定', exact: true}).click();
  await page.evaluate(() => {document.documentElement.style.fontSize = '20px';});
  const total = page.getByTestId('spend-selected-total');
  await expect(total).toHaveText('¥8,999,999,991');
  await page.evaluate(() => document.fonts.ready);
  expect(await total.evaluate(el => {
    const box = el.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(el);
    const text = range.getBoundingClientRect(); return text.left >= box.left - 1 && text.right <= box.right + 1 && text.bottom <= box.bottom + 1;
  })).toBeTruthy();
  await fits(page);
});

test('photo search registers real candidate data, notes and date without leaving the sheet', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const jpeg = await sharp({create: {width: 8, height: 8, channels: 3, background: '#a47750'}}).jpeg().toBuffer();
  await page.route('https://item-shopping.c.yimg.jp/**', route => route.fulfill({contentType: 'image/jpeg', body: jpeg}));
  await page.route('https://thumbnail.image.rakuten.co.jp/**', route => route.abort());
  await member(page);
  await newHome(page);
  await page.getByRole('button', {name: '登録', exact: true}).click();
  const sheet = page.getByRole('dialog', {name: 'ほしいものを登録'});
  await sheet.getByRole('tab', {name: '写真', exact: true}).click();
  await sheet.getByLabel('登録する画像ファイル').setInputFiles({name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg});
  await sheet.locator('summary').filter({hasText: 'メモ・購入予定日'}).click();
  await sheet.getByRole('textbox', {name: '気になった理由（任意）'}).fill('店頭で書き心地を試す');
  await sheet.getByRole('tabpanel', {name: '写真', exact: true}).getByLabel('購入予定日', {exact: true}).fill('2027-02-03');
  await sheet.getByRole('button', {name: 'この写真から商品を検索'}).click();
  await sheet.getByRole('checkbox', {name: '候補を選ぶ テスト用ゲルボールペン 0.5'}).first().check();
  await sheet.getByRole('button', {name: '選んだ候補を登録'}).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/design$/);
  const saved = await (await page.request.get('/api/items')).json();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({url: 'https://store.shopping.yahoo.co.jp/example/pen', notes: '店頭で書き心地を試す', planned_purchase_date: '2027-02-03'});
  await fits(page);
});
