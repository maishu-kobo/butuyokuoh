import { expect, test, type Page, type Route } from '@playwright/test';

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
  await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.getByText(ITEM, { exact: true })).toBeVisible();
}

function confirmDialog(page: Page) {
  return page.getByRole('dialog');
}

async function openPurge(page: Page) {
  const row = page.locator('div.rounded-lg.shadow').filter({ hasText: ITEM }).first();
  await row.getByTitle('完全に削除').click();
  await expect(confirmDialog(page)).toBeVisible();
  return row;
}

/** 背面コントロールの中心へ、ポインタの一連ジェスチャを送る（mousedown→mouseup→click）。 */
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

    // ダイアログが背面ボタンの上に被さっていることを固定する。
    const overlayHit = await page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      return {
        tag: el?.tagName ?? null,
        role: el?.getAttribute?.('role') ?? null,
        inDialog: !!el?.closest?.('[role="dialog"], [role="presentation"]'),
      };
    }, { px: x, py: y });
    expect(overlayHit.inDialog).toBe(true);

    await pointerClickAt(page, x, y);

    // 背面の復元が起動してはいけない。DELETE も走らない。
    expect(restores).toEqual([]);
    expect(deletes).toEqual([]);
    await expect(page.getByText(ITEM, { exact: true })).toBeVisible();
    // 背景ジェスチャでは閉じない（キャンセル / Esc のみ）。誤操作面を残さない。
    await expect(confirmDialog(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'ゴミ箱', exact: true })).toHaveClass(/bg-\[var\(--shu\)\]|shadow-md/);
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
    await expect(page.getByText(ITEM, { exact: true })).toBeVisible();
  });

  test('mouse gesture over a tab through the dimmed area does not switch tabs', async ({ page }) => {
    await openPurge(page);
    const listTab = page.getByRole('button', { name: 'リスト', exact: true });
    const box = await listTab.boundingBox();
    expect(box).toBeTruthy();

    const hit = await page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      return !!el?.closest?.('[role="presentation"], [role="dialog"]');
    }, { px: box!.x + box!.width / 2, py: box!.y + box!.height / 2 });
    expect(hit).toBe(true);

    await pointerClickAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(confirmDialog(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: /ゴミ箱/ })).toBeVisible();
    await expect(page.getByText(ITEM, { exact: true })).toBeVisible();
  });

  test('touch tap on dimmed area over restore does not restore (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await page.touchscreen.tap(x, y);

    expect(restores).toEqual([]);
    await expect(page.getByText(ITEM, { exact: true })).toBeVisible();
    await expect(confirmDialog(page)).toBeVisible();
  });

  test('busy blocks Esc and backdrop gestures; cancel keeps focus and Esc still works when idle', async ({ page }) => {
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

    // busy 中: Esc と背景クリックで閉じない／背面操作しない。
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const restoreBox = await row.getByTitle('元に戻す').boundingBox();
    expect(restoreBox).toBeTruthy();
    await pointerClickAt(page, restoreBox!.x + restoreBox!.width / 2, restoreBox!.y + restoreBox!.height / 2);
    await expect(dialog).toBeVisible();
    expect(deletes).toHaveLength(1);

    release();
    await expect(confirmDialog(page)).toHaveCount(0);

    // 再オープンしてキャンセル／Esc／フォーカス復帰の境界。
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
