import { expect, test, type Page } from '@playwright/test';

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

for (const width of [1280, 1440, 1920]) {
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
