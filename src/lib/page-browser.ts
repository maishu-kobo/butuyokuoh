import puppeteer, { type Browser } from 'puppeteer';

// ページ取得が使うブラウザ。起動引数は呼び出し側で足さない。
export function launchPageBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}
