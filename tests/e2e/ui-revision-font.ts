import { type Page } from '@playwright/test';
const fontCache = new Map<string, string>();
/** Screenshot-only font, not an application dependency. Official Google Fonts endpoint. */
export async function japaneseScreenshotFont(page: Page) {
  const text = [...new Set((await page.locator('body').innerText()).replace(/\s/g, ''))].sort().join('');
  let css = fontCache.get(text);
  if (!css) {
    const response = await page.request.get('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&text=' + encodeURIComponent(text));
    if (!response.ok()) throw new Error('Screenshot font CSS unavailable: ' + response.status());
    css = await response.text();
    for (const url of [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))]) {
      if (!url.startsWith('https://fonts.gstatic.com/')) throw new Error('Unexpected screenshot font host');
      const font = await page.request.get(url);
      if (!font.ok()) throw new Error('Screenshot font unavailable: ' + font.status());
      css = css.split(url).join('data:font/woff2;base64,' + (await font.body()).toString('base64'));
    }
    fontCache.set(text, css);
  }
  await page.addStyleTag({ content: css + '\nbody,button,input,select,h1,h2,h3 { font-family: "Noto Sans JP", sans-serif !important; }' });
  await page.evaluate(() => document.fonts.ready);
}
