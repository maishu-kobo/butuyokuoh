import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer';

// テストが起動の失敗を渡すための入口。本番は puppeteer.launch のまま。
export type PageBrowserDeps = {
  launch?: (options: LaunchOptions) => Promise<Browser>;
};

// ページ取得が使うブラウザ。Chrome のサンドボックスは付けたままにする。
export function launchPageBrowser(deps?: PageBrowserDeps): Promise<Browser> {
  const launch = deps?.launch ?? ((options: LaunchOptions) => puppeteer.launch(options));
  return launch({ headless: true });
}
