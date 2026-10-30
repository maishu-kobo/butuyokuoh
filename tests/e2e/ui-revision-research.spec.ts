import { test } from '@playwright/test';
// One-time public-page research capture, not a deterministic regression check.
// Removed after the research evidence is saved. Failure is reported as unavailable.
test('capture official design reference evidence', async ({ page }) => {
 test.setTimeout(180000);
 const sources = [
 ['apple-layout','https://developer.apple.com/design/human-interface-guidelines/layout'],
 ['apple-photos','https://support.apple.com/guide/photos/get-started-pht23b129fed/mac'],
 ['apple-reminders','https://support.apple.com/guide/reminders/welcome/mac'],
 ['things','https://culturedcode.com/things/features/'],
 ['apple-compare','https://www.apple.com/mac/compare/'],
 ['bellroy','https://bellroy.com/products/category/backpacks']
 ];
 await page.setViewportSize({width:1280,height:900});
 for (const [name,url] of sources) {
  try {
   const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
   if (!response?.ok()) throw new Error('HTTP '+response?.status());
   await page.waitForFunction(()=>document.body.innerText.length>600,{},{timeout:15000});
   if(name==='apple-photos')await page.getByRole('heading',{name:'Browse your photos',exact:true}).scrollIntoViewIfNeeded();
   if(name==='apple-reminders')await page.getByRole('heading',{name:'Organize your grocery list',exact:true}).scrollIntoViewIfNeeded();
   if(name==='things')await page.getByRole('heading',{name:'Beautiful To-Dos',exact:true}).scrollIntoViewIfNeeded();
   console.log('UI_RESEARCH_TEXT|'+name+'|'+JSON.stringify({url:page.url(),text:(await page.locator('body').innerText()).slice(0,16000)}));
   console.log('UI_RESEARCH_IMAGE|'+name+'|'+(await page.screenshot({type:'jpeg',quality:70,timeout:10000})).toString('base64'));
  } catch(e) { console.log('UI_RESEARCH_UNAVAILABLE|'+name+'|'+String(e).slice(0,500)); }
 }
});
