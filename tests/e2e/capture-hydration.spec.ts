import { chromium, devices, expect, test, type Page } from '@playwright/test';

const hydrationError = /server rendered HTML didn't match the client|won't be patched up|Hydration failed because the server rendered/i;

function watchHydration(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && hydrationError.test(text)) errors.push(text);
  });
  page.on('pageerror', (error) => {
    if (hydrationError.test(error.message)) errors.push(error.message);
  });
  return errors;
}

function registerButton(html: string) {
  const match = html.match(/<button\b[^>]*>\s*写真から登録\s*<\/button>/);
  return match?.[0] ?? '';
}

// WebKit のシステムパッケージは apt が時間切れになる（#122）。粗いポインタは Chromium で見る。
async function coarsePage() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    hasTouch: true,
    isMobile: true,
    baseURL: 'http://localhost:3107',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query === '(pointer: coarse)') {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        } as MediaQueryList;
      }
      return original(query);
    };
  });
  const page = await context.newPage();
  return { browser, page };
}

test('desktop load does not hydrate mismatched photo-button attributes', async ({ page }) => {
  // 本番ビルドは検証ページを出さない。開発の e2e だけでサーバ HTML を見る。
  test.skip(Boolean(process.env.E2E_PRODUCTION), '本番ビルドには検証ページが無い');
  const errors = watchHydration(page);
  const response = await page.goto('/capture-hydration');
  expect(response?.ok()).toBeTruthy();
  const button = registerButton(await response!.text());
  expect(button).not.toEqual('');
  expect(button).toMatch(/data-pointer="pending"/);
  expect(button).not.toMatch(/aria-haspopup|aria-expanded|aria-controls/);
  const register = page.getByRole('button', { name: '写真から登録' });
  await expect(register).toHaveAttribute('data-pointer', 'fine');
  await expect(register).toHaveAttribute('aria-haspopup', 'menu');
  await expect(register).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});

test('a coarse pointer load does not hydrate mismatched photo-button attributes', async () => {
  test.skip(Boolean(process.env.E2E_PRODUCTION), '本番ビルドには検証ページが無い');
  const { browser, page } = await coarsePage();
  try {
    const errors = watchHydration(page);
    const response = await page.goto('/capture-hydration');
    expect(response?.ok()).toBeTruthy();
    const button = registerButton(await response!.text());
    expect(button).not.toEqual('');
    expect(button).toMatch(/data-pointer="pending"/);
    expect(button).not.toMatch(/aria-haspopup|aria-expanded|aria-controls/);
    const register = page.getByRole('button', { name: '写真から登録' });
    await expect(register).toHaveAttribute('data-pointer', 'coarse');
    await expect(register).not.toHaveAttribute('aria-haspopup');
    await expect(register).not.toHaveAttribute('aria-expanded');
    await expect(register).not.toHaveAttribute('aria-controls');
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test('the home page has no hydration mismatch on a coarse pointer or on desktop', async ({ page }) => {
  const desktopErrors = watchHydration(page);
  const home = await page.goto('/');
  expect(home?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '物欲王' })).toBeVisible();
  expect(desktopErrors).toEqual([]);

  const coarse = await coarsePage();
  try {
    const mobileErrors = watchHydration(coarse.page);
    const response = await coarse.page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(coarse.page.getByRole('heading', { name: '物欲王' })).toBeVisible();
    expect(mobileErrors).toEqual([]);
  } finally {
    await coarse.browser.close();
  }
});
