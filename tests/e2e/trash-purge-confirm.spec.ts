import { expect, test, type Page, type Route } from '@playwright/test';

const ITEM_A = '完全削除確認用の商品A';
const ITEM_B = '完全削除確認用の商品B';

async function member(page: Page) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      email: `trash-purge-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      password: 'test-password',
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/');
}

async function addManual(page: Page, name: string) {
  await page.getByRole('button', { name: '新しいアイテムを追加' }).click();
  await page.getByRole('button', { name: '手動で追加' }).click();
  await page.getByPlaceholder('商品名を入力').fill(name);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function moveToTrash(page: Page, name: string) {
  const card = page.locator('div.rounded-lg.shadow-md').filter({
    has: page.getByRole('heading', { name, exact: true }),
  }).first();
  await card.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
}

async function openTrash(page: Page) {
  await page.getByRole('button', { name: 'ゴミ箱', exact: true }).click();
  await expect(page.getByRole('heading', { name: /ゴミ箱/ })).toBeVisible();
}

function confirmDialog(page: Page) {
  return page.getByRole('dialog');
}

async function openItemPurgeConfirm(page: Page, name: string) {
  const row = page.locator('div.rounded-lg.shadow').filter({ hasText: name }).first();
  await row.getByTitle('完全に削除').click();
  const dialog = confirmDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('trash permanent delete confirmation', () => {
  test.beforeEach(async ({ page }) => {
    // 標準 confirm が自動承認されても、アプリ内ダイアログ前提の検証を崩さない。
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await member(page);
    await addManual(page, ITEM_A);
    await addManual(page, ITEM_B);
    await moveToTrash(page, ITEM_A);
    await moveToTrash(page, ITEM_B);
    await openTrash(page);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();
    await expect(page.getByText(ITEM_B, { exact: true })).toBeVisible();
  });

  test('opening × or empty-trash only shows the in-app dialog and does not DELETE', async ({ page }) => {
    const deletes: string[] = [];
    await page.route('**/api/trash**', async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(new URL(route.request().url()).pathname);
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    const dialog = await openItemPurgeConfirm(page, ITEM_A);
    await expect(dialog).toContainText(ITEM_A);
    await expect(dialog).toContainText(/元に戻せません|完全に削除/);
    await expect(dialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();
    expect(deletes).toEqual([]);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();

    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    expect(deletes).toEqual([]);

    await page.getByRole('button', { name: 'ゴミ箱を空にする' }).click();
    const emptyDialog = confirmDialog(page);
    await expect(emptyDialog).toBeVisible();
    await expect(emptyDialog).toContainText(/2件|全件/);
    await expect(emptyDialog).toContainText(/空にする|完全に削除/);
    await expect(emptyDialog.getByRole('button', { name: 'キャンセル' })).toBeFocused();
    expect(deletes).toEqual([]);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();
    await expect(page.getByText(ITEM_B, { exact: true })).toBeVisible();
  });

  test('cancel and Escape keep items and send no DELETE', async ({ page }) => {
    const deletes: string[] = [];
    await page.route('**/api/trash**', async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(new URL(route.request().url()).pathname);
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
        return;
      }
      await route.continue();
    });

    let dialog = await openItemPurgeConfirm(page, ITEM_A);
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    expect(deletes).toEqual([]);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();

    dialog = await openItemPurgeConfirm(page, ITEM_A);
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
    expect(deletes).toEqual([]);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'ゴミ箱を空にする' }).click();
    dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
    expect(deletes).toEqual([]);
    await expect(page.getByText(ITEM_B, { exact: true })).toBeVisible();
  });

  test('leaving the dialog open keeps it visible without deleting', async ({ page }) => {
    const deletes: string[] = [];
    await page.route('**/api/trash**', async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(route.request().url());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
        return;
      }
      await route.continue();
    });

    const dialog = await openItemPurgeConfirm(page, ITEM_A);
    await page.waitForTimeout(1200);
    await expect(dialog).toBeVisible();
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();
    expect(deletes).toEqual([]);
  });

  test('confirm sends the correct DELETE once and refreshes the list on success', async ({ page }) => {
    const deletes: string[] = [];
    await page.route('**/api/trash**', async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(new URL(route.request().url()).pathname);
      }
      await route.continue();
    });

    const trashBefore = await (await page.request.get('/api/trash')).json() as { id: number; name: string }[];
    const target = trashBefore.find((item) => item.name === ITEM_A);
    expect(target).toBeTruthy();

    const dialog = await openItemPurgeConfirm(page, ITEM_A);
    await dialog.getByRole('button', { name: '完全に削除' }).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByText(ITEM_A, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ITEM_B, { exact: true })).toBeVisible();
    expect(deletes).toEqual([`/api/trash/${target!.id}`]);

    await page.getByRole('button', { name: 'ゴミ箱を空にする' }).click();
    const emptyDialog = confirmDialog(page);
    await emptyDialog.getByRole('button', { name: 'ゴミ箱を空にする' }).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByText(ITEM_B, { exact: true })).toHaveCount(0);
    await expect(page.getByText('ゴミ箱は空です')).toBeVisible();
    expect(deletes).toEqual([`/api/trash/${target!.id}`, '/api/trash']);
  });

  test('HTTP and network failures stay open with guidance and allow retry', async ({ page }) => {
    let mode: 'http' | 'network' | 'ok' = 'http';
    const deletes: string[] = [];
    await page.route('**/api/trash/**', async (route: Route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deletes.push(new URL(route.request().url()).pathname);
      if (mode === 'http') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'server exploded' }),
        });
        return;
      }
      if (mode === 'network') {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    const dialog = await openItemPurgeConfirm(page, ITEM_A);
    await dialog.getByRole('button', { name: '完全に削除' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/失敗|エラー|再試行|もう一度/);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();
    expect(deletes).toHaveLength(1);

    mode = 'network';
    await dialog.getByRole('button', { name: '完全に削除' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/失敗|エラー|再試行|もう一度|通信/);
    await expect(page.getByText(ITEM_A, { exact: true })).toBeVisible();
    expect(deletes).toHaveLength(2);

    mode = 'ok';
    await dialog.getByRole('button', { name: '完全に削除' }).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByText(ITEM_A, { exact: true })).toHaveCount(0);
    expect(deletes).toHaveLength(3);
  });

  test('double confirm while in flight sends only one DELETE', async ({ page }) => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deletes: string[] = [];
    await page.route('**/api/trash/**', async (route: Route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deletes.push(new URL(route.request().url()).pathname);
      await gate;
      await route.continue();
    });

    const dialog = await openItemPurgeConfirm(page, ITEM_A);
    const confirm = dialog.getByRole('button', { name: '完全に削除' });
    await confirm.click();
    await confirm.click({ force: true }).catch(() => undefined);
    await expect.poll(() => deletes.length).toBe(1);
    release!();
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByText(ITEM_A, { exact: true })).toHaveCount(0);
    expect(deletes).toHaveLength(1);
  });
});
