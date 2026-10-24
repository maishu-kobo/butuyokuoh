import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer';

const NO_USABLE_SANDBOX = 'No usable sandbox!';
const FALLBACK_WARNING = 'Chrome のサンドボックスが使えない（No usable sandbox!）ため、--no-sandbox で一度だけ起動し直します';
const UNSANDBOXED_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

// 起動関数を差し替えられる。本番は puppeteer.launch。
export type PageBrowserDeps = {
  launch?: (options: LaunchOptions) => Promise<Browser>;
};

function noUsableSandbox(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.includes(NO_USABLE_SANDBOX);
}

// ページ取得が使うブラウザ。まず Chrome のサンドボックス付きで起動する。
// 起動前に "No usable sandbox!" で死んだときだけ、--no-sandbox と
// --disable-setuid-sandbox で一度だけやり直す。ほかの失敗ではやり直さない。
export async function launchPageBrowser(deps?: PageBrowserDeps): Promise<Browser> {
  const launch = deps?.launch ?? ((options: LaunchOptions) => puppeteer.launch(options));
  try {
    return await launch({ headless: true });
  } catch (error) {
    if (!noUsableSandbox(error)) throw error;
    console.warn(FALLBACK_WARNING);
    return await launch({ headless: true, args: [...UNSANDBOXED_ARGS] });
  }
}
