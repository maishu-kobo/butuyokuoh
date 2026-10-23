import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const jpeg = [0xff, 0xd8, 0xff, 0x00];
const heic = Buffer.concat([Buffer.of(0, 0, 0, 0x18), Buffer.from('ftypheic'), Buffer.alloc(4)]);
const pixel = { create: { width: 8, height: 8, channels: 3 as const, background: { r: 20, g: 40, b: 60 } } };
let readableJpeg: number[] = [];

test.beforeAll(async () => {
  readableJpeg = [...await sharp(pixel).jpeg().toBuffer()];
});

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: { email: `pick-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

async function openAdd(page: Page) {
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
}

async function dropFiles(page: Page, files: { name: string; type: string; bytes: number[] }[]) {
  await page.locator('[data-testid="capture-photo-card"]').evaluate((card, payload) => {
    const transfer = new DataTransfer();
    for (const file of payload) {
      transfer.items.add(new File([Uint8Array.from(file.bytes)], file.name, { type: file.type }));
    }
    for (const type of ['dragover', 'drop'] as const) {
      card.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  }, files);
}

test('a member chooses one readable photo and is guided away from files we cannot read', async ({ page }) => {
  await member(page);
  await openAdd(page);

  const choose = page.getByRole('button', { name: '写真から登録' });
  await expect(choose).toBeVisible();
  const input = page.getByLabel('写真ファイル');
  await expect(input).toHaveAttribute('accept', 'image/*,image/heic,image/heif,.heic,.heif');
  await expect(input).toHaveJSProperty('multiple', false);
  expect(await input.evaluate((node: HTMLInputElement) => node.hasAttribute('capture'))).toBe(false);

  await input.setInputFiles({ name: 'a.heic', mimeType: 'image/heic', buffer: heic });
  await expect(page.getByRole('status').filter({ hasText: 'この写真は読めません' })).toBeVisible();

  await dropFiles(page, [
    { name: 'a.jpg', type: 'image/jpeg', bytes: jpeg },
    { name: 'b.jpg', type: 'image/jpeg', bytes: jpeg },
  ]);
  await expect(page.getByRole('alert').filter({ hasText: '写真は1枚だけ選べます' })).toBeVisible();

  await dropFiles(page, [{ name: 'a.jpg', type: 'image/jpeg', bytes: readableJpeg }]);
  await expect(page.getByRole('status').filter({ hasText: '1枚の写真を選びました' })).toBeVisible();
  // 成功側は展開できる JPEG。読めない案内はピッカーの alert だけを見る。
  // ページ全体を数えると、別の status に同じ文が出たとき速さで結果が変わる。
  await expect(page.getByRole('alert').filter({ hasText: 'この写真は読めません' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '写真は1枚だけ選べます' })).toHaveCount(0);
});

test('guests do not get the photo picker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'ゲスト体験' })).toBeVisible();
  await openAdd(page);
  await expect(page.getByRole('heading', { name: '新しいアイテムを追加' })).toBeVisible();
  await expect(page.getByRole('button', { name: '写真から登録' })).toHaveCount(0);
});

test('a member adds an item manually while choose-a-photo is showing', async ({ page }) => {
  await member(page);
  await openAdd(page);
  const choose = page.getByRole('button', { name: '写真から登録' });
  await expect(choose).toBeVisible();

  await page.getByRole('button', { name: '手動で追加', exact: true }).click();
  await expect(choose).toBeVisible();
  await expect(page.getByPlaceholder('商品名を入力')).toBeVisible();
  await page.getByPlaceholder('商品名を入力').fill('手入力のボールペン');
  await page.getByPlaceholder('例: 3990').fill('1200');
  await page.getByRole('button', { name: '追加', exact: true }).click();

  await expect(page.getByText('手入力のボールペン', { exact: true })).toBeVisible();
  await expect(page.getByText('¥1,200')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '新しいアイテムを追加' })).toBeVisible();
  await expect(choose).toHaveCount(0);
});

function capturePath(url: string) {
  return new URL(url).pathname === '/api/capture';
}

async function expectNoCaptureCall(page: Page, calls: string[]) {
  expect(calls).toEqual([]);
  const late = await page.waitForRequest(request => capturePath(request.url()), { timeout: 1_000 })
    .then(request => request.url(), () => null);
  expect(late).toBeNull();
  expect(calls).toEqual([]);
}

test('a guest and a closed card do not call /api/capture', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', request => {
    if (capturePath(request.url())) calls.push(`${request.method()} ${request.url()}`);
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ゲストで試す', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ゲストで試す', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'ゲスト体験' })).toBeVisible();
  await openAdd(page);
  await expect(page.getByRole('heading', { name: '新しいアイテムを追加' })).toBeVisible();
  await page.getByRole('button', { name: '手動で追加', exact: true }).click();
  await expect(page.getByPlaceholder('商品名を入力')).toBeVisible();
  await expectNoCaptureCall(page, calls);

  await member(page);
  await expect(page.getByRole('button', { name: '新しいアイテムを追加' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '新しいアイテムを追加' })).toHaveCount(0);
  await expectNoCaptureCall(page, calls);
});

test('the desktop menu closes on Escape, outside click, and arrow keys move between items', async ({ page }) => {
  await member(page);
  await openAdd(page);
  const openMenu = page.getByRole('button', { name: '写真から登録' });
  await openMenu.click();
  const menu = page.getByRole('menu', { name: '写真の取り込み' });
  await expect(menu).toBeVisible();
  await expect(openMenu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem', { name: 'カメラで撮る' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'ファイル/写真を選ぶ' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(openMenu).toBeFocused();
  await expect(openMenu).toHaveAttribute('aria-expanded', 'false');

  await openMenu.click();
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height + 30);
  await expect(menu).toHaveCount(0);
});

test('desktop menu items open the camera input and the file input', async ({ page }) => {
  await member(page);
  await openAdd(page);
  const clicks = () => page.evaluate(() => (window as unknown as { __captureClicks?: string[] }).__captureClicks ?? []);
  await page.evaluate(() => {
    (window as unknown as { __captureClicks?: string[] }).__captureClicks = [];
  });
  for (const label of ['写真を撮る', '写真ファイル']) {
    await page.getByLabel(label).evaluate((node, name) => {
      node.addEventListener('click', () => {
        const record = (window as unknown as { __captureClicks?: string[] });
        record.__captureClicks = [...(record.__captureClicks ?? []), name];
      });
    }, label);
  }
  await page.getByRole('button', { name: '写真から登録' }).click();
  await page.getByRole('menuitem', { name: 'カメラで撮る' }).click();
  await expect.poll(clicks).toEqual(['写真を撮る']);
  await expect(page.getByRole('menu', { name: '写真の取り込み' })).toHaveCount(0);
  await page.getByRole('button', { name: '写真から登録' }).click();
  await page.getByRole('menuitem', { name: 'ファイル/写真を選ぶ' }).click();
  await expect.poll(clicks).toEqual(['写真を撮る', '写真ファイル']);
});

test('a coarse pointer opens the file input and does not show the custom menu', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query === '(pointer: coarse)') {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        } as MediaQueryList;
      }
      return original(query);
    };
  });
  await member(page);
  await openAdd(page);
  await page.getByLabel('写真ファイル').evaluate((node: HTMLInputElement) => {
    node.addEventListener('click', () => {
      (window as unknown as { __captureFileClicked?: boolean }).__captureFileClicked = true;
    });
  });
  const register = page.getByRole('button', { name: '写真から登録' });
  await expect(register).not.toHaveAttribute('aria-haspopup');
  await register.click();
  await expect(page.getByRole('menu', { name: '写真の取り込み' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __captureFileClicked?: boolean }).__captureFileClicked === true)).toBe(true);
});

test('the photo picker stays closed when capture is switched off', async ({ page }) => {
  await page.route('**/api/capture', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false, aiEnabled: false }),
    });
  });
  await member(page);
  const flags = page.waitForResponse(response => (
    response.url().includes('/api/capture') && response.request().method() === 'GET'
  ));
  await openAdd(page);
  expect(await (await flags).json()).toEqual({ enabled: false, aiEnabled: false });
  await expect(page.getByRole('heading', { name: '新しいアイテムを追加' })).toBeVisible();
  await expect(page.getByRole('button', { name: '写真から登録' })).toHaveCount(0);
});
