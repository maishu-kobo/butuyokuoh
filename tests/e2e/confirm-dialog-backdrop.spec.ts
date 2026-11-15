import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

const ITEM = 'backdrop誤操作確認用の商品';

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      email: `backdrop-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      password: 'test-password',
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

async function seedTrash(page: Page) {
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByRole('button', { name: '手動で追加' }).click();
  await page.getByPlaceholder('商品名を入力').fill(ITEM);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: ITEM, exact: true })).toBeVisible();
  const card = page.locator('div.rounded-lg.shadow-md').filter({
    has: page.getByRole('heading', { name: ITEM, exact: true }),
  }).first();
  await card.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('heading', { name: ITEM, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.getByRole('heading', { name: /ゴミ箱/ })).toBeVisible();
  await expect(page.locator('h4', { hasText: ITEM })).toBeVisible();
}

function confirmDialog(page: Page) {
  return page.getByRole('dialog');
}

async function openPurge(page: Page) {
  const row = page.locator('div.rounded-lg.shadow').filter({ has: page.locator('h4', { hasText: ITEM }) }).first();
  await row.getByTitle('完全に削除').click();
  await expect(confirmDialog(page)).toBeVisible();
  return row;
}

/** mousedown → mouseup の一連（ブラウザの通常クリック相当）。 */
async function pointerClickAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('confirm dialog backdrop must not click through', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await member(page);
    await seedTrash(page);
  });

  test('mouse gesture over restore through the dimmed area does not restore', async ({ page }) => {
    const restores: string[] = [];
    const deletes: string[] = [];
    await page.route(/\/api\/trash(\/\d+)?$/, async (route: Route) => {
      const method = route.request().method();
      const pathname = new URL(route.request().url()).pathname;
      if (method === 'POST' && /^\/api\/trash\/\d+$/.test(pathname)) {
        restores.push(pathname);
      }
      if (method === 'DELETE') {
        deletes.push(pathname);
      }
      await route.continue();
    });

    const row = await openPurge(page);
    const restore = row.getByTitle('元に戻す');
    const box = await restore.boundingBox();
    expect(box).toBeTruthy();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    const overlayHit = await page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      return {
        tag: el?.tagName ?? null,
        role: el?.getAttribute?.('role') ?? null,
        inOverlay: !!el?.closest?.('[role="presentation"]'),
      };
    }, { px: x, py: y });
    expect(overlayHit.inOverlay).toBe(true);

    // mousedown 直後に portal が外れると、同じ座標の elementFromPoint が背面ボタンになる。
    const afterMouseDown = await page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      el?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: px,
        clientY: py,
      }));
      const after = document.elementFromPoint(px, py);
      return {
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        afterButtonTitle: after?.closest?.('button')?.getAttribute?.('title') ?? null,
        afterStillOverlay: !!after?.closest?.('[role="presentation"]'),
      };
    }, { px: x, py: y });
    expect(afterMouseDown, JSON.stringify(afterMouseDown)).toMatchObject({
      dialogCount: 1,
      afterStillOverlay: true,
      afterButtonTitle: null,
    });

    await pointerClickAt(page, x, y);

    expect(restores, `restore requests: ${JSON.stringify(restores)}`).toEqual([]);
    expect(deletes, `delete requests: ${JSON.stringify(deletes)}`).toEqual([]);
    await expect(page.locator('h4', { hasText: ITEM })).toBeVisible();
    // 背景ジェスチャでは閉じない（キャンセル / Esc のみ）。
    await expect(confirmDialog(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: /ゴミ箱/ })).toBeVisible();
  });

  test('mouse gesture over purge × through the dimmed area does not re-trigger purge', async ({ page }) => {
    const deletes: string[] = [];
    await page.route(/\/api\/trash(\/\d+)?$/, async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(new URL(route.request().url()).pathname);
      }
      await route.continue();
    });

    const row = await openPurge(page);
    const purge = row.getByTitle('完全に削除');
    const box = await purge.boundingBox();
    expect(box).toBeTruthy();
    await pointerClickAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);

    expect(deletes).toEqual([]);
    await expect(confirmDialog(page)).toBeVisible();
    await expect(confirmDialog(page)).toHaveCount(1);
    await expect(page.locator('h4', { hasText: ITEM })).toBeVisible();
  });

  test('mouse gesture over a tab through the dimmed area does not switch tabs', async ({ page }) => {
    await openPurge(page);
    const listTab = page.getByRole('button', { name: 'リスト', exact: true });
    const box = await listTab.boundingBox();
    expect(box).toBeTruthy();

    const hit = await page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      return !!el?.closest?.('[role="presentation"]');
    }, { px: box!.x + box!.width / 2, py: box!.y + box!.height / 2 });
    expect(hit).toBe(true);

    await pointerClickAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(confirmDialog(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: /ゴミ箱/ })).toBeVisible();
    await expect(page.locator('h4', { hasText: ITEM })).toBeVisible();
  });

  test('touch tap on dimmed area over restore does not restore (mobile)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await member(page);
    await seedTrash(page);

    const restores: string[] = [];
    await page.route(/\/api\/trash(\/\d+)?$/, async (route: Route) => {
      if (route.request().method() === 'POST' && /\/api\/trash\/\d+$/.test(new URL(route.request().url()).pathname)) {
        restores.push(new URL(route.request().url()).pathname);
      }
      await route.continue();
    });

    const row = await openPurge(page);
    const restore = row.getByTitle('元に戻す');
    const box = await restore.boundingBox();
    expect(box).toBeTruthy();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);

    expect(restores).toEqual([]);
    await expect(page.locator('h4', { hasText: ITEM })).toBeVisible();
    await expect(confirmDialog(page)).toBeVisible();
    await context.close();
  });

  test('busy blocks Esc and backdrop gestures; cancel and Esc work when idle with cancel focus', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deletes: string[] = [];
    await page.route(/\/api\/trash\/\d+$/, async (route: Route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deletes.push(new URL(route.request().url()).pathname);
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });

    const row = await openPurge(page);
    const dialog = confirmDialog(page);
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();

    await dialog.getByRole('button', { name: '完全に削除' }).click();
    await expect.poll(() => deletes.length).toBe(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const restoreBox = await row.getByTitle('元に戻す').boundingBox();
    expect(restoreBox).toBeTruthy();
    await pointerClickAt(page, restoreBox!.x + restoreBox!.width / 2, restoreBox!.y + restoreBox!.height / 2);
    await expect(dialog).toBeVisible();
    expect(deletes).toHaveLength(1);

    release();
    await expect(confirmDialog(page)).toHaveCount(0);

    await openPurge(page);
    const again = confirmDialog(page);
    await expect(again.getByRole('button', { name: 'キャンセル' })).toBeFocused();
    await again.getByRole('button', { name: 'キャンセル' }).click();
    await expect(confirmDialog(page)).toHaveCount(0);

    await openPurge(page);
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
  });
});
