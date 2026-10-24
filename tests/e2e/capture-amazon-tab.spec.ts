import { devices, expect, test, webkit, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';

const pixel = { create: { width: 8, height: 8, channels: 3 as const, background: { r: 20, g: 40, b: 60 } } };
let jpeg: Buffer;

test.beforeAll(async () => {
  jpeg = await sharp(pixel).jpeg().toBuffer();
});

async function showAmazonSearch(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://item-shopping.c.yimg.jp/**', (route) => route.abort());
  await page.route('https://thumbnail.image.rakuten.co.jp/**', (route) => route.abort());
  const response = await page.request.post('/api/auth/register', {
    data: { email: `amazon-tab-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, password: 'test-password' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByLabel('写真を撮る').setInputFiles({ name: 'pen.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('link', { name: 'Amazonで探す' })).toBeVisible();
}

function amazonLink(page: Page): Locator {
  return page.getByRole('link', { name: 'Amazonで探す' });
}

// ページ全体のスワイプと同じく、横に 80px 動かす。30px を超えるとタブが切り替わる。
async function swipe(target: Locator, deltaX: number) {
  await target.evaluate((el, delta) => {
    const rect = el.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endX = startX + delta;
    const touchAt = (x: number) => {
      try {
        return new Touch({
          identifier: 1,
          target: el,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 1,
          radiusY: 1,
          rotationAngle: 0,
          force: 1,
        });
      } catch {
        return document.createTouch(window, el, 1, x, y, x, y, x, y);
      }
    };
    const listOf = (touches: Touch[]) => {
      if (typeof document.createTouchList === 'function') return document.createTouchList(...touches);
      return touches;
    };
    const fire = (type: string, x: number, ended: boolean) => {
      const touch = touchAt(x);
      const list = listOf([touch]);
      const empty = listOf([]);
      el.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: ended ? empty : list,
        targetTouches: ended ? empty : list,
        changedTouches: list,
      }));
    };
    fire('touchstart', startX, false);
    fire('touchmove', endX, false);
    fire('touchend', endX, true);
  }, deltaX);
}

async function expectListStaysAndAmazonOpens(page: Page, activate: () => Promise<void>) {
  const link = amazonLink(page);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(await link.evaluate((el) => el.tagName === 'A' && el.closest('form') === null)).toBe(true);

  await swipe(link, -80);
  await expect(page.getByText('アイテム数')).toBeVisible();
  await expect(link).toBeVisible();

  const referers: string[] = [];
  await page.context().route('https://www.amazon.co.jp/**', async (route) => {
    referers.push(route.request().headers().referer ?? '');
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>amazon</title>' });
  });
  const popupPromise = page.waitForEvent('popup');
  await activate();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/https:\/\/www\.amazon\.co\.jp\/s\?/);
  expect(page.url()).not.toContain('amazon.co.jp');
  expect(page.context().pages()).toHaveLength(2);
  expect(referers).toEqual(['']);
  await expect(page.getByText('アイテム数')).toBeVisible();
}

test('a sideways touch on Amazon search keeps the list and the link opens beside it', async ({ page }) => {
  await showAmazonSearch(page);
  await expectListStaysAndAmazonOpens(page, () => amazonLink(page).click());
});

test('iPhone Safari-like WebKit keeps Amazon search off the current tab', async () => {
  let browser: Awaited<ReturnType<typeof webkit.launch>> | undefined;
  try {
    browser = await webkit.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    test.skip(true, `WebKit を起動できない: ${message.split('\n')[0]}`);
    return;
  }
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL: 'http://localhost:3107',
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await showAmazonSearch(page);
    const link = amazonLink(page);
    await expectListStaysAndAmazonOpens(page, async () => {
      const box = await link.boundingBox();
      expect(box).toBeTruthy();
      await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    });
  } finally {
    await context.close();
    await browser.close();
  }
});

test('a sideways touch away from the Amazon link still changes tabs', async ({ page }) => {
  await showAmazonSearch(page);
  await swipe(page.getByText('アイテム数'), -80);
  await expect(page.getByText('アイテム数')).toHaveCount(0);
  await expect(page.getByText('全体の合計')).toBeVisible();
});
