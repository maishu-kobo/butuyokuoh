import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

const origin={Origin:'http://localhost:3107'};
async function prepare(page:Page) {
  await page.clock.setFixedTime(new Date('2026-11-26T03:00:00Z'));
  expect((await page.request.post('/api/auth/register',{data:{email:`sort-${crypto.randomUUID()}@example.test`,password:'test-password'}})).ok()).toBeTruthy();
  const names=['読書灯','折りたたみ傘','小さなカメラ','ノート'];
  const priorities=[2,4,1,2];
  const dates=['2027-01-10','2026-12-10','2027-02-10',null];
  const ids:number[]=[];
  for(const [index,name] of names.entries()) {
    const response=await page.request.post('/api/items',{headers:origin,data:{manual:true,name,price:(index+1)*1000,
      priority:priorities[index],planned_purchase_date:dates[index],image_url:'/demo/wishlist.svg'}});
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).id);
  }
  const db=new Database(process.env.E2E_DB_PATH!);
  try { ids.forEach((id,index)=>db.prepare('UPDATE items SET created_at = ?, sort_order = ? WHERE id = ?').run(`2026-11-0${index+1} 12:00:00`,index,id)); }
  finally { db.close(); }
  await page.goto('/design');
  await expect(page.locator('.rank-product strong')).toHaveCount(4);
  return ids;
}

for(const width of [320,390,1440]) {
  test(`priority sorting and multi-select controls preserve dates, counts and saved ranks at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:844});
    await prepare(page);
    const names=page.locator('.rank-product strong');
    await expect(names).toHaveText(['小さなカメラ','読書灯','ノート','折りたたみ傘']);
    await expect(page.locator('.rank-number')).toHaveText(['01','01','02','01']);
    await expect(page.getByRole('button',{name:'優先度 高の1位、読書灯を同じ優先度内で並べ替え',exact:true})).toBeVisible();
    const writes:unknown[]=[];
    await page.route('**/api/items/ranking',async route=>{writes.push(route.request().postDataJSON());await route.continue();});
    const openDisplay=()=>page.getByRole('button',{name:/^リストの表示:/}).click();
    await page.getByRole('button',{name:'優先度が高い順。優先度が低い順に切り替え',exact:true}).click();
    await expect(names).toHaveText(['折りたたみ傘','読書灯','ノート','小さなカメラ']);
    await expect(page.locator('.rank-number')).toHaveText(['01','01','02','01']);
    await page.getByRole('button',{name:'優先度が低い順。優先度が高い順に切り替え',exact:true}).click();
    await openDisplay();
    const panel=page.getByRole('dialog',{name:'リストの表示',exact:true});
    await expect(panel.getByRole('radio',{name:'優先度順',exact:true})).toBeChecked();
    await expect(panel.getByRole('button',{name:'すべて',exact:true})).toHaveCount(0);
    await expect(panel.locator('.focused-priority-option').filter({has:page.getByRole('checkbox',{name:'高',exact:true})})).toContainText('2商品');
    await panel.getByRole('checkbox',{name:'最高',exact:true}).check();
    await panel.getByRole('checkbox',{name:'低',exact:true}).check();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('checkbox',{name:'最高',exact:true})).toBeChecked();
    await expect(panel.getByRole('checkbox',{name:'低',exact:true})).toBeChecked();
    await expect(panel.getByRole('button',{name:'2商品を表示',exact:true})).toBeInViewport();
    expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();
    await page.screenshot({path:info.outputPath(`list-sort-options-${width}.png`),style:'nextjs-portal { visibility: hidden; }'});
    await panel.getByRole('button',{name:'2商品を表示',exact:true}).click();
    await expect(names).toHaveText(['小さなカメラ','折りたたみ傘']);
    await expect(page.locator('.review-home-heading')).toContainText('2 / 4商品');
    const nav=page.getByRole('navigation',{name:width>=1100?'PCナビゲーション':'主な操作'});
    await nav.getByRole('link',{name:'出費予定',exact:true}).click();
    await expect(page.getByRole('heading',{name:'出費予定',exact:true})).toBeVisible();
    await expect(page.locator('.review-home-heading')).toContainText('4商品');
    // The development-only Insights badge can cover the mobile link; verify keyboard navigation too.
    const backToList=nav.getByRole('link',{name:width>=1100?'ほしいものリスト':'リスト',exact:true});
    await backToList.focus();
    await backToList.press('Enter');
    await expect(names).toHaveText(['小さなカメラ','折りたたみ傘']);
    if(width===1440) {
      await page.getByRole('button',{name:'選択',exact:true}).click();
      await page.getByRole('button',{name:'全選択',exact:true}).click();
      await expect(page.getByRole('region',{name:'選択した商品の操作'})).toContainText('2件選択中');
      await page.getByRole('button',{name:'選択を終了',exact:true}).click();
      await page.getByRole('button',{name:'写真棚',exact:true}).click();
      await expect(page.locator('.agenda-product-grid > *')).toHaveCount(2);
      await page.getByRole('button',{name:'一覧',exact:true}).click();
    }
    await openDisplay();
    await panel.getByRole('button',{name:'解除',exact:true}).click();
    await panel.getByRole('radio',{name:'登録順',exact:true}).check();
    await panel.getByRole('button',{name:'4商品を表示',exact:true}).click();
    await expect(names).toHaveText(['ノート','小さなカメラ','折りたたみ傘','読書灯']);
    await expect(page.locator('.rank-grip')).toHaveCount(0);
    await expect(page.locator('.rank-number')).toHaveCount(0);
    await page.getByRole('button',{name:'登録が新しい順。登録が古い順に切り替え',exact:true}).click();
    await expect(names).toHaveText(['読書灯','折りたたみ傘','小さなカメラ','ノート']);
    await openDisplay();
    await expect(panel.getByRole('radio',{name:'登録順',exact:true})).toBeChecked();
    await expect(panel.getByRole('radio')).toHaveCount(3);
    await panel.getByRole('radio',{name:'購入日順',exact:true}).check();
    await panel.getByRole('button',{name:'4商品を表示',exact:true}).click();
    await expect(names).toHaveText(['折りたたみ傘','読書灯','小さなカメラ','ノート']);
    await expect(page.locator('.rank-grip')).toHaveCount(0);
    await expect(page.locator('.rank-number')).toHaveCount(0);
    await page.getByRole('button',{name:'購入日が近い順。購入日が遠い順に切り替え',exact:true}).click();
    await expect(names).toHaveText(['小さなカメラ','読書灯','折りたたみ傘','ノート']);
    await expect(page.locator('.rank-number')).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`list-sort-date-${width}.png`),style:'nextjs-portal { visibility: hidden; }'});
    expect(writes).toHaveLength(0);
    await openDisplay();
    await expect(panel.getByRole('radio',{name:'購入日順',exact:true})).toBeChecked();
    await expect(panel.getByRole('radio')).toHaveCount(3);
    await panel.getByRole('radio',{name:'優先度順',exact:true}).check();
    await panel.getByRole('checkbox',{name:'最低',exact:true}).check();
    await panel.getByRole('button',{name:'0商品を表示',exact:true}).click();
    await expect(names).toHaveCount(0);
    await page.getByRole('button',{name:'優先度の絞り込みを解除',exact:true}).click();
    await expect(names).toHaveText(['小さなカメラ','読書灯','ノート','折りたたみ傘']);
    await page.getByRole('button',{name:'優先度が高い順。優先度が低い順に切り替え',exact:true}).click();
    const grip=page.getByRole('button',{name:/読書灯を同じ優先度内で並べ替え/});
    await grip.focus();
    await grip.press('Space');await grip.press('ArrowDown');await grip.press('Space');
    await expect(names).toHaveText(['折りたたみ傘','ノート','読書灯','小さなカメラ']);
    await page.getByRole('button',{name:'優先度が低い順。優先度が高い順に切り替え',exact:true}).click();
    await expect(names).toHaveText(['小さなカメラ','ノート','読書灯','折りたたみ傘']);
    expect(writes).toHaveLength(1);
    await page.reload();
    await expect(names).toHaveText(['小さなカメラ','ノート','読書灯','折りたたみ傘']);
    await page.screenshot({path:info.outputPath(`list-sort-result-${width}.png`),style:'nextjs-portal { visibility: hidden; }'});
  });
}
