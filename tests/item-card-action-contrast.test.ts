// 描画した商品カードの計算スタイルを見る。ソースの文字列は読まない。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import puppeteer, { type Browser, type LaunchOptions, type Page } from 'puppeteer';
import { AuthContext } from '../src/components/AuthProvider';
import ItemCard from '../src/components/ItemCard';
import PhotoGroupCard from '../src/components/PhotoGroupCard';
import type { WishlistRow } from '../src/lib/capture/list-card';
import type { Item } from '../src/types';

const MINIMUM_RATIO = 4.5;
const THEMES = ['light', 'dark'] as const;
const STATES = ['normal', 'hover', 'focus'] as const;

const auth = {
  user: null,
  token: null,
  loading: false,
  isGuest: false,
  guestEnabled: false,
  ttlHours: 24,
  googleLogin: false,
  startGuest: async () => {},
  login: async () => {},
  register: async () => {},
  logout: async () => {},
};

type ThemeName = (typeof THEMES)[number];
type StateName = (typeof STATES)[number];
type Sample = {
  ratio: number;
  color: string;
  background: string;
  opacity: number;
  disabled: boolean;
  ariaDisabled: string | null;
};

let browser: Browser;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 1,
    name: 'リンク付きのペン',
    url: 'https://example.com/pen',
    image_url: null,
    current_price: 980,
    original_price: null,
    source: 'other',
    source_name: 'その他',
    priority: 3,
    planned_purchase_date: '2026-11-01',
    comparison_group_id: null,
    category_id: null,
    notes: null,
    is_purchased: false,
    purchased_at: null,
    target_price: null,
    target_currency: null,
    quantity: 1,
    deleted_at: null,
    created_at: '2026-10-22 00:00:00',
    updated_at: '2026-10-22 00:00:00',
    ...overrides,
  };
}

function photoCard(): Extract<WishlistRow, { kind: 'photo' }> {
  return {
    kind: 'photo',
    groupId: 7,
    name: '牛乳',
    minPrice: 500,
    maxPrice: 800,
    rangeText: '¥500〜¥800',
    itemIds: [10, 11],
    shops: [
      {
        itemId: 10,
        name: '牛乳A',
        site: 'Yahoo!ショッピング',
        shopName: 'Yahoo!ショッピング',
        price: 800,
        fetchedAt: '2026-10-22 01:02:03',
        url: 'https://store.shopping.yahoo.co.jp/shop/a',
        purchased: false,
      },
      {
        itemId: 11,
        name: '牛乳B',
        site: '楽天',
        shopName: '楽天',
        price: 500,
        fetchedAt: '2026-10-22 01:02:03',
        url: 'https://item.rakuten.co.jp/shop/b',
        purchased: false,
      },
    ],
  };
}

function markup(node: ReactNode): string {
  return renderToStaticMarkup(createElement(AuthContext.Provider, { value: auth }, node));
}

async function appCss(): Promise<string> {
  const from = new URL('../src/app/globals.css', import.meta.url);
  const source = readFileSync(from, 'utf8');
  const result = await postcss([tailwind()]).process(source, { from: from.pathname });
  return result.css;
}

async function launchCardBrowser(): Promise<Browser> {
  const attempts: LaunchOptions[] = [{ headless: true }];
  for (const executablePath of ['/usr/bin/google-chrome', '/usr/local/bin/chrome']) {
    if (existsSync(executablePath)) attempts.push({ headless: true, executablePath });
  }
  let last: unknown;
  for (const options of attempts) {
    try {
      return await puppeteer.launch(options);
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('No usable sandbox')) continue;
      try {
        return await puppeteer.launch({
          ...options,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      } catch (retry) {
        last = retry;
      }
    }
  }
  throw last;
}

function pageHtml(css: string): string {
  const linked = markup(createElement(ItemCard, {
    item: item(),
    onUpdate: () => {},
    onDelete: () => {},
  }));
  const manual = markup(createElement(ItemCard, {
    item: item({ id: 2, name: 'URLなしのペン', url: 'manual://pen' }),
    onUpdate: () => {},
    onDelete: () => {},
  }));
  const photo = markup(createElement(PhotoGroupCard, {
    card: photoCard(),
    item: item({
      id: 10,
      name: '牛乳A',
      url: 'https://store.shopping.yahoo.co.jp/shop/a',
      source: 'yahoo',
      source_name: 'Yahoo!ショッピング',
      current_price: 800,
      comparison_group_id: 7,
      planned_purchase_date: null,
    }),
    onUpdate: () => {},
  }));
  return `<!doctype html>
<html class="wa-modern">
<head>
<meta charset="utf-8">
<style>${css}
*{transition:none !important;animation:none !important}
[data-contrast-target]:hover{--hover-probe:1}
[data-contrast-target]:focus{--focus-probe:1}
</style>
</head>
<body>
<section id="linked">${linked}</section>
<section id="manual">${manual}</section>
<section id="photo">${photo}</section>
</body>
</html>`;
}

// ブラウザへ渡す関数は文字列から作る。tsx の関数名ヘルパはページ内に無い。
const sampleInPage = new Function('el', `
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is unavailable');
  const luminance = (color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    if (pixel[3] !== 255) throw new Error('opaque color required: ' + color);
    const rgb = [pixel[0], pixel[1], pixel[2]].map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  let background = '';
  for (let node = el; node; node = node.parentElement) {
    const next = getComputedStyle(node).backgroundColor;
    if (next !== 'rgba(0, 0, 0, 0)' && next !== 'transparent') {
      background = next;
      break;
    }
  }
  if (!background || background === bodyBg) throw new Error('card background did not paint');
  const style = getComputedStyle(el);
  const foreground = luminance(style.color);
  const behind = luminance(background);
  const button = el instanceof HTMLButtonElement ? el : null;
  return {
    ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05),
    color: style.color,
    background,
    opacity: Number(style.opacity),
    disabled: button ? button.disabled : false,
    ariaDisabled: el.getAttribute('aria-disabled'),
  };
`) as (el: Element) => Sample;

async function openCards(): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setContent(pageHtml(await appCss()), { waitUntil: 'domcontentloaded' });
  // この Chrome はポインタ装置が無く (hover: hover) が偽。Tailwind の hover 色はそこだけにかかる。
  // 媒体条件だけを all に替え、宣言そのものはビルド済み CSS のままにする。
  await page.evaluate(new Function(`
    if (window.matchMedia('(hover: hover)').matches) return;
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes('hover: hover')) {
          rule.media.mediaText = 'all';
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
  `) as () => void);
  return page;
}

async function applyTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.evaluate((next) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function target(page: Page, root: string, label: string): Promise<string> {
  const selector = `${root} [data-contrast-target]`;
  const found = await page.$eval(root, (section, name) => {
    section.querySelector('[data-contrast-target]')?.removeAttribute('data-contrast-target');
    const match = [...section.querySelectorAll('button, span')].find((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return text === name || text.startsWith(`${name}:`) || text.startsWith(`${name} `) || el.getAttribute('aria-label') === name;
    });
    if (!match) return false;
    match.setAttribute('data-contrast-target', '1');
    return true;
  }, label);
  assert.equal(found, true, `${root} ${label}`);
  return selector;
}

async function sampleAt(page: Page, selector: string, state: StateName): Promise<Sample> {
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  if (state === 'hover') await page.hover(selector);
  if (state === 'focus') await page.focus(selector);
  const probe = await page.$eval(selector, (el) => {
    const style = getComputedStyle(el);
    return {
      hover: style.getPropertyValue('--hover-probe').trim(),
      focus: style.getPropertyValue('--focus-probe').trim(),
    };
  });
  if (state === 'hover') assert.equal(probe.hover, '1', selector);
  if (state === 'focus') assert.equal(probe.focus, '1', selector);
  return page.$eval(selector, sampleInPage);
}

async function readable(page: Page, root: string, label: string, states: readonly StateName[]): Promise<string[]> {
  const failures: string[] = [];
  for (const theme of THEMES) {
    await applyTheme(page, theme);
    const selector = await target(page, root, label);
    for (const state of states) {
      const sample = await sampleAt(page, selector, state);
      assert.equal(sample.disabled, false, `${theme} ${label} is enabled`);
      assert.notEqual(sample.ariaDisabled, 'true', `${theme} ${label} is available`);
      if (sample.ratio < MINIMUM_RATIO) {
        failures.push(`${theme} ${state} ${label} ${sample.ratio.toFixed(2)} (${sample.color} on ${sample.background})`);
      }
    }
  }
  return failures;
}

before(async () => {
  browser = await launchCardBrowser();
});

after(async () => {
  await browser?.close();
});

test('linked and photo-group cards keep available auxiliary actions readable', async () => {
  const page = await openCards();
  try {
    const failures = [
      ...await readable(page, '#linked', '価格を更新', STATES),
      ...await readable(page, '#linked', '価格推移', STATES),
      ...await readable(page, '#linked', '編集', STATES),
      ...await readable(page, '#linked', '購入予定', ['normal']),
      ...await readable(page, '#photo', '価格推移', STATES),
      ...await readable(page, '#photo', '編集', STATES),
      ...await readable(page, '#photo', 'ショップを見る', STATES),
    ];
    assert.deepEqual(failures, []);
  } finally {
    await page.close();
  }
});

test('a refresh without a linkable url is dimmer than an available refresh, and purchase stays distinct', async () => {
  const page = await openCards();
  try {
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      const available = await sampleAt(page, await target(page, '#linked', '価格を更新'), 'normal');
      const unavailable = await sampleAt(page, await target(page, '#manual', '価格を更新'), 'normal');
      assert.equal(available.disabled, false);
      assert.equal(unavailable.disabled, true);
      assert.ok(unavailable.opacity < available.opacity, `${theme} disabled refresh stays visually quieter`);

      const linkedPurchase = await sampleAt(page, await target(page, '#linked', '購入済みにする'), 'normal');
      const photoPurchase = await sampleAt(page, await target(page, '#photo', '購入済みにする'), 'normal');
      assert.equal(linkedPurchase.disabled, false);
      assert.notEqual(linkedPurchase.ariaDisabled, 'true');
      assert.equal(photoPurchase.ariaDisabled, 'true');
      assert.equal(photoPurchase.disabled, false);
      assert.notEqual(linkedPurchase.color, photoPurchase.color, `${theme} purchase availability stays distinct`);
    }
  } finally {
    await page.close();
  }
});
