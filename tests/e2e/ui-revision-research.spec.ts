import { test } from '@playwright/test';
// Temporary public-source research, removed after saving the observation.
test('read official HIG layout document', async ({ page }) => {
 const url='https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json';
 try {
  const response=await page.request.get(url,{timeout:20000});
  if(!response.ok())throw new Error('HTTP '+response.status());
  const doc=await response.json();
  console.log('UI_HIG|'+JSON.stringify({url,metadata:doc.metadata,sections:doc.primaryContentSections}));
 }catch(e){console.log('UI_HIG_UNAVAILABLE|'+String(e).slice(0,300));}
});
