import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

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

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: { email: `flow-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

test('a member can take or choose a photo, edit the name, and register a candidate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://item-shopping.c.yimg.jp/**', (route) => route.abort());
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
  await page.getByRole('button', { name: '選んだ候補を登録' }).click();
  await expect(page.getByRole('heading', { name: '別のペン' })).toBeVisible();
});


test('search credits remain visible for empty and partial results; untagged links have no affiliate claim', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.request.post('/api/auth/register', { data: { email: 'attribution@example.test', password: 'test-password' } });
  await page.route('https://item-shopping.c.yimg.jp/**', (route) => route.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', (route) => route.abort());
  let scenario = 'default';
  let untagged = false;
  await page.route('**/api/capture/search', async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'x-capture-fake-scenario': scenario } });
    const data = await response.json();
    expect(data.attribution).toEqual({ yahoo: true, rakuten: true });
    // Only this UI case substitutes the optional link configuration. The search
    // itself, including empty/failed providers and attribution, uses the server.
    if (untagged) data.amazonUrl = 'https://www.amazon.co.jp/s?k=pen';
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'credit.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const credit = page.getByRole('link', { name: 'Webサービス by Yahoo! JAPAN' });
  await expect(credit).toHaveAttribute('href', 'https://developer.yahoo.co.jp/sitemap/');
  await expect(page.getByText('Amazonのアソシエイトとして', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('attribution-mobile.png'), fullPage: true });
  for (const next of ['empty', 'yahoo-down', 'rakuten-down', 'both-down']) {
    scenario = next;
    await page.getByLabel('探す商品名').fill(`ペン ${next}`);
    const searched = page.waitForResponse('**/api/capture/search');
    await page.getByRole('button', { name: 'この名前で探す' }).click();
    await searched;
    await expect(credit).toBeVisible();
    if (next !== 'both-down') await expect(page.getByRole('link', { name: 'Amazonで探す' })).toBeVisible();
  }
  scenario = 'default'; untagged = true;
  await page.getByRole('button', { name: 'この名前で探す' }).click();
  await expect(page.getByRole('link', { name: 'Amazonで探す' })).toHaveAttribute('href', 'https://www.amazon.co.jp/s?k=pen');
  await expect(page.getByText('Amazonのアソシエイトとして', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
