import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import Database from 'better-sqlite3';

const pixel = { create: { width: 8, height: 8, channels: 3 as const, background: { r: 20, g: 40, b: 60 } } };
let jpeg: Buffer;

test.beforeAll(async () => {
  jpeg = await sharp(pixel).jpeg().toBuffer();
});

async function expectCandidateControls(page: Page) {
  const amazon = await page.getByRole('link', { name: 'Amazonで探す' }).boundingBox();
  const register = await page.getByRole('button', { name: '選んだ候補を登録' }).boundingBox();
  expect(amazon).toBeTruthy();
  expect(register).toBeTruthy();
  expect(register!.y - (amazon!.y + amazon!.height)).toBeGreaterThanOrEqual(16);

  const searchName = await page.getByRole('button', { name: 'この名前で探す' }).boundingBox();
  const nameField = await page.getByLabel('探す商品名').boundingBox();
  const recommended = await page.getByRole('button', { name: 'おすすめ順' }).boundingBox();
  expect(searchName).toBeTruthy();
  expect(nameField).toBeTruthy();
  expect(recommended).toBeTruthy();
  expect(searchName!.width).toBeGreaterThan(searchName!.height);
  expect(Math.abs(searchName!.y - nameField!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(searchName!.height - nameField!.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(searchName!.height - recommended!.height)).toBeLessThanOrEqual(8);
  const border = await page.evaluate(() => {
    const width = (label: string) => {
      const el = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === label);
      return el ? Number.parseFloat(getComputedStyle(el).borderTopWidth) : 0;
    };
    return { search: width('この名前で探す'), sort: width('おすすめ順') };
  });
  expect(border.search).toBeGreaterThanOrEqual(1);
  expect(border.search).toBe(border.sort);
}

async function expectCreditLayout(page: Page) {
  const footer = page.getByLabel('検索サービスのクレジット', { exact: true });
  const yahoo = footer.getByRole('link', { name: 'Webサービス by Yahoo! JAPAN' });
  const rakuten = footer.getByRole('link', { name: 'Supported by Rakuten Developers' });
  await expect(yahoo).toBeVisible();
  await expect(rakuten).toBeVisible();
  for (const link of [yahoo, rakuten]) {
    await expect(link).toHaveCSS('font-size', '12px');
  }
  const [frame, y, r, button] = await Promise.all([
    footer.boundingBox(), yahoo.boundingBox(), rakuten.boundingBox(),
    page.getByRole('button', { name: '選んだ候補を登録' }).boundingBox(),
  ]);
  expect(frame && y && r && button).toBeTruthy();
  expect(frame!.y).toBeGreaterThanOrEqual(button!.y + button!.height + 8);
  expect(Math.abs(y!.x + y!.width - r!.x - r!.width)).toBeLessThanOrEqual(2);
  expect(frame!.x + frame!.width - y!.x - y!.width).toBeCloseTo(15, 0);
  expect(await footer.evaluate(el => Number.parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(1);
}

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: { email: `flow-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

test('a member can take or choose a photo, edit the name, and register a candidate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://item-shopping.c.yimg.jp/**', route => route.fulfill({ contentType: 'image/jpeg', body: jpeg }));
  await page.route('https://thumbnail.image.rakuten.co.jp/**', (route) => route.abort());
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url().includes('/api/capture/identify')) calls.push('identify');
    if (request.url().includes('/api/capture/search')) calls.push('search');
  });

  await member(page);
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();

  const shoot = page.getByRole('button', { name: '写真から登録', exact: true });
  await expect(shoot).toBeVisible();
  const box = await shoot.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  const camera = page.getByLabel('写真を撮る');
  await expect(camera).toHaveAttribute('capture', 'environment');
  await expect(camera).toBeHidden();
  await shoot.click();
  await expect(page.getByRole('menuitem', { name: 'カメラで撮る' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'ファイル/写真を選ぶ' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '写真の取り込み' })).toHaveCount(0);

  await camera.setInputFiles({ name: 'shot.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('button', { name: 'テスト用ゲルボールペン 0.5' })).toBeVisible();
  await expect(page.getByText('sure')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '候補が2件あります' })).toBeVisible();
  await expect(page.getByText('テストショップ')).toBeVisible();
  await expect(page.getByText('¥980')).toBeVisible();
  await expect(page.getByRole('link', { name: '商品ページ' }).first()).toHaveAttribute('href', /store\.shopping\.yahoo\.co\.jp/);
  const thumb = page.getByRole('img', { name: 'テスト用ゲルボールペン 0.5' }).first();
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('src', /^https:\/\/item-shopping\.c\.yimg\.jp\//);
  const thumbBox = await thumb.boundingBox();
  expect(thumbBox).toBeTruthy();
  expect(thumbBox!.width).toBeGreaterThanOrEqual(60);
  expect(thumbBox!.width).toBeLessThanOrEqual(68);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectCandidateControls(page);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const visibleInDark = await page.getByRole('button', { name: 'この名前で探す' }).evaluate((el) => {
    const button = getComputedStyle(el);
    const card = el.closest('[data-testid="capture-photo-card"]');
    const cardBg = card ? getComputedStyle(card).backgroundColor : '';
    const border = Number.parseFloat(button.borderTopWidth);
    return border >= 1 && button.backgroundColor !== cardBg;
  });
  expect(visibleInDark).toBe(true);
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await expect(page.locator('time').first()).toHaveText(/\d{4}\/\d{1,2}\/\d{1,2}/);
  await expect(page.locator('time').first()).not.toHaveText(/T\d{2}:\d{2}:\d{2}/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(thumb).toBeVisible();
  const desktopThumb = await thumb.boundingBox();
  expect(desktopThumb).toBeTruthy();
  expect(desktopThumb!.width).toBeLessThanOrEqual(68);
  await expectCandidateControls(page);
  const chooseBox = await page.getByRole('checkbox', { name: '候補を選ぶ テスト用ゲルボールペン 0.5' }).first().boundingBox();
  expect(chooseBox).toBeTruthy();
  expect(chooseBox!.width).toBeGreaterThanOrEqual(24);
  expect(chooseBox!.height).toBeGreaterThanOrEqual(24);

  await page.getByRole('button', { name: '安い順' }).click();
  await expect(page.getByRole('button', { name: '安い順' })).toHaveAttribute('aria-pressed', 'true');

  const identifies = () => calls.filter((call) => call === 'identify').length;
  const searches = () => calls.filter((call) => call === 'search').length;
  const identifyBefore = identifies();
  const searchBefore = searches();
  expect(identifyBefore).toBeGreaterThan(0);
  expect(searchBefore).toBeGreaterThan(0);

  await page.getByLabel('探す商品名').fill('別のペン');
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect(page.getByRole('checkbox', { name: '候補を選ぶ 別のペン' }).first()).toBeVisible();
  expect(identifies()).toBe(identifyBefore);
  expect(searches()).toBe(searchBefore + 1);

  await page.getByRole('checkbox', { name: '候補を選ぶ 別のペン' }).first().check();
  await expect(page.locator('input[type="url"]')).toHaveCount(0);
  await page.getByRole('button', { name: '選んだ候補を登録' }).click();
  await expect(page.getByRole('heading', { name: '別のペン' })).toBeVisible();
  const saved = await (await page.request.get('/api/items')).json();
  expect(saved).toHaveLength(1);
  expect(saved[0].url).toBe('https://store.shopping.yahoo.co.jp/example/pen');
});

test('photo selection saves candidate URLs without showing URL fields', async ({ page }) => {
  await page.route('https://item-shopping.c.yimg.jp/**', route => route.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', route => route.abort());
  await page.request.post('/api/auth/register', {
    data: { email: 'photo-url-group@example.test', password: 'test-password' },
  });
  let ordinaryRegistrations = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/items') ordinaryRegistrations++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'urls.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const choices = page.getByRole('checkbox', { name: '候補を選ぶ テスト用ゲルボールペン 0.5' });
  await expect(choices).toHaveCount(2);
  await expect(page.getByPlaceholder('https://www.amazon.co.jp/...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '追加', exact: true })).toHaveCount(0);
  const urls = page.locator('input[type="url"]');
  const register = page.getByRole('button', { name: '選んだ候補を登録' });
  await expect(register).toBeDisabled();
  await choices.first().check();
  await expect(register).toBeEnabled();
  await expect(urls).toHaveCount(0);
  await choices.nth(1).check();
  await expect(urls).toHaveCount(0);
  await choices.first().uncheck();
  await expect(urls).toHaveCount(0);
  await choices.nth(1).uncheck();
  await expect(urls).toHaveCount(0);
  await expect(register).toBeDisabled();
  await choices.first().check();
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect(urls).toHaveCount(0);
  await expect(register).toBeDisabled();
  await expect(choices).toHaveCount(2);
  await choices.first().check();
  await choices.nth(1).check();
  const registered = page.waitForResponse(response => response.url().endsWith('/api/capture/register') && response.request().method() === 'POST');
  await register.click();
  const result = await registered;
  expect(result.ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: '新しいアイテムを追加' })).toBeVisible();
  const itemsResponse = await page.request.get('/api/items');
  const items = await itemsResponse.json();
  expect(items.map((item: { url: string }) => item.url).sort()).toEqual([
    'https://item.rakuten.co.jp/example/pen', 'https://store.shopping.yahoo.co.jp/example/pen',
  ]);
  expect(items).toHaveLength(2);
  expect(items[0].comparison_group_id).toBeGreaterThan(0);
  expect(items[1].comparison_group_id).toBe(items[0].comparison_group_id);
  expect(ordinaryRegistrations).toBe(0);
});

test('photo selection resets on another photo and switching back restores ordinary URL entry', async ({ page }) => {
  await page.route('https://item-shopping.c.yimg.jp/**', route => route.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', route => route.abort());
  await page.request.post('/api/auth/register', {
    data: { email: 'photo-url-switch@example.test', password: 'test-password' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  const photo = page.getByLabel('写真を撮る');
  await photo.setInputFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const choices = page.getByRole('checkbox', { name: '候補を選ぶ テスト用ゲルボールペン 0.5' });
  await choices.first().check();
  const urls = page.locator('input[type="url"]');
  await expect(urls).toHaveCount(0);
  await photo.setInputFiles({ name: 'second.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(urls).toHaveCount(0);
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).not.toBeChecked();
  await expect(page.getByRole('status').filter({ hasText: '1枚の写真を選びました' })).toBeVisible();
  await page.getByRole('button', { name: 'URL・手入力に切り替える' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1枚の写真を選びました' })).toHaveCount(0);
  const url = page.getByPlaceholder('https://www.amazon.co.jp/...');
  await expect(url).toBeVisible();
  await expect(url).toHaveValue('');
  await expect(url).toHaveAttribute('required', '');
  await expect(choices).toHaveCount(0);
  await expect(page.getByRole('button', { name: '選んだ候補を登録' })).toHaveCount(0);
  await page.getByRole('button', { name: '手動で追加' }).click();
  await expect(page.getByPlaceholder('商品名を入力')).toBeVisible();
});


test('leaving a pending photo search ignores its late manual fallback', async ({ page }) => {
  await page.route('https://item-shopping.c.yimg.jp/**', route => route.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', route => route.abort());
  await page.request.post('/api/auth/register', {
    data: { email: 'photo-url-pending@example.test', password: 'test-password' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'pending.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('checkbox', { name: '候補を選ぶ テスト用ゲルボールペン 0.5' })).toHaveCount(2);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/capture/search', async route => {
    await gate;
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'SEARCH_FAILED', error: '検索失敗' }) });
  });
  const requested = page.waitForRequest('**/api/capture/search');
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await requested;
  await page.getByRole('button', { name: 'URL・手入力に切り替える' }).click();
  const url = page.getByPlaceholder('https://www.amazon.co.jp/...');
  await url.fill('https://example.com/my-product');
  const finished = page.waitForEvent('requestfinished', { predicate: request => request.url().endsWith('/api/capture/search') });
  release();
  await finished;
  await expect(url).toHaveValue('https://example.com/my-product');
  await expect(page.getByPlaceholder('商品名を入力')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '追加', exact: true })).toBeVisible();
});


test('search credits remain visible for empty and partial results; untagged links have no affiliate claim', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/auth/register', { data: { email: 'attribution@example.test', password: 'test-password' } });
  await page.route('https://item-shopping.c.yimg.jp/**', (route) => route.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', (route) => route.abort());
  let scenario = 'default';
  let untagged = false;
  let unavailable = false;
  let services: { yahoo: boolean; rakuten: boolean } | null = null;
  await page.route('**/api/capture/search', async (route) => {
    if (unavailable) { await route.abort('failed'); return; }
    const response = await route.fetch({ headers: { ...route.request().headers(), 'x-capture-fake-scenario': scenario } });
    const data = await response.json();
    expect(data.attribution).toEqual({ yahoo: true, rakuten: true });
    // Only this UI case substitutes the optional link configuration. The search
    // itself, including empty/failed providers and attribution, uses the server.
    if (untagged) data.amazonUrl = 'https://www.amazon.co.jp/s?k=pen';
    if (services) data.attribution = services;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'credit.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const credit = page.getByRole('link', { name: 'Webサービス by Yahoo! JAPAN' });
  await expect(credit).toHaveAttribute('href', 'https://developer.yahoo.co.jp/sitemap/');
  const rakutenCredit = page.getByRole('link', { name: 'Supported by Rakuten Developers' });
  await expect(rakutenCredit).toHaveAttribute('href', 'https://webservice.rakuten.co.jp/');
  await expectCreditLayout(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectCreditLayout(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Amazonのアソシエイトとして', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('attribution-mobile.png'), fullPage: true });
  for (const next of ['empty', 'yahoo-down', 'rakuten-down', 'both-down']) {
    scenario = next;
    await page.getByLabel('探す商品名').fill(`ペン ${next}`);
    const searched = page.waitForResponse('**/api/capture/search');
    await page.getByRole('button', { name: 'この名前で探す' }).click();
    await searched;
    await expect(credit).toBeVisible();
    await expect(rakutenCredit).toBeVisible();
    if (next !== 'both-down') await expect(page.getByRole('link', { name: 'Amazonで探す' })).toBeVisible();
  }
  scenario = 'default'; untagged = true;
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect(page.getByRole('link', { name: 'Amazonで探す' })).toHaveAttribute('href', 'https://www.amazon.co.jp/s?k=pen');
  await expect(page.getByText('Amazonのアソシエイトとして', { exact: false })).toHaveCount(0);
  // The backend flags are tested separately; render each configured-service combination.
  for (const config of [{ yahoo: true, rakuten: false }, { yahoo: false, rakuten: true }, { yahoo: false, rakuten: false }]) {
    services = config;
    await page.getByLabel('探す商品名').fill(`設定 ${config.yahoo}-${config.rakuten}`);
    const searched = page.waitForResponse('**/api/capture/search');
    await page.getByRole('button', { name: 'この名前で探す' }).click();
    await searched;
    await expect(credit).toHaveCount(config.yahoo ? 1 : 0);
    await expect(rakutenCredit).toHaveCount(config.rakuten ? 1 : 0);
  }
  await page.getByRole('checkbox', { name: /^候補を選ぶ/ }).first().check();
  unavailable = true;
  await page.getByLabel('探す商品名').fill('通信失敗後のペン');
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect(page.getByPlaceholder('商品名を入力')).toHaveValue('通信失敗後のペン');
  await expect(page.getByRole('checkbox', { name: /^候補を選ぶ/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '選んだ候補を登録' })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'もう一度探す' }).click();
  const recovered = page.getByRole('checkbox', { name: /^候補を選ぶ/ });
  await expect(recovered).toHaveCount(2);
  await expect(recovered.first()).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('candidate images fall back for missing, failed and undecodable images', async ({ page }, testInfo) => {
  let mode: 'failed' | 'missing' | 'decode' | 'valid' = 'failed';
  await page.route('**/api/capture/search', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.candidates = data.candidates.map((item: { imageUrl: string | null }) => ({
      ...item, imageUrl: mode === 'missing' ? null : `${item.imageUrl}?image-test=${mode}`,
    }));
    await route.fulfill({ response, json: data });
  });
  await page.route(/https:\/\/(item-shopping\.c\.yimg\.jp|thumbnail\.image\.rakuten\.co\.jp)\//, async route => {
    if (mode === 'failed') {
      if (route.request().url().includes('yimg.jp')) await route.abort();
      else await route.fulfill({ status: 404, body: 'not found' });
    } else if (mode === 'decode') {
      await route.fulfill({ contentType: 'image/jpeg', body: 'invalid image' });
    } else {
      await route.fulfill({ contentType: 'image/jpeg', body: jpeg });
    }
  });
  await member(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'image-test.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  for (const next of ['failed', 'missing', 'decode', 'valid'] as const) {
    const name = next === 'failed' ? 'テスト用ゲルボールペン 0.5' : `画像テスト ${next}`;
    if (next !== 'failed') {
      mode = next;
      await page.getByLabel('探す商品名').fill(name);
      await page.getByRole('button', { name: 'この名前で探す' }).click();
    }
    // Each search has a distinct name so the previous render cannot satisfy the assertions.
    const choices = page.getByRole('checkbox', { name: `候補を選ぶ ${name}`, exact: true });
    const fallback = page.getByRole('img', { name: `${name}（画像なし）`, exact: true });
    await expect(choices).toHaveCount(2);
    if (next !== 'valid') {
      await expect(fallback).toHaveCount(2);
      await expect(fallback.first()).toBeVisible();
      await expect.poll(async () => {
        const box = await fallback.first().boundingBox();
        return box ? { width: box.width, height: box.height } : null;
      }).toEqual({ width: 64, height: 64 });
      await expect(page.locator('li img')).toHaveCount(0);
      for (const choice of await choices.all()) {
        await expect(choice.locator('..')).toContainText(name);
      }
      if (next === 'failed') {
        await page.screenshot({ path: testInfo.outputPath('fallback-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.screenshot({ path: testInfo.outputPath('fallback-desktop-dark.png'), fullPage: true });
      }
    } else {
      await expect(fallback).toHaveCount(0);
      const images = page.getByRole('img', { name, exact: true });
      await expect(images).toHaveCount(2);
      await expect.poll(() => images.evaluateAll(elements => elements.every(el => (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
    }
    await choices.first().check();
    await expect(page.getByRole('button', { name: '選んだ候補を登録' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

async function duplicateFixture(page: Page, suffix: string) {
  await page.request.post('/api/auth/register', {data:{email:`duplicate-${suffix}@example.test`,password:'test-password'}});
  await page.route('https://item-shopping.c.yimg.jp/**', r => r.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', r => r.abort());
  await page.goto('/');
  await page.getByRole('button', {name:'新しいアイテムを追加'}).click();
  return (await (await page.request.get('/api/auth/me')).json()).user.id as number;
}
function existingCandidate(userId: number, purchased = 0, deleted: string | null = null) {
  const db = new Database(process.env.E2E_DB_PATH!);
  try {
    db.prepare("INSERT INTO items(user_id,name,url,current_price,is_purchased,deleted_at) VALUES (?,?,?,?,?,datetime('now',?))")
      .run(userId, '既存のペン', 'https://store.shopping.yahoo.co.jp/example/pen', 980, purchased, deleted);
  } finally {db.close();}
}
for (const state of ['list', 'purchased', 'trash'] as const) {
  test(`registered ${state} candidates are disabled before registration`, async ({page}) => {
    const userId = await duplicateFixture(page,state);
    existingCandidate(userId,state === 'purchased' ? 1 : 0,state === 'trash' ? '-1 day' : null);
    await page.getByLabel('写真ファイル').setInputFiles({name:'pen.jpg',mimeType:'image/jpeg',buffer:jpeg});
    const choices=page.getByRole('checkbox',{name:'候補を選ぶ テスト用ゲルボールペン 0.5'});
    await expect(choices).toHaveCount(2);
    await expect(choices.first()).toBeDisabled();
    await expect(choices.nth(1)).toBeEnabled();
    await expect(page.getByText('登録済み', {exact:true})).toBeVisible();
    if(state === 'trash') await expect(page.getByText('ゴミ箱から復元できます')).toBeVisible();
    await choices.nth(1).check();
    await page.getByRole('button',{name:'選んだ候補を登録'}).click();
    await expect(page.getByRole('status').filter({hasText:'1件を登録しました'})).toBeVisible();
    await page.getByRole('button',{name:'新しいアイテムを追加'}).click();
    await page.getByLabel('写真ファイル').setInputFiles({name:'again.jpg',mimeType:'image/jpeg',buffer:jpeg});
    await expect(choices.first()).toBeDisabled();
    await expect(choices.nth(1)).toBeDisabled();
    await expect(page.getByText('候補はすべて登録済みです')).toBeVisible();
    await expect(page.getByRole('button',{name:'選んだ候補を登録'})).toBeDisabled();
    const target={list:'ほしいものリストを見る',purchased:'購入済みを見る',trash:'ゴミ箱を見る'}[state];
    await page.getByRole('button',{name:target,exact:true}).first().click();
    await expect(page.getByTestId('capture-photo-card')).toHaveCount(0);
    await expect(page.getByText('既存のペン',{exact:true})).toBeVisible();
  });
}
for (const mixed of [false,true]) {
  test(`registration race ${mixed ? 'partial' : 'all'} reports saved and skipped results`, async ({page}) => {
    const userId=await duplicateFixture(page,`race-${mixed}`);
    await page.getByLabel('写真ファイル').setInputFiles({name:'pen.jpg',mimeType:'image/jpeg',buffer:jpeg});
    const choices=page.getByRole('checkbox',{name:'候補を選ぶ テスト用ゲルボールペン 0.5'});
    await expect(choices).toHaveCount(2);
    await choices.first().check();
    if(mixed) await choices.nth(1).check();
    existingCandidate(userId);
    if (!mixed) await page.getByLabel('探す商品名').fill('');
    await page.getByRole('button',{name:'選んだ候補を登録'}).click();
    if(mixed) {
      await expect(page.getByRole('status').filter({hasText:'1件を登録しました。1件は登録済みのため追加していません。'})).toBeVisible();
      const items=await (await page.request.get('/api/items')).json(); expect(items).toHaveLength(2);
    } else {
      await expect(choices.first()).toBeDisabled();
      await expect(page.getByRole('button',{name:'選んだ候補を登録'})).toBeDisabled();
      await expect(page.getByRole('alert').filter({hasText:'選んだ候補は登録済みです'})).toBeVisible();
      const items=await (await page.request.get('/api/items')).json(); expect(items).toHaveLength(1);
      await page.getByRole('button',{name:'ほしいものリストを見る',exact:true}).click();
      await expect(page.getByText('既存のペン',{exact:true})).toBeVisible();
    }
  });
}


test('expired trash candidates do not promise restoration or navigate to cleanup', async ({page}) => {
  const userId = await duplicateFixture(page, 'expired-trash');
  existingCandidate(userId, 0, '-8 days');
  await page.getByLabel('写真ファイル').setInputFiles({name:'pen.jpg',mimeType:'image/jpeg',buffer:jpeg});
  const choices = page.getByRole('checkbox',{name:'候補を選ぶ テスト用ゲルボールペン 0.5'});
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).toBeDisabled();
  await expect(page.getByText('ゴミ箱の保存期間が過ぎています')).toBeVisible();
  await expect(page.getByText('ゴミ箱から復元できます')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'ゴミ箱を見る',exact:true})).toHaveCount(0);
  const db = new Database(process.env.E2E_DB_PATH!);
  try { expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id=?').get(userId)).toEqual({n:1}); }
  finally { db.close(); }
});
