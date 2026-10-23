import puppeteer, { type Browser } from 'puppeteer';

// ページ取得が使うブラウザ。Chrome のサンドボックスは付けたままにする。
export function launchPageBrowser(): Promise<Browser> {
  return puppeteer.launch({ headless: true });
}
