import { readFile } from 'node:fs/promises';
import { type Page } from '@playwright/test';
let cachedCss: string | undefined;
/** One-time screenshot preparation. Replaced with saved font bytes before final submission. */
export async function japaneseScreenshotFont(page: Page) {
 if (!cachedCss) {
  const source = (await readFile('docs/ui-refresh-256/v2/prototypes.html','utf8')) + (await readFile('docs/ui-refresh-256/prototypes.html','utf8'));
  const text = [...new Set(source.replace(/data:image[^"'\s]+/g,'').replace(/\s/g,''))].sort().join('');
  const response=await page.request.get('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Noto+Serif+JP:wght@400;700&text='+encodeURIComponent(text));
  if (!response.ok()) throw new Error('Screenshot font CSS unavailable: '+response.status());
  let css=await response.text();
  let i=0;
  for(const url of [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m=>m[1]))]) {
   if(!url.startsWith('https://fonts.gstatic.com/'))throw new Error('Unexpected screenshot font host');
   const font=await page.request.get(url);if(!font.ok())throw new Error('Screenshot font unavailable');
   css=css.split(url).join('data:font/woff2;base64,'+(await font.body()).toString('base64'));i++;
  }
  cachedCss=css;console.log('UI_FONT_CSS|'+JSON.stringify(css));console.log('UI_FONT_COUNT|'+i);
 }
 await page.addStyleTag({content:cachedCss+'\nbody,button,input,select {font-family:"Noto Sans JP",sans-serif !important} body[data-concept=a] h1,body[data-concept=a] .journal-title,#butuyoku-ui-study[data-concept=a] h2 {font-family:"Noto Serif JP",serif !important}'});
 await page.evaluate(()=>document.fonts.ready);
}
