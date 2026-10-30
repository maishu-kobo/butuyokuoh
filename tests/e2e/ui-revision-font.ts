import { readFile } from 'node:fs/promises';
import { type Page } from '@playwright/test';
let cachedCss: string | undefined;
/** Fixed licensed fonts for screenshots only. No network or application dependency. */
export async function japaneseScreenshotFont(page: Page) {
  if (!cachedCss) {
    cachedCss = await readFile('tests/e2e/fixtures/ui-revision-fonts.css', 'utf8');
    for (const [i, file] of ['ui-noto-sans-jp.woff2', 'ui-noto-serif-jp.woff2'].entries()) {
      const bytes = await readFile('tests/e2e/fixtures/' + file);
      cachedCss = cachedCss.split('FONT_' + i).join('data:font/woff2;base64,' + bytes.toString('base64'));
    }
  }
  await page.addStyleTag({ content: cachedCss + '\nbody,button,input,select{font-family:"Noto Sans JP",sans-serif!important} body[data-concept=a] h1,body[data-concept=a] .journal-title,body[data-concept=a] .journal-rail h2,#butuyoku-ui-study[data-concept=a] h2{font-family:"Noto Serif JP",serif!important}' });
  await page.evaluate(() => document.fonts.ready);
}
